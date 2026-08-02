#!/usr/bin/env python3
"""Validate Titan Builder GitHub Actions workflows against repository policy."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


APPROVED_ACTIONS = {
    "actions/checkout",
    "actions/setup-node",
    "actions/setup-python",
}
FULL_SHA = re.compile(r"^[0-9a-fA-F]{40}$")


@dataclass(frozen=True, order=True)
class Violation:
    path: str
    rule: str
    message: str


def _workflow_trigger(workflow: dict[str, Any]) -> Any:
    # PyYAML 1.1 treats the unquoted key `on` as boolean True.
    return workflow.get("on", workflow.get(True))


def _relative(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def _is_false(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.lower() == "false")


def _check_workflow(path: Path, root: Path) -> list[Violation]:
    relative = _relative(path, root)
    violations: list[Violation] = []

    try:
        workflow = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        return [Violation(relative, "yaml-parse", f"workflow YAML could not be parsed: {exc}")]

    if not isinstance(workflow, dict):
        return [Violation(relative, "yaml-parse", "workflow root must be a YAML mapping")]

    permissions = workflow.get("permissions")
    if permissions is None:
        violations.append(
            Violation(relative, "permissions-required", "declare explicit top-level workflow permissions")
        )
    elif isinstance(permissions, str) and permissions.lower() == "write-all":
        violations.append(
            Violation(relative, "permissions-write-all", "workflow permissions must not use write-all")
        )
    elif isinstance(permissions, dict):
        write_scopes = sorted(
            str(scope) for scope, access in permissions.items() if str(access).lower() == "write"
        )
        if write_scopes:
            violations.append(
                Violation(
                    relative,
                    "permissions-write",
                    f"workflow grants write permissions: {', '.join(write_scopes)}",
                )
            )

    trigger = _workflow_trigger(workflow)
    if isinstance(trigger, dict) and "pull_request_target" in trigger:
        violations.append(
            Violation(relative, "unsafe-trigger", "pull_request_target is not permitted")
        )
    elif trigger == "pull_request_target":
        violations.append(
            Violation(relative, "unsafe-trigger", "pull_request_target is not permitted")
        )

    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict) or not jobs:
        violations.append(Violation(relative, "jobs-required", "workflow must define at least one job"))
        return violations

    for job_id, raw_job in jobs.items():
        if not isinstance(raw_job, dict):
            violations.append(
                Violation(relative, "job-shape", f"job {job_id!r} must be a YAML mapping")
            )
            continue

        if "timeout-minutes" not in raw_job:
            violations.append(
                Violation(relative, "job-timeout", f"job {job_id!r} must define timeout-minutes")
            )

        steps = raw_job.get("steps", [])
        if not isinstance(steps, list):
            violations.append(
                Violation(relative, "steps-shape", f"job {job_id!r} steps must be a list")
            )
            continue

        for index, step in enumerate(steps, start=1):
            if not isinstance(step, dict) or "uses" not in step:
                continue
            uses = step.get("uses")
            if not isinstance(uses, str):
                violations.append(
                    Violation(relative, "action-reference", f"job {job_id!r} step {index} uses must be text")
                )
                continue
            if uses.startswith("./") or uses.startswith("docker://"):
                continue
            if "@" not in uses:
                violations.append(
                    Violation(relative, "action-pin", f"job {job_id!r} step {index} action has no ref: {uses}")
                )
                continue

            action, ref = uses.rsplit("@", 1)
            if action not in APPROVED_ACTIONS:
                violations.append(
                    Violation(
                        relative,
                        "action-allowlist",
                        f"job {job_id!r} step {index} uses unapproved action {action!r}",
                    )
                )
            if not FULL_SHA.fullmatch(ref):
                violations.append(
                    Violation(
                        relative,
                        "action-pin",
                        f"job {job_id!r} step {index} must pin {action!r} to a full commit SHA",
                    )
                )

            if action == "actions/checkout":
                options = step.get("with")
                persist = options.get("persist-credentials") if isinstance(options, dict) else None
                if not _is_false(persist):
                    violations.append(
                        Violation(
                            relative,
                            "checkout-credentials",
                            f"job {job_id!r} step {index} must set persist-credentials: false",
                        )
                    )

    if path.name == "verify.yml":
        required_job = jobs.get("required-ci")
        if not isinstance(required_job, dict):
            violations.append(
                Violation(relative, "required-ci-job", "verify.yml must define job ID required-ci")
            )
        elif required_job.get("name") != "required-ci":
            violations.append(
                Violation(
                    relative,
                    "required-ci-name",
                    "required-ci job display name must be exactly 'required-ci'",
                )
            )

    return violations


def check_repository(root: Path) -> list[Violation]:
    """Return all workflow policy violations below ``root`` in stable order."""
    root = root.resolve()
    workflow_dir = root / ".github" / "workflows"
    paths = sorted({*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml")})
    if not paths:
        return [
            Violation(
                ".github/workflows",
                "workflows-required",
                "repository must contain at least one GitHub Actions workflow",
            )
        ]

    violations: list[Violation] = []
    for path in paths:
        violations.extend(_check_workflow(path, root))
    return sorted(violations)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", type=Path, help="repository root")
    args = parser.parse_args(argv)

    violations = check_repository(args.root)
    if not violations:
        print("GitHub workflow policy: PASS")
        return 0

    print("GitHub workflow policy: FAIL", file=sys.stderr)
    for violation in violations:
        print(
            f"{violation.path}: [{violation.rule}] {violation.message}",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

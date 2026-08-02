#!/usr/bin/env python3
"""Scan tracked text files for high-confidence committed secret patterns."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ALLOW_MARKER = "secret-scan: allow"
MAX_FILE_BYTES = 1_000_000
PATTERNS = (
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b")),
    ("github-fine-grained-token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{80,255}\b")),
    ("openai-key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    (
        "private-key",
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    ),
)


@dataclass(frozen=True, order=True)
class Finding:
    path: str
    line: int
    rule: str


def _relative(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _read_text(path: Path) -> str | None:
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if len(raw) > MAX_FILE_BYTES or b"\x00" in raw:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def scan_files(root: Path, paths: Iterable[Path]) -> list[Finding]:
    """Return high-confidence findings without exposing matched secret values."""
    findings: list[Finding] = []
    for path in sorted({Path(item) for item in paths}):
        text = _read_text(path)
        if text is None:
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if ALLOW_MARKER in line:
                continue
            for rule, pattern in PATTERNS:
                if pattern.search(line):
                    findings.append(
                        Finding(
                            path=_relative(path, root),
                            line=line_number,
                            rule=rule,
                        )
                    )
    return sorted(findings)


def tracked_files(root: Path) -> list[Path]:
    """List Git-tracked files under ``root`` using NUL-safe output."""
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        check=True,
        capture_output=True,
    )
    return [root / item.decode("utf-8") for item in result.stdout.split(b"\x00") if item]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", type=Path, help="repository root")
    args = parser.parse_args(argv)
    root = args.root.resolve()

    try:
        paths = tracked_files(root)
    except (OSError, subprocess.CalledProcessError, UnicodeDecodeError) as exc:
        print(f"Unable to enumerate tracked files: {exc}", file=sys.stderr)
        return 2

    findings = scan_files(root, paths)
    if not findings:
        print("Committed secret scan: PASS")
        return 0

    print("Committed secret scan: FAIL", file=sys.stderr)
    for finding in findings:
        print(
            f"{finding.path}:{finding.line}: [{finding.rule}] possible committed secret",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import tempfile
import textwrap
import unittest
from pathlib import Path

from scripts.check_github_workflows import check_repository


CHECKOUT_SHA = "34e114876b0b11c390a56381ad16ebd13914f8d5"


class WorkflowPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        (self.root / ".github" / "workflows").mkdir(parents=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_workflow(self, content: str, name: str = "verify.yml") -> None:
        path = self.root / ".github" / "workflows" / name
        path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")

    def valid_workflow(self) -> str:
        return textwrap.dedent(f"""
        name: Verify Titan Builder
        on:
          pull_request:
          push:
            branches: [main]
        permissions:
          contents: read
        jobs:
          verify-linux:
            name: verify-linux
            runs-on: ubuntu-latest
            timeout-minutes: 20
            steps:
              - name: Checkout
                uses: actions/checkout@{CHECKOUT_SHA}
                with:
                  persist-credentials: false
          required-ci:
            name: required-ci
            runs-on: ubuntu-latest
            timeout-minutes: 5
            steps:
              - run: echo ok
        """).lstrip()

    def rules(self) -> set[str]:
        return {violation.rule for violation in check_repository(self.root)}

    def test_accepts_compliant_workflow(self) -> None:
        self.write_workflow(self.valid_workflow())
        self.assertEqual(check_repository(self.root), [])

    def test_reports_invalid_yaml(self) -> None:
        self.write_workflow("name: [unterminated")
        self.assertIn("yaml-parse", self.rules())

    def test_requires_explicit_permissions(self) -> None:
        self.write_workflow(self.valid_workflow().replace("permissions:\n  contents: read\n", ""))
        self.assertIn("permissions-required", self.rules())

    def test_rejects_write_all_permissions(self) -> None:
        self.write_workflow(self.valid_workflow().replace("permissions:\n  contents: read", "permissions: write-all"))
        self.assertIn("permissions-write-all", self.rules())

    def test_rejects_pull_request_target(self) -> None:
        self.write_workflow(self.valid_workflow().replace("pull_request:", "pull_request_target:"))
        self.assertIn("unsafe-trigger", self.rules())

    def test_requires_job_timeouts(self) -> None:
        self.write_workflow(self.valid_workflow().replace("    timeout-minutes: 20\n", "", 1))
        self.assertIn("job-timeout", self.rules())

    def test_requires_full_action_sha(self) -> None:
        self.write_workflow(self.valid_workflow().replace(CHECKOUT_SHA, "v4"))
        self.assertIn("action-pin", self.rules())

    def test_rejects_unapproved_external_action(self) -> None:
        self.write_workflow(
            self.valid_workflow().replace(
                f"actions/checkout@{CHECKOUT_SHA}",
                "third-party/example@0123456789abcdef0123456789abcdef01234567",
            )
        )
        self.assertIn("action-allowlist", self.rules())

    def test_requires_checkout_credentials_to_be_disabled(self) -> None:
        self.write_workflow(self.valid_workflow().replace("persist-credentials: false", "persist-credentials: true"))
        self.assertIn("checkout-credentials", self.rules())

    def test_requires_required_ci_job_in_verify_workflow(self) -> None:
        self.write_workflow(self.valid_workflow().replace("required-ci:", "merge-gate:"))
        self.assertIn("required-ci-job", self.rules())

    def test_requires_stable_required_ci_display_name(self) -> None:
        self.write_workflow(self.valid_workflow().replace("name: required-ci", "name: merge gate"))
        self.assertIn("required-ci-name", self.rules())


if __name__ == "__main__":
    unittest.main()

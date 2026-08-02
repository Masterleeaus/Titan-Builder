from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.scan_committed_secrets import scan_files


class SecretScannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write(self, name: str, content: str) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_reports_high_confidence_tokens(self) -> None:
        token = "gh" + "p_" + ("A" * 36)
        path = self.write("config.txt", f"TOKEN={token}\n")
        findings = scan_files(self.root, [path])
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].rule, "github-token")

    def test_reports_private_key_headers(self) -> None:
        header = "-----BEGIN " + "PRIVATE KEY-----"
        path = self.write("key.pem", header + "\n")
        findings = scan_files(self.root, [path])
        self.assertEqual([finding.rule for finding in findings], ["private-key"])

    def test_ignores_allowed_example_line(self) -> None:
        token = "sk-" + ("A" * 40)
        path = self.write("docs/example.md", f"{token} # secret-scan: allow\n")
        self.assertEqual(scan_files(self.root, [path]), [])

    def test_skips_binary_files(self) -> None:
        token = b"AKIA" + (b"A" * 16) + b"\x00"
        path = self.root / "asset.bin"
        path.write_bytes(token)
        self.assertEqual(scan_files(self.root, [path]), [])


if __name__ == "__main__":
    unittest.main()

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "analysis_tools.py"
SPEC = importlib.util.spec_from_file_location("analysis_tools", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
CodeAnalyzer = MODULE.CodeAnalyzer


class CodeAnalyzerTests(unittest.TestCase):
    def test_reports_complexity_imports_exports_and_security_findings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sample.py"
            source.write_text(
                "import os\n"
                "from pathlib import Path\n\n"
                "def exported(value):\n"
                "    if value:\n"
                "        return eval(value)\n"
                "    return Path('.')\n",
                encoding="utf-8",
            )

            result = CodeAnalyzer(root).analyze(["sample.py"])
            file_result = result["files"][0]

            self.assertEqual(file_result["path"], "sample.py")
            self.assertGreaterEqual(file_result["complexity"], 2)
            self.assertIn("os", file_result["imports"])
            self.assertIn("pathlib.Path", file_result["imports"])
            self.assertIn("exported", file_result["exports"])
            self.assertTrue(any("eval" in message for message in file_result["security_risks"]))
            self.assertEqual(result["summary"]["high_severity_findings"], 1)

    def test_returns_parse_errors_without_crashing_the_whole_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "broken.py").write_text("def broken(:\n", encoding="utf-8")

            result = CodeAnalyzer(root).analyze()

            self.assertEqual(result["summary"]["total_files"], 1)
            self.assertEqual(result["summary"]["failed_files"], 1)
            self.assertIn("error", result["files"][0])

    def test_ignores_virtual_environment_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "main.py").write_text("VALUE = 1\n", encoding="utf-8")
            ignored = root / ".venv"
            ignored.mkdir()
            (ignored / "ignored.py").write_text("eval('1')\n", encoding="utf-8")

            result = CodeAnalyzer(root).analyze()

            self.assertEqual([item["path"] for item in result["files"]], ["main.py"])

    def test_rejects_files_outside_the_project_root(self):
        with tempfile.TemporaryDirectory() as project_directory, tempfile.TemporaryDirectory() as outside_directory:
            project_root = Path(project_directory)
            outside_file = Path(outside_directory) / "outside.py"
            outside_file.write_text("VALUE = 1\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "escapes project root"):
                CodeAnalyzer(project_root).analyze([str(outside_file)])


if __name__ == "__main__":
    unittest.main()

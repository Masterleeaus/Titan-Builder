#!/usr/bin/env python3
"""Static Python analysis for the OpenBrowser workspace companion.

The analyzer intentionally uses only the Python standard library. It reports
source-located, evidence-based findings and never executes project code.
"""

from __future__ import annotations

import argparse
import ast
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Sequence

IGNORED_DIRECTORIES = {
    ".git",
    ".venv",
    "venv",
    "env",
    "node_modules",
    "__pycache__",
    "dist",
    "build",
    "coverage",
}


@dataclass(frozen=True)
class Finding:
    category: str
    severity: str
    message: str
    line: int


class CodeAnalyzer:
    def __init__(self, project_root: str | Path) -> None:
        self.project_root = Path(project_root).expanduser().resolve(strict=True)
        if not self.project_root.is_dir():
            raise ValueError("Project root must be a directory")

    def _resolve_file(self, value: str | Path) -> Path:
        candidate = Path(value)
        if not candidate.is_absolute():
            candidate = self.project_root / candidate
        resolved = candidate.resolve(strict=True)
        if not resolved.is_relative_to(self.project_root):
            raise ValueError(f"File escapes project root: {value}")
        if not resolved.is_file():
            raise ValueError(f"Not a file: {value}")
        return resolved

    def _iter_python_files(self, requested: Sequence[str] | None) -> Iterable[Path]:
        if requested:
            for value in requested:
                resolved = self._resolve_file(value)
                if resolved.suffix == ".py":
                    yield resolved
            return

        for file_path in sorted(self.project_root.rglob("*.py")):
            if any(part in IGNORED_DIRECTORIES for part in file_path.parts):
                continue
            if file_path.is_symlink():
                continue
            yield file_path

    @staticmethod
    def _qualified_call_name(node: ast.Call) -> str:
        parts: list[str] = []
        current: ast.expr = node.func
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
        return ".".join(reversed(parts))

    @staticmethod
    def _complexity(tree: ast.AST) -> int:
        decisions = 0
        for node in ast.walk(tree):
            if isinstance(node, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.ExceptHandler, ast.comprehension)):
                decisions += 1
            elif isinstance(node, ast.BoolOp):
                decisions += max(1, len(node.values) - 1)
            elif isinstance(node, ast.Match):
                decisions += len(node.cases)
        return decisions + 1

    @staticmethod
    def _imports(tree: ast.AST) -> list[str]:
        imports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                for alias in node.names:
                    imports.add(f"{module}.{alias.name}".strip("."))
        return sorted(imports)

    @staticmethod
    def _exports(tree: ast.Module) -> list[str]:
        exports: set[str] = set()
        explicit_all: list[str] | None = None
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not node.name.startswith("_"):
                exports.add(node.name)
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    if isinstance(target, ast.Name) and not target.id.startswith("_"):
                        exports.add(target.id)
                    if isinstance(target, ast.Name) and target.id == "__all__":
                        value = node.value
                        if isinstance(value, (ast.List, ast.Tuple)):
                            explicit_all = [
                                element.value
                                for element in value.elts
                                if isinstance(element, ast.Constant) and isinstance(element.value, str)
                            ]
        return sorted(explicit_all if explicit_all is not None else exports)

    def _security_findings(self, tree: ast.AST) -> list[Finding]:
        findings: list[Finding] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            call_name = self._qualified_call_name(node)
            line = getattr(node, "lineno", 1)

            if call_name in {"eval", "exec", "compile"}:
                findings.append(Finding(
                    "security",
                    "high",
                    f"Dynamic code execution through {call_name}()",
                    line,
                ))
            elif call_name in {"os.system", "subprocess.getoutput", "subprocess.getstatusoutput"}:
                findings.append(Finding(
                    "security",
                    "high",
                    f"Shell command execution through {call_name}()",
                    line,
                ))
            elif call_name.startswith("subprocess."):
                for keyword in node.keywords:
                    if keyword.arg == "shell" and isinstance(keyword.value, ast.Constant) and keyword.value.value is True:
                        findings.append(Finding(
                            "security",
                            "high",
                            f"{call_name}() enables shell=True",
                            line,
                        ))
            elif call_name in {"pickle.load", "pickle.loads", "marshal.load", "marshal.loads"}:
                findings.append(Finding(
                    "security",
                    "medium",
                    f"Deserialization through {call_name}() requires trusted input",
                    line,
                ))
            elif call_name == "yaml.load":
                safe_loader = any(
                    keyword.arg == "Loader"
                    and isinstance(keyword.value, ast.Attribute)
                    and keyword.value.attr in {"SafeLoader", "CSafeLoader"}
                    for keyword in node.keywords
                )
                if not safe_loader:
                    findings.append(Finding(
                        "security",
                        "high",
                        "yaml.load() is used without an explicit safe loader",
                        line,
                    ))
        return findings

    @staticmethod
    def _function_is_recursive(function: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
        for node in ast.walk(function):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == function.name:
                return True
        return False

    def _quality_findings(self, tree: ast.AST) -> list[Finding]:
        findings: list[Finding] = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                end_line = getattr(node, "end_lineno", node.lineno)
                source_lines = max(1, end_line - node.lineno + 1)
                argument_count = (
                    len(node.args.posonlyargs)
                    + len(node.args.args)
                    + len(node.args.kwonlyargs)
                )
                if source_lines > 80:
                    findings.append(Finding(
                        "code_smell",
                        "medium",
                        f"Long function {node.name} spans {source_lines} source lines",
                        node.lineno,
                    ))
                if argument_count > 7:
                    findings.append(Finding(
                        "code_smell",
                        "medium",
                        f"Function {node.name} accepts {argument_count} parameters",
                        node.lineno,
                    ))
                if self._function_is_recursive(node):
                    findings.append(Finding(
                        "performance",
                        "low",
                        f"Recursive function {node.name} should have a bounded base case",
                        node.lineno,
                    ))
            elif isinstance(node, ast.ClassDef):
                methods = sum(isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) for item in node.body)
                if methods > 25:
                    findings.append(Finding(
                        "code_smell",
                        "medium",
                        f"Large class {node.name} defines {methods} methods",
                        node.lineno,
                    ))
        return findings

    def analyze_python_file(self, file_path: Path) -> dict[str, object]:
        relative = file_path.relative_to(self.project_root).as_posix()
        try:
            content = file_path.read_text(encoding="utf-8")
            tree = ast.parse(content, filename=relative)
        except (OSError, UnicodeError, SyntaxError) as error:
            line = getattr(error, "lineno", None)
            return {
                "path": relative,
                "error": str(error),
                "line": line,
            }

        functions = sum(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) for node in ast.walk(tree))
        classes = sum(isinstance(node, ast.ClassDef) for node in ast.walk(tree))
        findings = self._security_findings(tree) + self._quality_findings(tree)

        return {
            "path": relative,
            "complexity": self._complexity(tree),
            "lines": len(content.splitlines()),
            "functions": functions,
            "classes": classes,
            "imports": self._imports(tree),
            "exports": self._exports(tree),
            "findings": [asdict(finding) for finding in findings],
            "security_risks": [finding.message for finding in findings if finding.category == "security"],
            "performance_hints": [finding.message for finding in findings if finding.category == "performance"],
            "code_smells": [finding.message for finding in findings if finding.category == "code_smell"],
        }

    def analyze(self, requested: Sequence[str] | None = None) -> dict[str, object]:
        files = [self.analyze_python_file(file_path) for file_path in self._iter_python_files(requested)]
        valid = [item for item in files if "error" not in item]
        findings = [
            finding
            for item in valid
            for finding in item.get("findings", [])
            if isinstance(finding, dict)
        ]
        total_complexity = sum(int(item.get("complexity", 0)) for item in valid)
        total_lines = sum(int(item.get("lines", 0)) for item in valid)

        return {
            "files": files,
            "summary": {
                "total_files": len(files),
                "analyzed_files": len(valid),
                "failed_files": len(files) - len(valid),
                "total_lines": total_lines,
                "avg_complexity": total_complexity / len(valid) if valid else 0,
                "finding_count": len(findings),
                "high_severity_findings": sum(finding.get("severity") == "high" for finding in findings),
                "security_risks": sorted({
                    str(finding.get("message"))
                    for finding in findings
                    if finding.get("category") == "security"
                }),
                "performance_hints": sorted({
                    str(finding.get("message"))
                    for finding in findings
                    if finding.get("category") == "performance"
                }),
                "code_smells": sorted({
                    str(finding.get("message"))
                    for finding in findings
                    if finding.get("category") == "code_smell"
                }),
            },
        }


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze Python code without executing it")
    parser.add_argument("project_root", help="Canonical project root")
    parser.add_argument("--file", action="append", default=[], help="Project-relative file to analyze")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        result = CodeAnalyzer(arguments.project_root).analyze(arguments.file or None)
    except Exception as error:  # Boundary: serialize fatal CLI errors for the TypeScript caller.
        print(json.dumps({"error": str(error)}))
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

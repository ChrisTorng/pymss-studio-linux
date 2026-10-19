"""Keep Linux venv launch paths intact in the bundled optional-package worker.

Apply only to the resource copy; tracked upstream Python sources stay unchanged.
Fail closed when upstream changes the affected expressions so the fix is reviewed.
"""

from pathlib import Path
import sys


def patch_source(source: str) -> str:
    replacements = {
        "executable = Path(sys.executable).resolve()":
            "executable = Path(sys.executable).absolute()",
        "executable = (executable or Path(sys.executable)).resolve()":
            "executable = (executable or Path(sys.executable)).absolute()",
    }
    for old, new in replacements.items():
        expected = 2 if old == "executable = Path(sys.executable).resolve()" else 1
        if source.count(old) != expected:
            raise ValueError("Review Linux optional-package overlay: upstream executable handling changed")
        source = source.replace(old, new)
    return source


if __name__ == "__main__":
    path = Path(sys.argv[1])
    path.write_text(patch_source(path.read_text(encoding="utf-8")), encoding="utf-8")
    print("Applied Linux optional-package venv compatibility overlay")

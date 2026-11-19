"""Run backend unit tests without pytest.

The repo has two test shapes:
  - unittest.TestCase classes (test_ai_job_rules, test_sprite_quality)
  - bare def test_* functions (test_ai_job_recovery, test_query_rewrite,
    test_video_reference_intents)

requirements.txt does not include pytest, so this runner gives one command
that covers both. Run inside the backend container:

    python scripts/run_unit_tests.py
"""

from __future__ import annotations

import importlib.util
import inspect
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TESTS_DIR = ROOT / "tests"


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    suite = unittest.TestSuite()
    bare_functions = []

    for path in sorted(TESTS_DIR.glob("test_*.py")):
        module = load_module(path)
        suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
        for name, fn in inspect.getmembers(module, inspect.isfunction):
            if name.startswith("test_") and fn.__module__ == module.__name__:
                bare_functions.append((path.name, name, fn))

    result = unittest.TextTestRunner(verbosity=2).run(suite)

    bare_failed = 0
    for filename, name, fn in bare_functions:
        try:
            fn()
            print(f"PASS {filename}::{name}")
        except Exception as exc:  # noqa: BLE001 - report the actual test failure
            bare_failed += 1
            print(f"FAIL {filename}::{name}: {exc}")

    print(
        f"RESULT unittest={result.testsRun} "
        f"failures={len(result.failures)} errors={len(result.errors)} "
        f"bare={len(bare_functions) - bare_failed}/{len(bare_functions)}"
    )
    return 0 if result.wasSuccessful() and bare_failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

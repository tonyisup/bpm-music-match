from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
VERIFIER = REPO_ROOT / "scripts" / "verify_gate.py"


def load_verifier():
    if not VERIFIER.exists():
        raise AssertionError(f"verifier must exist: {VERIFIER}")
    spec = importlib.util.spec_from_file_location("verify_gate", VERIFIER)
    if spec is None or spec.loader is None:
        raise AssertionError("cannot load verifier")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VerifyGateContractTests(unittest.TestCase):
    def test_stage_ids_and_order_are_stable(self):
        verifier = load_verifier()
        self.assertEqual(
            [stage.stage_id for stage in verifier.STAGES],
            ["runtime-version", "asset-integrity", "static-contract", "module-import", "node-tests"],
        )

    def test_exact_runtime_contract_fails_loudly(self):
        verifier = load_verifier()
        self.assertIsNone(verifier.validate_versions("3.13.7", "v22.22.3"))
        problem = verifier.validate_versions("3.13.8", "v22.22.3")
        self.assertIn("Python 3.13.7", problem)
        self.assertIn("got 3.13.8", problem)
        problem = verifier.validate_versions("3.13.7", "v22.23.0")
        self.assertIn("Node v22.22.3", problem)

    def test_failure_output_is_canonical_and_actionable(self):
        verifier = load_verifier()
        rendered = verifier.format_failure(
            stage_id="asset-integrity",
            problem="committed WAV differs",
            cause="actual=abc expected=def",
            rerun="python3 -m unittest -v scripts/test_generate_gate_track.py",
            fix="python3 scripts/generate_gate_track.py",
        )
        self.assertEqual(
            rendered.splitlines(),
            [
                "FAIL asset-integrity: committed WAV differs",
                "CAUSE: actual=abc expected=def",
                "RERUN: python3 -m unittest -v scripts/test_generate_gate_track.py",
                "FIX: python3 scripts/generate_gate_track.py",
            ],
        )


if __name__ == "__main__":
    unittest.main()

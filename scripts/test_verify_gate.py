from __future__ import annotations

import importlib.util
import re
import shlex
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
VERIFIER = REPO_ROOT / "scripts" / "verify_gate.py"
BROWSER_SMOKE = REPO_ROOT / "scripts" / "enrollment_browser_privacy_smoke.mjs"
ROOT_README = REPO_ROOT / "README.md"
EXPECTED_STAGE_IDS = [
    "runtime-version",
    "asset-integrity",
    "static-contract",
    "module-import",
    "node-tests",
    "enrollment-static-contract",
    "enrollment-module-import",
    "enrollment-node-tests",
    "enrollment-browser-privacy",
    "pages-staging",
]
EXPECTED_ENROLLMENT_MODULES = [
    "app.mjs",
    "enrollment-build.mjs",
    "enrollment-browser-load.mjs",
    "enrollment-browser-preview.mjs",
    "enrollment-browser-resources.mjs",
    "enrollment-browser-shared.mjs",
    "enrollment-browser.mjs",
    "enrollment-config.mjs",
    "enrollment-core.mjs",
    "enrollment-lifecycle.mjs",
    "enrollment-measurements.mjs",
    "enrollment-report.mjs",
]


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
        self.assertEqual([stage.stage_id for stage in verifier.STAGES], EXPECTED_STAGE_IDS)

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

        for stage in verifier.STAGES:
            is_command = stage.fix.startswith(("python3 ", "node "))
            is_documentation_anchor = re.fullmatch(
                r"[A-Za-z0-9_./-]+\.md#[a-z0-9-]+", stage.fix
            ) is not None
            self.assertTrue(
                is_command or is_documentation_anchor,
                f"{stage.stage_id} FIX is neither a command nor a documentation anchor: {stage.fix}",
            )
            if is_documentation_anchor:
                relative_path, fragment = stage.fix.split("#", 1)
                documentation = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
                heading_slugs = set()
                for line in documentation.splitlines():
                    if not line.startswith("#"):
                        continue
                    heading = line.lstrip("#").strip().lower()
                    heading = re.sub(r"[^a-z0-9 _-]", "", heading)
                    heading_slugs.add(re.sub(r"[ _]+", "-", heading))
                self.assertIn(
                    fragment, heading_slugs,
                    f"{stage.stage_id} FIX anchor does not resolve: {stage.fix}",
                )

    def test_explicit_enrollment_stages_run_the_required_surfaces(self):
        verifier = load_verifier()
        self.assertEqual(list(verifier.ENROLLMENT_SOURCE_MODULES), EXPECTED_ENROLLMENT_MODULES)
        recorded: list[list[str]] = []

        def record(command):
            recorded.append(command)
            return True, ""

        setattr(verifier, "run_command", record)
        for stage in verifier.STAGES[5:]:
            passed, output = verifier.execute_stage(stage)
            self.assertTrue(passed, stage.stage_id)
            self.assertEqual(output, "")

        self.assertEqual(
            recorded[0][3:],
            ["-v", "scripts/test_enrollment_static_contract.py"],
        )
        enrollment_import = recorded[1]
        self.assertEqual(enrollment_import[:3], ["node", "--input-type=module", "--eval"])
        for module_name in EXPECTED_ENROLLMENT_MODULES:
            self.assertIn(f"./tools/m2-enrollment/{module_name}", enrollment_import[3])
        self.assertEqual(recorded[2][:2], ["node", "--test"])
        self.assertIn("scripts/enrollment-download-artifacts.test.mjs", recorded[2][2:])
        self.assertTrue(
            all(
                path == "scripts/enrollment-download-artifacts.test.mjs"
                or path.startswith("tools/m2-enrollment/tests/")
                for path in recorded[2][2:]
            )
        )
        enrollment_node_stage = next(
            stage for stage in verifier.STAGES if stage.stage_id == "enrollment-node-tests"
        )
        self.assertIn("scripts/enrollment-download-artifacts.test.mjs", enrollment_node_stage.rerun)
        self.assertIn(enrollment_node_stage.rerun, ROOT_README.read_text(encoding="utf-8"))
        self.assertEqual(recorded[3], ["node", "scripts/enrollment_browser_privacy_smoke.mjs"])
        self.assertEqual(
            recorded[4][3:],
            ["-v", "scripts/test_stage_pages.py"],
        )

        import_stage = next(
            stage for stage in verifier.STAGES if stage.stage_id == "enrollment-module-import"
        )
        self.assertNotIn("<", import_stage.rerun)
        self.assertNotIn(">", import_stage.rerun)
        self.assertEqual(shlex.split(import_stage.rerun), enrollment_import)
        self.assertIn(import_stage.rerun, ROOT_README.read_text(encoding="utf-8"))

    def test_browser_smoke_discovers_fixed_macos_and_ubuntu_chrome_without_shell(self):
        source = BROWSER_SMOKE.read_text(encoding="utf-8")
        for candidate in [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ]:
            self.assertIn(candidate, source)
        self.assertIn("async function discoverChromeExecutable()", source)
        self.assertIn("constants.X_OK", source)
        self.assertIn("const chromePath = await discoverChromeExecutable();", source)
        self.assertIn("spawn(chromePath, [", source)
        self.assertNotIn("shell: true", source)
        command_discovery = re.compile(
            r"(?m)(?:^|[;&|]\s*)which\s+\S|command\s+-v(?:\s+|$)"
            r"|(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*['\"]which['\"]"
        )
        self.assertIsNone(command_discovery.search("a comment explaining which fixed path is used"))
        for invocation in ["which google-chrome", "command -v chromium", "spawn('which', ['chrome'])"]:
            self.assertIsNotNone(command_discovery.search(invocation), invocation)
        self.assertNotRegex(source, command_discovery)


if __name__ == "__main__":
    unittest.main()

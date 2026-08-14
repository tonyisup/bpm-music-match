from __future__ import annotations

import json
import re
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPIKE_ROOT = REPO_ROOT / "spikes" / "001-mobile-web-audio-gate"
ENROLLMENT_ROOT = REPO_ROOT / "tools" / "m2-enrollment"


class ContractParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.start_tags: list[tuple[str, dict[str, str | None]]] = []
        self.h1_count = 0
        self.in_h1 = False
        self.h1_text = ""
        self.module_scripts: list[dict[str, str | None]] = []
        self.inline_module_text = ""
        self.in_inline_module = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        self.start_tags.append((tag, values))
        if tag == "h1":
            self.h1_count += 1
            self.in_h1 = True
        if tag == "script" and values.get("type") == "module":
            self.module_scripts.append(values)
            if "src" not in values:
                self.in_inline_module = True

    def handle_endtag(self, tag):
        if tag == "h1":
            self.in_h1 = False
        if tag == "script":
            self.in_inline_module = False

    def handle_data(self, data):
        if self.in_h1:
            self.h1_text += data
        if self.in_inline_module:
            self.inline_module_text += data

    def elements(self, tag):
        return [attrs for found_tag, attrs in self.start_tags if found_tag == tag]


def source_between(test_case, source, start_marker, end_marker):
    start = source.find(start_marker)
    test_case.assertNotEqual(start, -1, f"missing source marker: {start_marker}")
    end = source.find(end_marker, start)
    test_case.assertNotEqual(end, -1, f"missing source marker after start: {end_marker}")
    return source[start:end]


class StaticGateContractTests(unittest.TestCase):
    def setUp(self):
        self.html_path = SPIKE_ROOT / "index.html"
        self.css_path = SPIKE_ROOT / "styles.css"
        self.html = self.html_path.read_text()
        self.parser = ContractParser()
        self.parser.feed(self.html)

    def element_by_id(self, tag, element_id):
        return next(attrs for attrs in self.parser.elements(tag) if attrs.get("id") == element_id)

    def test_semantic_single_screen_and_permanent_control_slots(self):
        self.assertEqual(len(self.parser.elements("main")), 1)
        self.assertEqual(self.parser.h1_count, 1)
        self.assertEqual(self.parser.h1_text.strip(), "Android audio gate")

        primary = self.element_by_id("button", "primary-action")
        stop = self.element_by_id("button", "stop-action")
        self.assertEqual(primary.get("type"), "button")
        self.assertEqual(stop.get("type"), "button")
        self.assertIn("disabled", primary)
        self.assertIn("disabled", stop)

        details = self.element_by_id("details", "diagnostics")
        self.assertNotIn("open", details)
        diagnostics_body = self.element_by_id("div", "diagnostics-body")
        self.assertEqual(diagnostics_body.get("aria-live"), "off")
        status = self.element_by_id("p", "status")
        self.assertEqual(status.get("aria-live"), "polite")

    def test_viewport_commit_and_module_entrypoint_are_deployable(self):
        metas = self.parser.elements("meta")
        viewport = next(meta for meta in metas if meta.get("name") == "viewport")
        self.assertEqual(viewport.get("content"), "width=device-width, initial-scale=1")
        commit = next(meta for meta in metas if meta.get("name") == "build-commit")
        self.assertEqual(commit.get("content"), "__BUILD_COMMIT__")
        self.assertEqual(len(self.parser.module_scripts), 1)
        self.assertIn("import { main } from './app.mjs'", self.parser.inline_module_text)
        self.assertIn("main();", self.parser.inline_module_text)
        self.assertIn('href="./styles.css"', self.html)

    def test_gate_contains_no_provider_file_input_or_timing_visualization(self):
        self.assertEqual(self.parser.elements("input"), [])
        forbidden = ["youtube", "file picker", "waveform", "progress bar", "beat pulse", "countdown"]
        lowered = self.html.lower()
        for phrase in forbidden:
            self.assertNotIn(phrase, lowered)

    def test_runtime_has_one_raw_audio_context_and_no_media_element_escape_path(self):
        app = (SPIKE_ROOT / "app.mjs").read_text()
        engine = (SPIKE_ROOT / "audio-engine.mjs").read_text()
        self.assertEqual(app.count("new AudioContextCtor()"), 1)
        self.assertNotIn("new Audio(", app + engine)
        self.assertNotIn("createMediaElementSource", app + engine)
        self.assertIn("createBufferSource", engine)
        self.assertEqual(self.parser.elements("audio"), [])
        self.assertEqual(self.parser.elements("video"), [])
        for module_name in ["app.mjs", "audio-engine.mjs", "audio-math.mjs"]:
            module = (SPIKE_ROOT / module_name).read_text()
            self.assertEqual(module.count("__BUILD_COMMIT__"), 1, module_name)

    def test_css_enforces_mobile_accessibility_and_safe_area_contract(self):
        css = self.css_path.read_text()
        for required in [
            "min-height: 56px", "min-width: 48px", "max-width: 36rem",
            "env(safe-area-inset-top)", "env(safe-area-inset-bottom)",
            ":focus-visible", "prefers-reduced-motion", "overflow-wrap: anywhere",
        ]:
            self.assertIn(required, css)
        self.assertNotIn("linear-gradient", css)
        self.assertNotIn("box-shadow", css)

    def test_calibration_has_one_canonical_bounded_trim_record(self):
        calibration = json.loads((SPIKE_ROOT / "calibration.json").read_text())
        self.assertEqual(set(calibration), {"trackTrim", "percussionTrim", "masterGain"})
        self.assertEqual(calibration, {"trackTrim": 0.7, "percussionTrim": 0.35, "masterGain": 0.8})

    def test_pages_workflow_is_pr_safe_and_deploys_only_push_main(self):
        workflow = (REPO_ROOT / ".github" / "workflows" / "deploy-pages.yml").read_text()
        expected_actions = {
            "actions/checkout": ("3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"),
            "actions/setup-python": ("5fda3b95a4ea91299a34e894583c3862153e4b97", "v7.0.0"),
            "actions/setup-node": ("820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"),
            "actions/configure-pages": ("45bfe0192ca1faeb007ade9deae92b16b8254a0d", "v6.0.0"),
            "actions/upload-pages-artifact": ("fc324d3547104276b827a68afc52ff2a11cc49c9", "v5.0.0"),
            "actions/deploy-pages": ("cd2ce8fcbc39b97be8ca5fce6e763baed58fa128", "v5.0.0"),
        }
        for action, (commit, tag) in expected_actions.items():
            self.assertIn(f"{action}@{commit} # {tag}", workflow)
        self.assertIsNone(re.search(r"uses:\s+[^\s]+@v\d", workflow))
        self.assertIn("pull_request:", workflow)
        self.assertIn("push:\n    branches: [main]", workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertEqual(workflow.count("python3 scripts/verify_gate.py"), 1)
        self.assertEqual(workflow.count('python3 scripts/stage_pages.py "$GITHUB_SHA" _site'), 2)
        for forbidden in [
            "node --test", "python3 -m unittest", "test_generate_gate_track.py",
            "test_static_contract.py", "cp ", "rm -rf", "mkdir ", "python3 - <<",
            "__BUILD_COMMIT__",
        ]:
            self.assertNotIn(forbidden, workflow)
        self.assertIn("python-version: '3.13.7'", workflow)
        self.assertIn("node-version: '22.22.3'", workflow)
        self.assertEqual(workflow.count("fetch-depth: 0"), 2)
        self.assertEqual(workflow.count("persist-credentials: false"), 2)
        self.assertEqual(workflow.count("GITHUB_SHA: ${{ github.sha }}"), 2)
        self.assertIn("group: pages-${{ github.ref }}", workflow)
        self.assertIn("cancel-in-progress: true", workflow)
        self.assertIn("path: _site", workflow)

        verify_job, deploy_job = workflow.split("\n  deploy:", maxsplit=1)
        self.assertIn("verify-and-stage:", verify_job)
        self.assertIn("permissions:\n      contents: read", verify_job)
        for forbidden in [
            "pages: write", "id-token: write", "environment:",
            "actions/configure-pages", "actions/upload-pages-artifact", "actions/deploy-pages",
        ]:
            self.assertNotIn(forbidden, verify_job)

        self.assertIn("if: github.event_name == 'push' && github.ref == 'refs/heads/main'", deploy_job)
        self.assertIn("environment:\n      name: github-pages", deploy_job)
        self.assertIn("permissions:\n      contents: read\n      pages: write\n      id-token: write", deploy_job)
        self.assertEqual(deploy_job.count("actions/configure-pages@"), 1)
        self.assertEqual(deploy_job.count("actions/upload-pages-artifact@"), 1)
        self.assertEqual(deploy_job.count("actions/deploy-pages@"), 1)

    def test_enrollment_source_modules_have_structural_local_build_identity(self):
        enrollment_root = REPO_ROOT / "tools" / "m2-enrollment"
        executable_modules = [
            "app.mjs",
            "enrollment-config.mjs",
            "enrollment-browser.mjs",
            "enrollment-browser-load.mjs",
            "enrollment-browser-preview.mjs",
            "enrollment-browser-resources.mjs",
            "enrollment-browser-shared.mjs",
            "enrollment-lifecycle.mjs",
            "enrollment-measurements.mjs",
            "enrollment-report.mjs",
        ]
        for module_name in executable_modules:
            source = (enrollment_root / module_name).read_text(encoding="utf-8")
            self.assertIn(
                "import { assertEnrollmentBuildCommit } from './enrollment-build.mjs';",
                source,
                module_name,
            )
            self.assertEqual(
                source.count("assertEnrollmentBuildCommit('__ENROLLMENT_BUILD_COMMIT__');"),
                1,
                module_name,
            )
            self.assertEqual(source.count("__ENROLLMENT_BUILD_COMMIT__"), 1, module_name)

        identity = (enrollment_root / "enrollment-build.mjs").read_text(encoding="utf-8")
        self.assertEqual(identity.count("__ENROLLMENT_BUILD_COMMIT__"), 1)
        app = (enrollment_root / "app.mjs").read_text(encoding="utf-8")
        html_startup = source_between(
            self,
            app,
            "assertEnrollmentHtmlBuildCommit(documentValue);",
            "createEnrollmentBrowserController({",
        )
        source_between(
            self,
            html_startup,
            "assertEnrollmentHtmlBuildCommit(documentValue);",
            "const status = element(documentValue, 'status');",
        )

    def test_identity_wiring_adds_no_exports_to_existing_enrollment_modules(self):
        expected = {
            "app.mjs": ["assembleEnrollmentConfig", "capturePrivateFileSelection", "createCancellationUiOutcome", "createEnrollmentWorkflow", "createReportExport", "createUiOperationGate", "isCleanApplicationTeardownResult", "main"],
            "enrollment-config.mjs": ["ENROLLMENT_CONFIG"],
            "enrollment-browser.mjs": ["createEnrollmentBrowserController"],
            "enrollment-browser-load.mjs": ["createLoadBoundary"],
            "enrollment-browser-preview.mjs": ["createPreviewLifecycle"],
            "enrollment-browser-resources.mjs": ["createResourceBoundary"],
            "enrollment-browser-shared.mjs": ["COUNTER_KEYS", "EnrollmentBrowserError", "copyCounters", "copyCycle", "copyTeardownResult", "createDeferred", "isObjectLike", "operationOutcome", "typedError"],
            "enrollment-core.mjs": ["analyzeCueEnergy", "createSanitizedReport", "evaluateApplicationMemoryContract", "preflightCompressedBytes", "serializeSanitizedReport", "validateDecodedBounds", "validateTimingBounds"],
            "enrollment-lifecycle.mjs": ["createApplicationMemoryEvidence", "evaluateApplicationMemoryContract"],
            "enrollment-measurements.mjs": ["MEASUREMENT_LIMITS", "analyzeCueEnergy", "preflightCompressedBytes", "validateDecodedBounds", "validateTimingBounds"],
            "enrollment-report.mjs": ["createSanitizedReport", "serializeSanitizedReport"],
        }
        script = """
          const expected = JSON.parse(process.argv[1]);
          const actual = {};
          for (const name of Object.keys(expected)) {
            actual[name] = Object.keys(await import(`./tools/m2-enrollment/${name}`)).sort();
          }
          process.stdout.write(JSON.stringify(actual));
        """
        completed = subprocess.run(
            ["node", "--input-type=module", "--eval", script, json.dumps(expected)],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(json.loads(completed.stdout), expected)

    def test_documentation_forms_one_executable_path_without_calibration_duplication(self):
        root_readme = (REPO_ROOT / "README.md").read_text()
        spike_readme = (SPIKE_ROOT / "README.md").read_text()
        worksheet = (SPIKE_ROOT / "validation" / "gate-1.md").read_text()

        for required in [
            "Python 3.13.7", "Node v22.22.3", "/usr/local/bin/python3.13 scripts/verify_gate.py",
            "scripts/stage_one_track_local.py", "http://127.0.0.1:8000/?run=session-1",
            "gh auth status", "build_type=workflow",
            "gh run watch", "PASS runtime-version", "PASS asset-integrity",
            "PASS static-contract", "PASS module-import", "PASS node-tests",
            "PASS enrollment-static-contract", "PASS enrollment-module-import",
            "PASS enrollment-node-tests", "PASS one-track-static-contract",
            "PASS one-track-module-import", "PASS one-track-node-tests",
            "PASS enrollment-browser-privacy", "PASS pages-staging", "PASS gate 13/13",
        ]:
            self.assertIn(required, root_readme)
        for stage_id in [
            "runtime-version", "asset-integrity", "static-contract", "module-import", "node-tests",
            "enrollment-static-contract", "enrollment-module-import", "enrollment-node-tests",
            "one-track-static-contract", "one-track-module-import", "one-track-node-tests",
            "enrollment-browser-privacy", "pages-staging",
        ]:
            self.assertIn(stage_id, root_readme)
        for error_code in [
            "asset-fetch-failed", "metadata-invalid", "asset-integrity-failed", "module-identity-failed", "decode-failed",
            "load-timeout", "resume-failed", "startup-timeout", "schedule-failed", "context-close-failed",
        ]:
            self.assertIn(error_code, root_readme)

        for required in [
            "one `AudioContext`", "first terminal cause wins", "20 ms", "25 ms", "100 ms",
            "calibration.json", "reload", "Android Chrome",
        ]:
            self.assertIn(required, spike_readme)
        self.assertNotRegex(root_readme + spike_readme, r"trackTrim[^\n]*(?:0\.7|70%)")
        self.assertNotRegex(root_readme + spike_readme, r"percussionTrim[^\n]*(?:0\.35|35%)")

        for required in [
            "Exact Android device model", "Android version", "Chrome version", "Commit SHA",
            "Workflow URL", "Served HTTPS URL", "Pre-trial identity snapshot", "Post-calibration identity snapshot",
            "activeSourceCount", "teardownSettled", "finalContextState", "Technical verdict",
            "Sonic scent verdict", "Product magic verdict", "README-to-Ready",
        ]:
            self.assertIn(required, worksheet)

    def test_enrollment_documentation_is_one_private_pixel_runbook(self):
        enrollment_readme_path = ENROLLMENT_ROOT / "README.md"
        self.assertTrue(enrollment_readme_path.is_file(), "missing private enrollment runbook")
        enrollment_readme = enrollment_readme_path.read_text(encoding="utf-8")
        root_readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        design = (
            REPO_ROOT / "docs" / "design" / "2026-07-24-milestone-2-one-track-vertical-slice.md"
        ).read_text(encoding="utf-8")

        self.assertIn("[Private enrollment runbook](tools/m2-enrollment/README.md)", root_readme)
        self.assertIn("https://tonyisup.github.io/bpm-music-match/enroll/", root_readme)
        self.assertIn("public enrollment bootstrap URL", root_readme)
        self.assertNotIn("private bootstrap URL", root_readme)
        self.assertIn("### Enrollment bootstrap exception", design)

        for required in [
            "bootstrap exception", "Pixel 8 Pro", "Android 16 build `CP1A.260505.005`",
            "Chrome `150.0.7871.181`", "https://tonyisup.github.io/bpm-music-match/enroll/",
            "same local MP3", "1:1", "110 BPM", "Play preview", "Use preview time",
            "Analyze cue", "Unload", "two matching clean cycles", "m2-enrollment-report.json",
            "`assetIdentity`", "`experimentConfigIdentity`", "Never upload or send the MP3",
            "does not authorize Milestone 2 product implementation", "browser/native memory release",
            "python3 scripts/verify_gate.py", "git diff HEAD --check", "git diff --check",
            "EXPECTED_DEPLOY_SHA=$(git rev-parse HEAD)",
            "enrollment-build.mjs?v=<EXPECTED_DEPLOY_SHA>", "ENROLLMENT_BUILD_COMMIT",
        ]:
            self.assertIn(required, enrollment_readme)

        ordered_pixel_steps = [
            "1. Open the deployed `/enroll/` utility",
            "2. Select the candidate MP3",
            "3. Preview and confirm the target downbeat",
            "4. Confirm the configured 110 BPM",
            "5. Unload the first cycle",
            "6. Select the same local MP3 again",
            "7. Repeat preview and cue analysis",
            "8. Unload the second cycle",
            "9. Download `m2-enrollment-report.json`",
        ]
        pixel_step_sections = [
            source_between(self, enrollment_readme, start_step, end_step)
            for start_step, end_step in zip(ordered_pixel_steps, ordered_pixel_steps[1:])
        ]

        deployment_step = pixel_step_sections[0]
        for required in ["expected full SHA", "exactly equals", "before selecting"]:
            self.assertIn(required, deployment_step)

        bpm_step = pixel_step_sections[3]
        for required in [
            "45th", "44 beat intervals", "24.0 seconds", "three times", "±0.25 seconds",
            "all three", "half-time", "double-time", "`trackBpm: 110`",
        ]:
            self.assertIn(required, bpm_step)

        for forbidden in [
            "upload the MP3 to", "send the MP3 to", "browser memory was released",
            "native memory was released", "Milestone 2 implementation is authorized",
            "deployed utility has no network",
        ]:
            self.assertNotIn(forbidden, enrollment_readme)


if __name__ == "__main__":
    unittest.main()

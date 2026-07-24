from __future__ import annotations

import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPIKE_ROOT = REPO_ROOT / "spikes" / "001-mobile-web-audio-gate"


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

    def test_pages_workflow_is_immutable_least_privilege_and_uses_only_the_verifier(self):
        workflow = (REPO_ROOT / ".github" / "workflows" / "deploy-pages.yml").read_text()
        expected_actions = {
            "actions/checkout": ("11d5960a326750d5838078e36cf38b85af677262", "v4"),
            "actions/setup-python": ("a26af69be951a213d495a4c3e4e4022e16d87065", "v5"),
            "actions/setup-node": ("49933ea5288caeca8642d1e84afbd3f7d6820020", "v4"),
            "actions/configure-pages": ("983d7736d9b0ae728b81ab479565c72886d7745b", "v5"),
            "actions/upload-pages-artifact": ("56afc609e74202658d3ffba0e8f6dda462b719fa", "v3"),
            "actions/deploy-pages": ("d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e", "v4"),
        }
        for action, (commit, tag) in expected_actions.items():
            self.assertIn(f"{action}@{commit} # {tag}", workflow)
        self.assertIsNone(re.search(r"uses:\s+[^\s]+@v\d", workflow))
        self.assertEqual(workflow.count("python3 scripts/verify_gate.py"), 1)
        for forbidden in ["node --test", "python3 -m unittest", "test_generate_gate_track.py", "test_static_contract.py"]:
            self.assertNotIn(forbidden, workflow)
        self.assertIn("python-version: '3.13.7'", workflow)
        self.assertIn("node-version: '22.22.3'", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn("pages: write", workflow)
        self.assertIn("id-token: write", workflow)
        self.assertIn("cancel-in-progress: true", workflow)
        self.assertIn("__BUILD_COMMIT__", workflow)
        self.assertIn("GITHUB_SHA", workflow)
        self.assertIn("path: _site", workflow)
        self.assertNotIn("cp -R spikes/001-mobile-web-audio-gate/. _site/", workflow)
        for public_file in [
            "index.html", "styles.css", "app.mjs", "audio-engine.mjs", "audio-math.mjs",
            "asset-metadata.json", "calibration.json", "assets/gate-track.wav",
        ]:
            self.assertIn(public_file, workflow)

    def test_documentation_forms_one_executable_path_without_calibration_duplication(self):
        root_readme = (REPO_ROOT / "README.md").read_text()
        spike_readme = (SPIKE_ROOT / "README.md").read_text()
        worksheet = (SPIKE_ROOT / "validation" / "gate-1.md").read_text()

        for required in [
            "Python 3.13.7", "Node v22.22.3", "python3 scripts/verify_gate.py",
            "python3 -m http.server 8000 --bind 127.0.0.1 --directory spikes/001-mobile-web-audio-gate",
            "http://127.0.0.1:8000/", "gh auth status", "build_type=workflow",
            "gh run watch", "PASS runtime-version", "PASS asset-integrity",
            "PASS static-contract", "PASS module-import", "PASS node-tests", "PASS gate 5/5",
        ]:
            self.assertIn(required, root_readme)
        for stage_id in ["runtime-version", "asset-integrity", "static-contract", "module-import", "node-tests"]:
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


if __name__ == "__main__":
    unittest.main()

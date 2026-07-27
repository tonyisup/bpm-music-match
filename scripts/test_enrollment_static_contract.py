from __future__ import annotations

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ENROLLMENT_ROOT = REPO_ROOT / "tools" / "m2-enrollment"
EXACT_CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; "
    "media-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; "
    "base-uri 'none'"
)


class EnrollmentParser(HTMLParser):
    VOID_ELEMENTS = frozenset({
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
        "param", "source", "track", "wbr",
    })

    def __init__(self):
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []
        self.text_by_id: dict[str, str] = {}
        self._open_ids: list[str | None] = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        self.tags.append((tag, values))
        if tag not in self.VOID_ELEMENTS:
            self._open_ids.append(values.get("id"))

    def handle_startendtag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

    def handle_endtag(self, tag):
        del tag
        if self._open_ids:
            self._open_ids.pop()

    def handle_data(self, data):
        for element_id in reversed(self._open_ids):
            if element_id is not None:
                self.text_by_id[element_id] = self.text_by_id.get(element_id, "") + data
                break

    def elements(self, tag):
        return [attrs for found_tag, attrs in self.tags if found_tag == tag]

    def by_id(self, tag, element_id):
        return next(
            attrs
            for found_tag, attrs in self.tags
            if found_tag == tag and attrs.get("id") == element_id
        )


def source_between(test_case, source, start_marker, end_marker):
    start = source.find(start_marker)
    test_case.assertNotEqual(start, -1, f"missing source marker: {start_marker}")
    end = source.find(end_marker, start)
    test_case.assertNotEqual(end, -1, f"missing source marker after start: {end_marker}")
    return source[start:end]


class EnrollmentStaticContractTests(unittest.TestCase):
    def setUp(self):
        self.html_path = ENROLLMENT_ROOT / "index.html"
        self.css_path = ENROLLMENT_ROOT / "styles.css"
        self.app_path = ENROLLMENT_ROOT / "app.mjs"
        self.browser_path = ENROLLMENT_ROOT / "enrollment-browser.mjs"
        self.config_path = ENROLLMENT_ROOT / "enrollment-config.mjs"
        self.html = self.html_path.read_text()
        self.css = self.css_path.read_text()
        self.app = self.app_path.read_text()
        self.browser = self.browser_path.read_text()
        self.config = self.config_path.read_text()
        self.parser = EnrollmentParser()
        self.parser.feed(self.html)

    def test_exact_csp_external_assets_and_frame_rejection(self):
        metas = self.parser.elements("meta")
        csp = next(
            meta
            for meta in metas
            if (meta.get("http-equiv") or "").lower() == "content-security-policy"
        )
        self.assertEqual(csp.get("content"), EXACT_CSP)
        viewport = next(meta for meta in metas if meta.get("name") == "viewport")
        self.assertEqual(viewport.get("content"), "width=device-width, initial-scale=1")
        build_commit = next(meta for meta in metas if meta.get("name") == "build-commit")
        self.assertEqual(build_commit.get("content"), "__ENROLLMENT_BUILD_COMMIT__")
        self.assertEqual(
            [script.get("src") for script in self.parser.elements("script")],
            ["./app.mjs?v=__ENROLLMENT_BUILD_COMMIT__"],
        )
        self.assertTrue(all(script.get("type") == "module" for script in self.parser.elements("script")))
        self.assertIn('href="./styles.css"', self.html)
        self.assertNotIn("<style", self.html.lower())
        self.assertIn("window.top !== window.self", self.app)

    def test_one_labeled_audio_picker_and_numeric_downbeat(self):
        h1s = self.parser.elements("h1")
        self.assertEqual(len(h1s), 1)
        file_inputs = [
            element
            for element in self.parser.elements("input")
            if element.get("type") == "file"
        ]
        self.assertEqual(len(file_inputs), 1)
        file_input = file_inputs[0]
        self.assertEqual(file_input.get("id"), "track-file")
        self.assertEqual(file_input.get("accept"), ".mp3,audio/mpeg")
        self.assertTrue(any(label.get("for") == "track-file" for label in self.parser.elements("label")))

        downbeat = self.parser.by_id("input", "downbeat-seconds")
        self.assertEqual(downbeat.get("type"), "number")
        self.assertEqual(downbeat.get("inputmode"), "decimal")
        self.assertTrue(any(label.get("for") == "downbeat-seconds" for label in self.parser.elements("label")))

    def test_required_raw_audio_controls_and_initial_report_gates(self):
        expected_button_text = {
            "cancel-load": "Cancel load",
            "play-preview": "Play preview",
            "stop-preview": "Stop preview",
            "use-preview-time": "Use preview time",
            "analyze-cue": "Analyze cue",
            "unload-track": "Unload",
            "copy-report": "Copy report",
            "download-report": "Download report",
        }
        for button_id, text in expected_button_text.items():
            button = self.parser.by_id("button", button_id)
            self.assertEqual(button.get("type"), "button")
            self.assertEqual(self.parser.text_by_id.get(button_id, "").strip(), text)
        self.assertIn("disabled", self.parser.by_id("button", "copy-report"))
        self.assertIn("disabled", self.parser.by_id("button", "download-report"))

        bpm_confirmation = self.parser.by_id("input", "confirm-bpm")
        self.assertEqual(bpm_confirmation.get("type"), "checkbox")
        self.assertTrue(any(label.get("for") == "confirm-bpm" for label in self.parser.elements("label")))
        status = self.parser.by_id("p", "status")
        self.assertEqual(status.get("role"), "status")
        self.assertEqual(status.get("aria-live"), "polite")
        self.assertEqual(self.parser.by_id("pre", "report-output").get("aria-live"), "off")

    def test_live_status_reserves_initial_flow_space_and_sticks_at_the_top(self):
        status_index = self.html.index('id="status"')
        first_region_index = self.html.index("<section")
        self.assertLess(status_index, first_region_index)
        status_rule = re.search(r"\.status\s*\{(?P<body>.*?)\}", self.css, re.DOTALL)
        if status_rule is None:
            self.fail("missing .status CSS rule")
        body = status_rule.group("body")
        self.assertIn("position: sticky", body)
        self.assertRegex(body, r"\btop\s*:")
        self.assertNotRegex(body, r"\bbottom\s*:")

    def test_static_config_import_and_no_runtime_config_request(self):
        self.assertEqual(
            self.app.count("import { ENROLLMENT_CONFIG } from './enrollment-config.mjs';"),
            1,
        )
        self.assertNotRegex(self.app, r"import\s*\(")
        self.assertNotRegex(self.app, r"fetch\s*\(")
        self.assertIn("trustedConfig !== ENROLLMENT_CONFIG", self.app)
        self.assertIn("trackBpmVerified", self.app)
        self.assertNotIn("File.name", self.config)
        self.assertNotIn("File.type", self.config)

    def test_public_graph_has_no_network_persistence_media_or_object_url_escape(self):
        public_files = [
            "index.html",
            "styles.css",
            "app.mjs",
            "enrollment-build.mjs",
            "enrollment-config.mjs",
            "enrollment-browser.mjs",
            "enrollment-browser-load.mjs",
            "enrollment-browser-preview.mjs",
            "enrollment-browser-resources.mjs",
            "enrollment-browser-shared.mjs",
            "enrollment-measurements.mjs",
            "enrollment-report.mjs",
            "enrollment-lifecycle.mjs",
        ]
        source = "\n".join((ENROLLMENT_ROOT / name).read_text() for name in public_files)
        forbidden_patterns = {
            "XMLHttpRequest": r"\bXMLHttpRequest\b",
            "WebSocket": r"\bWebSocket\b",
            "EventSource": r"\bEventSource\b",
            "sendBeacon": r"\bsendBeacon\b",
            "localStorage": r"\blocalStorage\b",
            "sessionStorage": r"\bsessionStorage\b",
            "indexedDB": r"\bindexedDB\b",
            "serviceWorker": r"\bserviceWorker\b",
            "object URL": r"\bcreateObjectURL\b",
            "media element": r"\bcreateMediaElementSource\b|new\s+Audio\s*\(",
            "form submit": r"\.submit\s*\(",
            "network fetch": r"\bfetch\s*\(",
            "console logging": r"\bconsole\s*\.",
        }
        for label, pattern in forbidden_patterns.items():
            self.assertIsNone(re.search(pattern, source), label)
        self.assertEqual(self.parser.elements("form"), [])
        self.assertEqual(self.parser.elements("audio"), [])
        self.assertEqual(self.parser.elements("video"), [])
        self.assertEqual(self.parser.elements("object"), [])
        self.assertNotIn("tests/fixtures", source)
        self.assertNotIn("synthetic-enrollment.mp3", source)

    def test_real_browser_success_protocol_previews_and_analyzes_both_cycles(self):
        smoke = (REPO_ROOT / "scripts" / "enrollment_browser_privacy_smoke.mjs").read_text(
            encoding="utf-8"
        )
        protocol = source_between(
            self,
            smoke,
            "async function completeTwoCycleReport",
            "\nasync function runCopyPagehideScenario",
        )

        for selector in ["#play-preview", "#use-preview-time", "#stop-preview", "#analyze-cue"]:
            self.assertEqual(protocol.count(f"await click(cdp, scenario, '{selector}')"), 2)
        self.assertEqual(protocol.count("await click(cdp, scenario, '#unload-track')"), 2)

        self.assertIn("workflow.acceptPreview();", self.app)
        self.assertIn(
            "controls.analyze.disabled = !loadedReady || !model.previewConfirmed || operationPending;",
            self.app,
        )

    def test_browser_harness_and_ui_guards_fail_closed(self):
        smoke = (REPO_ROOT / "scripts" / "enrollment_browser_privacy_smoke.mjs").read_text(
            encoding="utf-8"
        )
        download_wait = source_between(
            self,
            smoke,
            "async function waitForDownload",
            "\nasync function completeTwoCycleReport",
        )
        self.assertIn("try {", download_wait)
        self.assertIn("} finally {\n    remove();\n  }", download_wait)

        self.assertIn("owner === null", self.browser)
        self.assertIn("import { COUNTER_KEYS } from './enrollment-browser-shared.mjs';", self.app)
        self.assertNotIn("const COUNTER_KEYS =", self.app)
        self.assertNotIn("const APPLICATION_COUNTER_KEYS =", self.app)
        self.assertIn("controls.bpm.checked = model.bpmConfirmed;", self.app)
        bpm_change = source_between(
            self,
            self.app,
            "function applyConfiguredBpmChange",
            "\nexport function main",
        )
        self.assertIn("try {", bpm_change)
        self.assertIn("} catch {", bpm_change)
        self.assertEqual(bpm_change.count("render();"), 2)
        self.assertIn("Configured BPM confirmation could not be updated.", bpm_change)

        preview_group = next(
            attrs
            for attrs in self.parser.elements("div")
            if attrs.get("aria-label") == "Raw Web Audio preview controls"
        )
        self.assertEqual(preview_group.get("role"), "group")
        self.assertEqual(preview_group.get("aria-label"), "Raw Web Audio preview controls")

    def test_parser_keeps_text_ownership_across_void_elements(self):
        parser = EnrollmentParser()
        parser.feed(
            '<div id="owner">before<input id="void-control">after<br>done'
            '<img id="void-image"/>tail</div>'
        )
        self.assertEqual(parser.text_by_id, {"owner": "beforeafterdonetail"})

    def test_mobile_accessibility_safe_area_and_reduced_motion_contract(self):
        for required in [
            "min-width: 48px",
            "min-height: 56px",
            ":focus-visible",
            "env(safe-area-inset-top)",
            "env(safe-area-inset-right)",
            "env(safe-area-inset-bottom)",
            "env(safe-area-inset-left)",
            "prefers-reduced-motion: reduce",
            "overflow-wrap: anywhere",
        ]:
            self.assertIn(required, self.css)
        self.assertNotIn("—", self.html)
        self.assertNotIn("–", self.html)
        self.assertNotIn("—", self.app)
        self.assertNotIn("–", self.app)
        label_targets = {label.get("for") for label in self.parser.elements("label")}
        input_ids = {element.get("id") for element in self.parser.elements("input")}
        self.assertTrue(input_ids.issubset(label_targets))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
STAGER_PATH = REPO_ROOT / "scripts" / "stage_pages.py"
MANIFEST_PATH = REPO_ROOT / "scripts" / "gate1-public-manifest.json"
ACCEPTED_GATE1_COMMIT = "11df30f6f6cf90940bee425847614abaf26cc6f1"
DEPLOY_COMMIT = "0123456789abcdef0123456789abcdef01234567"
OTHER_COMMIT = "89abcdef0123456789abcdef0123456789abcdef"
ROOT_FILES = {
    "index.html",
    "styles.css",
    "app.mjs",
    "audio-engine.mjs",
    "audio-math.mjs",
    "asset-metadata.json",
    "calibration.json",
    "assets/gate-track.wav",
}
ENROLLMENT_FILES = {
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
    "enrollment-lifecycle.mjs",
    "enrollment-measurements.mjs",
    "enrollment-report.mjs",
}
AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".aif", ".wma",
}


def load_stager():
    if not STAGER_PATH.exists():
        raise AssertionError("Task 4 staging module must exist")
    spec = importlib.util.spec_from_file_location("stage_pages", STAGER_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("cannot load staging module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def relative_files(root: Path) -> set[str]:
    return {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file()
    }


class StagePagesTests(unittest.TestCase):
    def setUp(self):
        self.stager = load_stager()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.temp_root = Path(self.temporary.name)

    def stage(self, output_name: str = "site") -> Path:
        output = self.temp_root / output_name
        self.stager.stage_pages(DEPLOY_COMMIT, output)
        return output

    def fixture_repo(self) -> Path:
        fixture = self.temp_root / "fixture-repo"
        shutil.copytree(REPO_ROOT / "spikes", fixture / "spikes")
        shutil.copytree(REPO_ROOT / "tools" / "m2-enrollment", fixture / "tools" / "m2-enrollment")
        return fixture

    def write_manifest_variant(self, mutate) -> Path:
        document = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        mutate(document)
        path = self.temp_root / "manifest.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        return path

    def test_manifest_has_closed_exact_gate1_allowlist_and_fixed_identity(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.assertEqual(set(manifest), {"schemaVersion", "acceptedCommit", "files"})
        self.assertEqual(manifest["schemaVersion"], 1)
        self.assertEqual(manifest["acceptedCommit"], ACCEPTED_GATE1_COMMIT)
        self.assertEqual(len(manifest["files"]), len(ROOT_FILES))
        self.assertEqual(
            {entry["destination"] for entry in manifest["files"]},
            ROOT_FILES,
        )
        self.assertEqual(
            {entry["source"] for entry in manifest["files"]},
            {f"spikes/001-mobile-web-audio-gate/{path}" for path in ROOT_FILES},
        )
        for entry in manifest["files"]:
            self.assertEqual(set(entry), {"source", "destination", "sha256"})
            self.assertRegex(entry["sha256"], r"^[0-9a-f]{64}$")

    def test_gate1_sources_still_match_all_eight_paths_at_accepted_commit(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        for entry in manifest["files"]:
            current = (REPO_ROOT / entry["source"]).read_bytes()
            accepted = subprocess.run(
                ["git", "show", f"{ACCEPTED_GATE1_COMMIT}:{entry['source']}"],
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
            ).stdout
            self.assertEqual(current, accepted, entry["source"])

    def test_stage_contains_only_fixed_root_and_transitive_enrollment_graph(self):
        output = self.stage()
        self.assertEqual(
            relative_files(output),
            ROOT_FILES | {f"enroll/{path}" for path in ENROLLMENT_FILES},
        )
        forbidden_names = {
            "enrollment-core.mjs", "README.md", "synthetic-enrollment.mp3", "app.test.mjs",
        }
        self.assertTrue(forbidden_names.isdisjoint({path.name for path in output.rglob("*")}))
        self.assertFalse(any(path.suffix.lower() in AUDIO_EXTENSIONS for path in (output / "enroll").rglob("*")))

    def test_staged_root_bytes_match_manifest_after_fixed_commit_render(self):
        output = self.stage()
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        for entry in manifest["files"]:
            staged = (output / entry["destination"]).read_bytes()
            self.assertEqual(hashlib.sha256(staged).hexdigest(), entry["sha256"])
            self.assertNotIn(b"__BUILD_COMMIT__", staged)
        self.assertIn(ACCEPTED_GATE1_COMMIT, (output / "index.html").read_text(encoding="utf-8"))
        self.assertNotIn(DEPLOY_COMMIT, (output / "index.html").read_text(encoding="utf-8"))

    def test_every_enrollment_executable_and_html_carry_deploy_identity(self):
        output = self.stage()
        executable_paths = sorted((output / "enroll").glob("*.mjs"))
        self.assertEqual({path.name for path in executable_paths}, {name for name in ENROLLMENT_FILES if name.endswith(".mjs")})
        for path in executable_paths:
            source = path.read_text(encoding="utf-8")
            self.assertIn(DEPLOY_COMMIT, source, path.name)
            self.assertNotIn("__ENROLLMENT_BUILD_COMMIT__", source, path.name)
        html = (output / "enroll" / "index.html").read_text(encoding="utf-8")
        self.assertIn(f'<meta name="build-commit" content="{DEPLOY_COMMIT}">', html)
        self.assertIn(f'src="./app.mjs?v={DEPLOY_COMMIT}"', html)
        self.assertNotIn("__ENROLLMENT_BUILD_COMMIT__", html)

    def test_tampered_module_local_identity_rejects_during_node_evaluation(self):
        output = self.stage()
        target = output / "enroll" / "enrollment-measurements.mjs"
        source = target.read_text(encoding="utf-8")
        self.assertEqual(source.count(DEPLOY_COMMIT), 1)
        target.write_text(source.replace(DEPLOY_COMMIT, OTHER_COMMIT), encoding="utf-8")
        completed = subprocess.run(
            ["node", "--input-type=module", "--eval", f"await import({json.dumps(target.as_uri())})"],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("enrollment build identity mismatch", completed.stderr)

    def test_html_identity_mismatch_rejects_through_production_identity_api(self):
        output = self.stage()
        module_uri = (output / "enroll" / "enrollment-build.mjs").as_uri()
        node_source = f"""
          const identity = await import({json.dumps(module_uri)});
          const fakeDocument = {{
            querySelector(selector) {{
              if (selector !== 'meta[name="build-commit"]') throw new Error('wrong selector');
              return {{ getAttribute: () => {json.dumps(OTHER_COMMIT)} }};
            }},
          }};
          identity.assertEnrollmentHtmlBuildCommit(fakeDocument);
        """
        completed = subprocess.run(
            ["node", "--input-type=module", "--eval", node_source],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("enrollment HTML build identity mismatch", completed.stderr)

    def test_root_tamper_fails_closed_without_output_or_temporary_tree(self):
        fixture = self.fixture_repo()
        target = fixture / "spikes" / "001-mobile-web-audio-gate" / "styles.css"
        target.write_bytes(target.read_bytes() + b"\n/* tampered */\n")
        output = self.temp_root / "tampered-site"
        with self.assertRaises(self.stager.StageError):
            self.stager.stage_pages(DEPLOY_COMMIT, output, repo_root=fixture)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.temp_root.glob(f".{output.name}.tmp-*")), [])

    def test_manifest_rejects_unknown_missing_duplicate_traversal_and_bad_hash(self):
        def swap_non_rendered_destinations(value):
            metadata = next(entry for entry in value["files"] if entry["destination"] == "asset-metadata.json")
            calibration = next(entry for entry in value["files"] if entry["destination"] == "calibration.json")
            metadata["destination"], calibration["destination"] = (
                calibration["destination"], metadata["destination"],
            )

        variants = {
            "unknown top-level key": lambda value: value.update({"extra": True}),
            "missing top-level key": lambda value: value.pop("schemaVersion"),
            "wrong accepted commit": lambda value: value.update({"acceptedCommit": DEPLOY_COMMIT}),
            "unknown entry key": lambda value: value["files"][0].update({"extra": True}),
            "duplicate source": lambda value: value["files"].__setitem__(1, {**value["files"][1], "source": value["files"][0]["source"]}),
            "duplicate destination": lambda value: value["files"].__setitem__(1, {**value["files"][1], "destination": value["files"][0]["destination"]}),
            "source traversal": lambda value: value["files"][0].update({"source": "../private.mp3"}),
            "destination traversal": lambda value: value["files"][0].update({"destination": "../escape"}),
            "uppercase hash": lambda value: value["files"][0].update({"sha256": "A" * 64}),
            "missing allowlist entry": lambda value: value["files"].pop(),
            "extra allowlist entry": lambda value: value["files"].append(dict(value["files"][0])),
            "swapped source destination mapping": swap_non_rendered_destinations,
        }
        for label, mutate in variants.items():
            with self.subTest(label=label):
                manifest = self.write_manifest_variant(mutate)
                output = self.temp_root / f"invalid-{len(list(self.temp_root.iterdir()))}"
                with self.assertRaises(self.stager.StageError):
                    self.stager.stage_pages(DEPLOY_COMMIT, output, manifest_path=manifest)
                self.assertFalse(output.exists())

    def test_invalid_deploy_sha_is_rejected_before_staging(self):
        for invalid in ["", "abc", DEPLOY_COMMIT.upper(), "g" * 40, DEPLOY_COMMIT + "0"]:
            with self.subTest(invalid=invalid):
                output = self.temp_root / f"invalid-sha-{len(list(self.temp_root.iterdir()))}"
                with self.assertRaises(self.stager.StageError):
                    self.stager.stage_pages(invalid, output)
                self.assertFalse(output.exists())

    def test_existing_output_is_never_clobbered(self):
        output = self.temp_root / "existing"
        output.mkdir()
        marker = output / "owner.txt"
        marker.write_text("belongs to another publisher", encoding="utf-8")
        with self.assertRaises(self.stager.StageError):
            self.stager.stage_pages(DEPLOY_COMMIT, output)
        self.assertEqual(marker.read_text(encoding="utf-8"), "belongs to another publisher")
        self.assertEqual(relative_files(output), {"owner.txt"})

    def test_cli_has_generic_path_free_diagnostics(self):
        private_output = self.temp_root / "SENSITIVE_LOCAL_OUTPUT_NAME"
        completed = subprocess.run(
            [sys.executable, str(STAGER_PATH), "BAD_PRIVATE_SHA", str(private_output)],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        combined = completed.stdout + completed.stderr
        self.assertNotIn("BAD_PRIVATE_SHA", combined)
        self.assertNotIn("SENSITIVE_LOCAL_OUTPUT_NAME", combined)
        self.assertNotIn(str(self.temp_root), combined)


if __name__ == "__main__":
    unittest.main()

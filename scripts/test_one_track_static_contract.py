from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCT_ROOT = REPO_ROOT / "prototype" / "one-track"
SOURCE_ROOT = PRODUCT_ROOT / "src"
RUNTIME_MODULES = {
    Path("build-identity.mjs"),
    Path("config.mjs"),
    Path("track-metadata.mjs"),
    Path("core/run-context.mjs"),
}
BUILD_PLACEHOLDER = "__BUILD_SHA__"
STAGED_SHA = "0123456789abcdef0123456789abcdef01234567"


class OneTrackStaticContractTests(unittest.TestCase):
    def test_runtime_graph_contract(self):
        readme_path = PRODUCT_ROOT / "README.md"
        self.assertTrue(readme_path.is_file(), "independent product boundary README is missing")
        readme = readme_path.read_text(encoding="utf-8")
        for required in [
            "independent product boundary",
            "python3 -m http.server",
            "private file",
            "source-to-root staging",
            "human merge gate",
            "human Pixel gate",
        ]:
            self.assertIn(required, readme)
        for run_value in [
            "session-1",
            "session-2",
            "session-3",
            "session-4",
            "session-5",
            "smoke-crossfade",
            "smoke-playing",
        ]:
            self.assertIn(f"/?run={run_value}", readme)

        runtime_paths = {
            path.relative_to(SOURCE_ROOT)
            for path in SOURCE_ROOT.rglob("*.mjs")
        }
        self.assertEqual(runtime_paths, RUNTIME_MODULES)

        sources = {
            relative_path: (SOURCE_ROOT / relative_path).read_text(encoding="utf-8")
            for relative_path in RUNTIME_MODULES
        }
        for relative_path, source in sources.items():
            self.assertEqual(source.count(BUILD_PLACEHOLDER), 1, relative_path)
            self.assertNotRegex(source, r"\bfetch\s*\(|\bXMLHttpRequest\b|https?://")
            self.assertNotRegex(source, r"\bwindow\b|\bdocument\b|\bAudioContext\b|\bFile\b")
            self.assertNotRegex(source, r"import\s*\(")
            for import_path in re.findall(r"from\s+['\"]([^'\"]+)['\"]", source):
                self.assertTrue(import_path.startswith("."), (relative_path, import_path))
                resolved = (SOURCE_ROOT / relative_path.parent / import_path).resolve()
                self.assertTrue(resolved.is_relative_to(SOURCE_ROOT.resolve()))
                self.assertTrue(resolved.is_file(), (relative_path, import_path))
            for protected in [
                "spikes/001-mobile-web-audio-gate",
                "tools/m2-enrollment",
                "docs/design",
                "docs/plans",
                "tests/fixtures",
            ]:
                self.assertNotIn(protected, source)

        identity = sources[Path("build-identity.mjs")]
        self.assertEqual(
            identity.splitlines().count("export const BUILD_SHA = '__BUILD_SHA__';"),
            1,
        )
        self.assertEqual(identity.count("assertBuildIdentity(BUILD_SHA)"), 1)
        for relative_path in RUNTIME_MODULES - {Path("build-identity.mjs")}:
            source = sources[relative_path]
            self.assertEqual(source.count("const LOCAL_BUILD_SHA = '__BUILD_SHA__';"), 1)
            self.assertEqual(source.count("assertBuildIdentity(LOCAL_BUILD_SHA)"), 1)

        metadata = sources[Path("track-metadata.mjs")].lower()
        for forbidden in [
            "selectedfilename",
            "file.name",
            "local uri",
            "private bytes",
            "decoded samples",
            "artwork",
            "audio content",
        ]:
            self.assertNotIn(forbidden, metadata)

        with tempfile.TemporaryDirectory() as temporary_directory:
            staged_root = Path(temporary_directory) / "src"
            shutil.copytree(SOURCE_ROOT, staged_root)
            for relative_path in RUNTIME_MODULES:
                path = staged_root / relative_path
                source = path.read_text(encoding="utf-8")
                self.assertEqual(source.count(BUILD_PLACEHOLDER), 1, relative_path)
                path.write_text(source.replace(BUILD_PLACEHOLDER, STAGED_SHA), encoding="utf-8")

            script = """
              import * as identity from './src/build-identity.mjs';
              import * as metadata from './src/track-metadata.mjs';
              import * as config from './src/config.mjs';
              import * as context from './src/core/run-context.mjs';
              for (const module of [identity, metadata, config, context]) {
                if (module.assertLocalBuildIdentity() !== identity.BUILD_SHA) process.exit(1);
              }
            """
            subprocess.run(
                ["node", "--input-type=module", "--eval", script],
                cwd=Path(temporary_directory),
                check=True,
                capture_output=True,
                text=True,
            )


if __name__ == "__main__":
    unittest.main()

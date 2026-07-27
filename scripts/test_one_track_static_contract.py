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
REQUIRED_RUNTIME_MODULES = {
    Path("build-identity.mjs"),
    Path("config.mjs"),
    Path("track-metadata.mjs"),
    Path("core/run-context.mjs"),
}
BUILD_PLACEHOLDER = "__BUILD_SHA__"
STAGED_SHA = "0123456789abcdef0123456789abcdef01234567"
STATIC_MODULE_SPECIFIER_PATTERN = re.compile(
    r"(?:^|;)\s*(?:"
    r"import\s+(?:[^;]*?\s+from\s+)?|"
    r"export\s+(?:\*\s+(?:as\s+[A-Za-z_$][\w$]*\s+)?|\{[^;]*\}\s+)from\s+"
    r")(?P<quote>['\"])(?P<specifier>[^'\"]+)(?P=quote)\s*(?=;|$)",
    re.MULTILINE,
)


def static_module_specifiers(source: str) -> list[str]:
    return [
        match.group("specifier")
        for match in STATIC_MODULE_SPECIFIER_PATTERN.finditer(source)
    ]


class OneTrackStaticContractTests(unittest.TestCase):
    def _copy_source_fixture(self, temporary_directory: str) -> Path:
        fixture_root = Path(temporary_directory) / "src"
        shutil.copytree(SOURCE_ROOT, fixture_root)
        return fixture_root

    def _assert_runtime_graph_fixture(self, fixture_root: Path) -> None:
        global SOURCE_ROOT
        original_source_root = SOURCE_ROOT
        try:
            SOURCE_ROOT = fixture_root
            self.test_runtime_graph_contract()
        finally:
            SOURCE_ROOT = original_source_root

    @staticmethod
    def _prepend_import(path: Path, specifier: str) -> None:
        source = path.read_text(encoding="utf-8")
        path.write_text(f'import "{specifier}";\n{source}', encoding="utf-8")

    def test_future_runtime_module_is_discovered_accepted_and_checked(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            future_module = fixture_root / "future-task.mjs"
            future_module.write_text(
                """import { assertBuildIdentity } from './build-identity.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

function assertFutureBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

assertFutureBuildIdentity();
export const futureTask = true;
""",
                encoding="utf-8",
            )
            self._assert_runtime_graph_fixture(fixture_root)

            future_module.write_text(
                future_module.read_text(encoding="utf-8") + "\nexport const browserLeak = document;\n",
                encoding="utf-8",
            )
            with self.assertRaises(AssertionError):
                self._assert_runtime_graph_fixture(fixture_root)

    def test_side_effect_relative_import_inside_source_is_accepted(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            self._prepend_import(fixture_root / "config.mjs", "./track-metadata.mjs")
            self._assert_runtime_graph_fixture(fixture_root)

    def test_side_effect_imports_obey_runtime_boundary(self):
        for specifier in [
            "../outside.mjs",
            "node:fs",
            "fs",
            "data:text/javascript,export default 1",
        ]:
            with self.subTest(specifier=specifier), tempfile.TemporaryDirectory() as temporary_directory:
                fixture_root = self._copy_source_fixture(temporary_directory)
                (fixture_root.parent / "outside.mjs").write_text(
                    "export const outside = true;\n",
                    encoding="utf-8",
                )
                self._prepend_import(fixture_root / "config.mjs", specifier)
                with self.assertRaises(AssertionError):
                    self._assert_runtime_graph_fixture(fixture_root)

    def test_static_reexports_obey_runtime_boundary(self):
        for statement in [
            'export * from "../outside.mjs";',
            'export { readFile } from "node:fs";',
            'export { default } from "data:text/javascript,export default 1";',
        ]:
            with self.subTest(statement=statement), tempfile.TemporaryDirectory() as temporary_directory:
                fixture_root = self._copy_source_fixture(temporary_directory)
                (fixture_root.parent / "outside.mjs").write_text(
                    "export const outside = true;\n",
                    encoding="utf-8",
                )
                config_path = fixture_root / "config.mjs"
                config_path.write_text(
                    f"{statement}\n{config_path.read_text(encoding='utf-8')}",
                    encoding="utf-8",
                )
                with self.assertRaises(AssertionError):
                    self._assert_runtime_graph_fixture(fixture_root)

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
        self.assertTrue(
            REQUIRED_RUNTIME_MODULES.issubset(runtime_paths),
            f"missing required Task 1 runtime modules: "
            f"{REQUIRED_RUNTIME_MODULES - runtime_paths}",
        )

        sources = {
            relative_path: (SOURCE_ROOT / relative_path).read_text(encoding="utf-8")
            for relative_path in runtime_paths
        }
        for relative_path, source in sources.items():
            self.assertEqual(source.count(BUILD_PLACEHOLDER), 1, relative_path)
            self.assertNotRegex(source, r"\bfetch\s*\(|\bXMLHttpRequest\b|https?://")
            self.assertNotRegex(source, r"\bwindow\b|\bdocument\b|\bAudioContext\b|\bFile\b")
            self.assertNotRegex(source, r"import\s*\(")
            for import_path in static_module_specifiers(source):
                self.assertTrue(import_path.startswith("."), (relative_path, import_path))
                resolved = (SOURCE_ROOT / relative_path.parent / import_path).resolve()
                self.assertTrue(resolved.is_relative_to(SOURCE_ROOT.resolve()))
                self.assertTrue(resolved.is_file(), (relative_path, import_path))
                self.assertEqual(resolved.suffix, ".mjs", (relative_path, import_path))
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
        for relative_path in runtime_paths - {Path("build-identity.mjs")}:
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
            for relative_path in runtime_paths:
                path = staged_root / relative_path
                source = path.read_text(encoding="utf-8")
                self.assertEqual(source.count(BUILD_PLACEHOLDER), 1, relative_path)
                path.write_text(source.replace(BUILD_PLACEHOLDER, STAGED_SHA), encoding="utf-8")

            module_specifiers = [
                f"./src/{relative_path.as_posix()}"
                for relative_path in sorted(runtime_paths)
            ]
            script = f"""
              import * as identity from './src/build-identity.mjs';
              const specifiers = {module_specifiers!r};
              for (const specifier of specifiers) {{
                const runtimeModule = await import(specifier);
                if (typeof runtimeModule.assertLocalBuildIdentity === 'function'
                    && runtimeModule.assertLocalBuildIdentity() !== identity.BUILD_SHA) {{
                  process.exit(1);
                }}
              }}
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

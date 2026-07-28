from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCT_ROOT = REPO_ROOT / "prototype" / "one-track"
SOURCE_ROOT = PRODUCT_ROOT / "src"
TASK1_REQUIRED_RUNTIME_MODULES = {
    Path("build-identity.mjs"),
    Path("config.mjs"),
    Path("track-metadata.mjs"),
    Path("core/run-context.mjs"),
}
PLANNED_SOURCE_MODULES = {
    Path("build-identity.mjs"),
    Path("config.mjs"),
    Path("track-metadata.mjs"),
    Path("core/run-context.mjs"),
    Path("core/tap-estimator.mjs"),
    Path("core/handoff-planner.mjs"),
    Path("core/effects.mjs"),
    Path("core/session-reducer.mjs"),
    Path("core/evidence-schema.mjs"),
    Path("replay/replay-session.mjs"),
    Path("audio/audio-math.mjs"),
    Path("audio/percussion-buffer.mjs"),
    Path("audio/offline-handoff-renderer.mjs"),
    Path("audio/web-audio-engine.mjs"),
    Path("browser/local-track-loader.mjs"),
    Path("browser/loaded-session.mjs"),
    Path("browser/clock-adapter.mjs"),
    Path("browser/coordinator.mjs"),
    Path("browser/renderer.mjs"),
    Path("browser/main.mjs"),
}
NON_STAGED_SOURCE_MODULES = {
    Path("replay/replay-session.mjs"),
    Path("audio/offline-handoff-renderer.mjs"),
}
STAGED_RUNTIME_MODULES = PLANNED_SOURCE_MODULES - NON_STAGED_SOURCE_MODULES
BROWSER_BOUNDARY_MODULES = {
    Path("audio/web-audio-engine.mjs"),
    Path("browser/local-track-loader.mjs"),
    Path("browser/loaded-session.mjs"),
    Path("browser/clock-adapter.mjs"),
    Path("browser/coordinator.mjs"),
    Path("browser/renderer.mjs"),
    Path("browser/main.mjs"),
}
PURE_RUNTIME_MODULES = PLANNED_SOURCE_MODULES - BROWSER_BOUNDARY_MODULES
BUILD_PLACEHOLDER = "__BUILD_SHA__"
STAGED_SHA = "0123456789abcdef0123456789abcdef01234567"
NODE_MODULE_ANALYSIS_SCRIPT = r"""
const fs = require('node:fs');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
const walk = require('internal/deps/acorn/acorn-walk/dist/walk');

const sources = JSON.parse(fs.readFileSync(0, 'utf8'));
const networkIdentifiers = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'WebTransport',
  'RTCPeerConnection',
  'Worker',
  'SharedWorker',
]);
const networkMembers = new Set(['sendBeacon', 'serviceWorker']);
const persistenceIdentifiers = new Set([
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'cookieStore',
  'Storage',
  'StorageManager',
  'IDBFactory',
  'IDBDatabase',
  'CacheStorage',
]);
const persistenceMembers = new Set(['storage', 'cookie', 'cookieStore']);
const browserIdentifiers = new Set([
  'window',
  'document',
  'navigator',
  'AudioContext',
  'OfflineAudioContext',
  'File',
  'FileReader',
  'Blob',
  'crypto',
  'Crypto',
  'SubtleCrypto',
  'CryptoKey',
  'performance',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  ...networkIdentifiers,
  ...networkMembers,
  ...persistenceIdentifiers,
  ...persistenceMembers,
]);
const globalCapabilityRoots = new Set([
  'globalThis',
  'window',
  'self',
  'navigator',
  'document',
]);

function staticKeyName(key, computed) {
  if (!computed && key.type === 'Identifier') {
    return key.name;
  }
  if (key.type === 'Literal') {
    return key.value;
  }
  return null;
}

function staticPropertyName(node) {
  return staticKeyName(node.property, node.computed);
}

function rootIdentifierName(node) {
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  if (node.type === 'ChainExpression') {
    return rootIdentifierName(node.expression);
  }
  if (node.type === 'MemberExpression') {
    return rootIdentifierName(node.object);
  }
  return null;
}

const analyses = {};
for (const [identifier, source] of Object.entries(sources)) {
  const ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  const staticSpecifiers = new Set();
  const codeGenerationTokens = new Set();
  const networkCapabilities = new Set();
  const persistenceCapabilities = new Set();
  const browserCapabilities = new Set();
  let hasDynamicImport = false;

  function classifyCapabilityName(name) {
    if (networkIdentifiers.has(name) || networkMembers.has(name)) {
      networkCapabilities.add(name);
    }
    if (persistenceIdentifiers.has(name) || persistenceMembers.has(name)) {
      persistenceCapabilities.add(name);
    }
    if (browserIdentifiers.has(name)) {
      browserCapabilities.add(name);
    }
  }

  function classifyObjectPattern(pattern, sourceNode) {
    if (pattern.type !== 'ObjectPattern'
        || !globalCapabilityRoots.has(rootIdentifierName(sourceNode))) {
      return;
    }
    for (const property of pattern.properties) {
      if (property.type === 'RestElement') {
        continue;
      }
      const propertyName = staticKeyName(property.key, property.computed);
      classifyCapabilityName(propertyName);
      const nestedPattern = property.value.type === 'AssignmentPattern'
        ? property.value.left
        : property.value;
      if (nestedPattern.type === 'ObjectPattern') {
        classifyObjectPattern(nestedPattern, sourceNode);
      }
    }
  }

  walk.simple(ast, {
    ImportDeclaration(node) {
      staticSpecifiers.add(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (node.source !== null) {
        staticSpecifiers.add(node.source.value);
      }
    },
    ExportAllDeclaration(node) {
      staticSpecifiers.add(node.source.value);
    },
    ImportExpression() {
      hasDynamicImport = true;
    },
    Identifier(node) {
      if (node.name === 'eval' || node.name === 'Function') {
        codeGenerationTokens.add(node.name);
      }
      classifyCapabilityName(node.name);
    },
    VariableDeclarator(node) {
      classifyObjectPattern(node.id, node.init);
    },
    AssignmentExpression(node) {
      classifyObjectPattern(node.left, node.right);
    },
    MemberExpression(node) {
      const propertyName = staticPropertyName(node);
      if (propertyName === 'eval'
          || propertyName === 'Function'
          || propertyName === 'constructor') {
        codeGenerationTokens.add(propertyName);
      }
      const rootName = rootIdentifierName(node.object);
      if (globalCapabilityRoots.has(rootName)) {
        classifyCapabilityName(propertyName);
      }
    },
  });
  analyses[identifier] = {
    staticSpecifiers: [...staticSpecifiers],
    hasDynamicImport,
    codeGenerationTokens: [...codeGenerationTokens],
    networkCapabilities: [...networkCapabilities],
    persistenceCapabilities: [...persistenceCapabilities],
    browserCapabilities: [...browserCapabilities],
  };
}
process.stdout.write(JSON.stringify(analyses));
"""


def analyze_runtime_modules(sources: dict[Path, str]) -> dict[Path, dict[str, Any]]:
    serialized_sources = {
        relative_path.as_posix(): source
        for relative_path, source in sources.items()
    }
    result = subprocess.run(
        [
            "node",
            "--no-warnings",
            "--expose-internals",
            "--eval",
            NODE_MODULE_ANALYSIS_SCRIPT,
        ],
        input=json.dumps(serialized_sources),
        check=True,
        capture_output=True,
        text=True,
    )
    parsed = json.loads(result.stdout)
    return {
        Path(relative_path): analysis
        for relative_path, analysis in parsed.items()
    }

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

    @staticmethod
    def _write_staged_fixture_module(fixture_root: Path, relative_path: Path, body: str) -> Path:
        module_path = fixture_root / relative_path
        module_path.parent.mkdir(parents=True, exist_ok=True)
        build_identity_path = Path("../" * len(relative_path.parent.parts)) / "build-identity.mjs"
        module_path.write_text(
            f"""import {{ assertBuildIdentity }} from '{build_identity_path.as_posix()}';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export function assertLocalBuildIdentity() {{
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}}

{body}
""",
            encoding="utf-8",
        )
        return module_path

    def test_future_runtime_module_is_discovered_accepted_and_checked(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            future_module = self._write_staged_fixture_module(
                fixture_root,
                Path("core/tap-estimator.mjs"),
                "export const futureTask = true;",
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

    def test_comment_trivia_cannot_hide_dependency_edges(self):
        rejected_statements = [
            'import /* boundary bypass */ "node:fs";',
            'const deferred = () => import /* boundary bypass */ ("node:fs");',
            'export /* boundary bypass */ { readFile } from "node:fs";',
            'const deferred = () => `${import /* boundary bypass */ ("node:fs")}`;',
            'const regexTrivia = /\'/; const deferred = () => import /* boundary bypass */ ("node:fs");',
        ]
        for statement in rejected_statements:
            with self.subTest(statement=statement), tempfile.TemporaryDirectory() as temporary_directory:
                fixture_root = self._copy_source_fixture(temporary_directory)
                config_path = fixture_root / "config.mjs"
                config_path.write_text(
                    f"{statement}\n{config_path.read_text(encoding='utf-8')}",
                    encoding="utf-8",
                )
                with self.assertRaises(AssertionError):
                    self._assert_runtime_graph_fixture(fixture_root)

        accepted_statements = [
            'const stringLiteral = "import /* not code */ (\\"node:fs\\")";',
            '// import /* not code */ ("node:fs")',
            'const templateText = `import /* not code */ ("node:fs")`;',
            "const regexTrivia = /'/;",
        ]
        for statement in accepted_statements:
            with self.subTest(statement=statement), tempfile.TemporaryDirectory() as temporary_directory:
                fixture_root = self._copy_source_fixture(temporary_directory)
                config_path = fixture_root / "config.mjs"
                config_path.write_text(
                    f"{statement}\n{config_path.read_text(encoding='utf-8')}",
                    encoding="utf-8",
                )
                self._assert_runtime_graph_fixture(fixture_root)

    def test_runtime_code_generation_is_rejected(self):
        rejected_statements = [
            'const deferred = () => eval(\'import("node:fs")\');',
            'const deferred = () => (0, eval)(\'import("node:fs")\');',
            'const deferred = () => Function(\'return import("node:fs")\')();',
            'const deferred = () => new Function(\'return import("node:fs")\')();',
            'const deferred = () => globalThis.eval(\'import("node:fs")\');',
            'const deferred = () => (() => {}).constructor(\'return import("node:fs")\')();',
        ]
        for statement in rejected_statements:
            with self.subTest(statement=statement), tempfile.TemporaryDirectory() as temporary_directory:
                fixture_root = self._copy_source_fixture(temporary_directory)
                config_path = fixture_root / "config.mjs"
                config_path.write_text(
                    f"{statement}\n{config_path.read_text(encoding='utf-8')}",
                    encoding="utf-8",
                )
                with self.assertRaises(AssertionError):
                    self._assert_runtime_graph_fixture(fixture_root)

        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            config_path = fixture_root / "config.mjs"
            config_path.write_text(
                'const evaluation = "eval is forbidden";\n'
                'const functional = evaluation.length;\n'
                f"{config_path.read_text(encoding='utf-8')}",
                encoding="utf-8",
            )
            self._assert_runtime_graph_fixture(fixture_root)

    def test_network_capabilities_are_rejected_in_every_runtime_module(self):
        bodies = [
            "export function leak(payload) { return navigator.sendBeacon('/leak', payload); }",
            "export function connect() { return new WebSocket('/socket'); }",
            "export function stream() { return new EventSource('/events'); }",
            "export function transport() { return new WebTransport('/transport'); }",
            "export const request = globalThis.fetch;",
            "export const Socket = globalThis.WebSocket;",
            "const { sendBeacon } = navigator; export { sendBeacon };",
            "const { fetch: request } = globalThis; export { request };",
            "const { 'fetch': request } = globalThis; export { request };",
        ]
        for body in bodies:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as temporary_directory:
                fixture_root = self._copy_source_fixture(temporary_directory)
                self._write_staged_fixture_module(
                    fixture_root,
                    Path("browser/coordinator.mjs"),
                    body,
                )
                with self.assertRaises(AssertionError):
                    self._assert_runtime_graph_fixture(fixture_root)

    def test_persistence_capabilities_are_rejected_in_every_runtime_module(self):
        bodies = [
            "export const persist = (value) => localStorage.setItem('private', value);",
            "export const storage = globalThis.sessionStorage;",
            "const { indexedDB } = globalThis; export { indexedDB };",
            "const { 'caches': cacheStorage } = globalThis; export { cacheStorage };",
        ]
        for body in bodies:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as temporary_directory:
                fixture_root = self._copy_source_fixture(temporary_directory)
                self._write_staged_fixture_module(
                    fixture_root,
                    Path("browser/coordinator.mjs"),
                    body,
                )
                with self.assertRaises(AssertionError):
                    self._assert_runtime_graph_fixture(fixture_root)

        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            self._write_staged_fixture_module(
                fixture_root,
                Path("browser/coordinator.mjs"),
                "export const labels = { localStorage: 'label', caches: 'label' };",
            )
            self._assert_runtime_graph_fixture(fixture_root)

    def test_browser_boundaries_are_allowed_while_core_remains_pure(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            self._write_staged_fixture_module(
                fixture_root,
                Path("browser/local-track-loader.mjs"),
                "export function accepts(file) { return file instanceof File; }\n"
                "export function digest(bytes) { return crypto.subtle.digest('SHA-256', bytes); }",
            )
            self._write_staged_fixture_module(
                fixture_root,
                Path("audio/web-audio-engine.mjs"),
                "export function createContext() { return new AudioContext(); }",
            )
            self._assert_runtime_graph_fixture(fixture_root)

        pure_boundary_violations = [
            "export function invalid(file) { return file instanceof File; }",
            "export const now = globalThis.performance.now();",
            "const { performance } = globalThis; export const now = performance.now();",
            "const { 'performance': clock } = globalThis; export const now = clock.now();",
            "export const FileType = globalThis.File;",
            "export const digest = (bytes) => crypto.subtle.digest('SHA-256', bytes);",
            "export const cryptoProvider = globalThis.crypto;",
            "const { crypto } = globalThis; export { crypto };",
            "const { 'SubtleCrypto': Provider } = globalThis; export { Provider };",
        ]
        for body in pure_boundary_violations:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as temporary_directory:
                fixture_root = self._copy_source_fixture(temporary_directory)
                self._write_staged_fixture_module(
                    fixture_root,
                    Path("core/tap-estimator.mjs"),
                    body,
                )
                with self.assertRaises(AssertionError):
                    self._assert_runtime_graph_fixture(fixture_root)

        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            self._write_staged_fixture_module(
                fixture_root,
                Path("core/tap-estimator.mjs"),
                "export const labels = { fetch: 'label', performance: 'metric', crypto: 'provider' };",
            )
            self._assert_runtime_graph_fixture(fixture_root)

    def test_planned_source_graph_distinguishes_staged_and_test_only_modules(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            replay_module = fixture_root / "replay/replay-session.mjs"
            replay_module.parent.mkdir(parents=True, exist_ok=True)
            replay_module.write_text(
                "export function replaySession(state) { return state; }\n",
                encoding="utf-8",
            )
            self._assert_runtime_graph_fixture(fixture_root)

        with tempfile.TemporaryDirectory() as temporary_directory:
            fixture_root = self._copy_source_fixture(temporary_directory)
            self._write_staged_fixture_module(
                fixture_root,
                Path("unknown-module.mjs"),
                "export const unknown = true;",
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
            TASK1_REQUIRED_RUNTIME_MODULES.issubset(runtime_paths),
            f"missing required Task 1 runtime modules: "
            f"{TASK1_REQUIRED_RUNTIME_MODULES - runtime_paths}",
        )
        self.assertTrue(
            runtime_paths.issubset(PLANNED_SOURCE_MODULES),
            f"unplanned source modules: {runtime_paths - PLANNED_SOURCE_MODULES}",
        )
        staged_paths = runtime_paths & STAGED_RUNTIME_MODULES

        sources = {
            relative_path: (SOURCE_ROOT / relative_path).read_text(encoding="utf-8")
            for relative_path in runtime_paths
        }
        module_analyses = analyze_runtime_modules(sources)
        for relative_path, source in sources.items():
            expected_placeholder_count = 1 if relative_path in staged_paths else 0
            self.assertEqual(
                source.count(BUILD_PLACEHOLDER),
                expected_placeholder_count,
                relative_path,
            )
            analysis = module_analyses[relative_path]
            self.assertFalse(analysis["hasDynamicImport"], relative_path)
            self.assertEqual(analysis["codeGenerationTokens"], [], relative_path)
            self.assertEqual(analysis["networkCapabilities"], [], relative_path)
            self.assertEqual(analysis["persistenceCapabilities"], [], relative_path)
            if relative_path in PURE_RUNTIME_MODULES:
                self.assertEqual(analysis["browserCapabilities"], [], relative_path)
            for import_path in analysis["staticSpecifiers"]:
                self.assertTrue(import_path.startswith("."), (relative_path, import_path))
                resolved = (SOURCE_ROOT / relative_path.parent / import_path).resolve()
                self.assertTrue(resolved.is_relative_to(SOURCE_ROOT.resolve()))
                self.assertTrue(resolved.is_file(), (relative_path, import_path))
                self.assertEqual(resolved.suffix, ".mjs", (relative_path, import_path))
                resolved_relative = resolved.relative_to(SOURCE_ROOT.resolve())
                self.assertIn(resolved_relative, runtime_paths, (relative_path, import_path))
                if relative_path in staged_paths:
                    self.assertIn(
                        resolved_relative,
                        staged_paths,
                        f"staged module {relative_path} imports non-staged {resolved_relative}",
                    )
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
        for relative_path in staged_paths - {Path("build-identity.mjs")}:
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
            for relative_path in staged_paths:
                path = staged_root / relative_path
                source = path.read_text(encoding="utf-8")
                self.assertEqual(source.count(BUILD_PLACEHOLDER), 1, relative_path)
                path.write_text(source.replace(BUILD_PLACEHOLDER, STAGED_SHA), encoding="utf-8")

            module_specifiers = [
                f"./src/{relative_path.as_posix()}"
                for relative_path in sorted(staged_paths)
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

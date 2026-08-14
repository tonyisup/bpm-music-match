#!/usr/bin/env python3
from __future__ import annotations

import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import NamedTuple

REPO_ROOT = Path(__file__).resolve().parents[1]
SPIKE_ROOT = REPO_ROOT / "spikes" / "001-mobile-web-audio-gate"
ENROLLMENT_ROOT = REPO_ROOT / "tools" / "m2-enrollment"
ONE_TRACK_ROOT = REPO_ROOT / "prototype" / "one-track"
EXPECTED_PYTHON = "3.13.7"
EXPECTED_NODE = "v22.22.3"

ENROLLMENT_SOURCE_MODULES = (
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
)
ENROLLMENT_IMPORT_EXPRESSION = "await Promise.all([" + ",".join(
    f'import("./tools/m2-enrollment/{module_name}")'
    for module_name in ENROLLMENT_SOURCE_MODULES
) + "]);"
ENROLLMENT_IMPORT_COMMAND = (
    "node", "--input-type=module", "--eval", ENROLLMENT_IMPORT_EXPRESSION,
)
ENROLLMENT_SUPPORT_TESTS = (
    "scripts/chrome-devtools-startup.test.mjs",
    "scripts/enrollment-download-artifacts.test.mjs",
)
ONE_TRACK_SOURCE_MODULES = (
    "audio/audio-math.mjs",
    "audio/percussion-buffer.mjs",
    "audio/web-audio-engine.mjs",
    "browser/clock-adapter.mjs",
    "browser/coordinator.mjs",
    "browser/loaded-session.mjs",
    "browser/local-track-loader.mjs",
    "browser/main.mjs",
    "browser/renderer.mjs",
    "build-identity.mjs",
    "config.mjs",
    "core/effects.mjs",
    "core/evidence-schema.mjs",
    "core/handoff-planner.mjs",
    "core/run-context.mjs",
    "core/session-reducer.mjs",
    "core/tap-estimator.mjs",
    "track-metadata.mjs",
)
ONE_TRACK_IMPORT_EXPRESSION = "await Promise.all([" + ",".join(
    f'import("./prototype/one-track/src/{module_name}")'
    for module_name in ONE_TRACK_SOURCE_MODULES
) + "]);"
ONE_TRACK_IMPORT_COMMAND = (
    "node", "--input-type=module", "--eval", ONE_TRACK_IMPORT_EXPRESSION,
)


class Stage(NamedTuple):
    stage_id: str
    rerun: str
    fix: str


STAGES = (
    Stage("runtime-version", "python3 scripts/verify_gate.py", "README.md#prerequisites"),
    Stage("asset-integrity", "python3 -m unittest -v scripts/test_generate_gate_track.py", "python3 scripts/generate_gate_track.py"),
    Stage("static-contract", "python3 -m unittest -v scripts/test_static_contract.py scripts/test_verify_gate.py", "README.md#static-contract"),
    Stage("module-import", "node --input-type=module --eval \"await import('./spikes/001-mobile-web-audio-gate/app.mjs')\"", "README.md#module-import"),
    Stage("node-tests", "node --test spikes/001-mobile-web-audio-gate/tests/*.test.mjs", "README.md#node-tests"),
    Stage("enrollment-static-contract", "python3 -m unittest -v scripts/test_enrollment_static_contract.py", "README.md#enrollment-and-pages-stages"),
    Stage("enrollment-module-import", shlex.join(ENROLLMENT_IMPORT_COMMAND), "README.md#enrollment-and-pages-stages"),
    Stage("enrollment-node-tests", f"node --test {' '.join(ENROLLMENT_SUPPORT_TESTS)} tools/m2-enrollment/tests/*.test.mjs", "README.md#enrollment-and-pages-stages"),
    Stage("one-track-static-contract", "python3 -m unittest -v scripts/test_one_track_static_contract.py", "README.md#one-track-stages"),
    Stage("one-track-module-import", shlex.join(ONE_TRACK_IMPORT_COMMAND), "README.md#one-track-stages"),
    Stage("one-track-node-tests", "node --test prototype/one-track/tests/*.test.mjs scripts/validate_one_track_evidence.test.mjs", "README.md#one-track-stages"),
    Stage("enrollment-browser-privacy", "node scripts/enrollment_browser_privacy_smoke.mjs", "README.md#enrollment-and-pages-stages"),
    Stage("pages-staging", "python3 -m unittest -v scripts/test_stage_pages.py scripts/test_stage_one_track_local.py", "README.md#enrollment-and-pages-stages"),
)


def validate_versions(python_version: str, node_version: str) -> str | None:
    problems = []
    if python_version != EXPECTED_PYTHON:
        problems.append(f"expected Python {EXPECTED_PYTHON}; got {python_version}")
    if node_version != EXPECTED_NODE:
        problems.append(f"expected Node {EXPECTED_NODE}; got {node_version}")
    return "; ".join(problems) or None


def format_failure(*, stage_id: str, problem: str, cause: str, rerun: str, fix: str) -> str:
    return "\n".join((
        f"FAIL {stage_id}: {problem}",
        f"CAUSE: {cause}",
        f"RERUN: {rerun}",
        f"FIX: {fix}",
    ))


def run_command(command: list[str]) -> tuple[bool, str]:
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    return completed.returncode == 0, output


def compact_cause(output: str) -> str:
    if not output:
        return "command exited without diagnostic output"
    return " | ".join(line.strip() for line in output.splitlines() if line.strip())[-1200:]


def execute_stage(stage: Stage) -> tuple[bool, str]:
    if stage.stage_id == "runtime-version":
        ok, node_output = run_command(["node", "--version"])
        if not ok:
            return False, compact_cause(node_output)
        problem = validate_versions(
            ".".join(str(value) for value in sys.version_info[:3]),
            node_output.strip(),
        )
        return problem is None, problem or ""

    if stage.stage_id == "asset-integrity":
        return run_command([sys.executable, "-m", "unittest", "-v", "scripts/test_generate_gate_track.py"])

    if stage.stage_id == "static-contract":
        return run_command([
            sys.executable, "-m", "unittest", "-v",
            "scripts/test_static_contract.py", "scripts/test_verify_gate.py",
        ])

    if stage.stage_id == "module-import":
        script = "await Promise.all([import('./spikes/001-mobile-web-audio-gate/audio-math.mjs'),import('./spikes/001-mobile-web-audio-gate/audio-engine.mjs'),import('./spikes/001-mobile-web-audio-gate/app.mjs')]);"
        return run_command(["node", "--input-type=module", "--eval", script])

    if stage.stage_id == "node-tests":
        tests = sorted(str(path.relative_to(REPO_ROOT)) for path in (SPIKE_ROOT / "tests").glob("*.test.mjs"))
        if not tests:
            return False, "no Node test files found"
        return run_command(["node", "--test", *tests])

    if stage.stage_id == "enrollment-static-contract":
        return run_command([
            sys.executable, "-m", "unittest", "-v",
            "scripts/test_enrollment_static_contract.py",
        ])

    if stage.stage_id == "enrollment-module-import":
        return run_command(list(ENROLLMENT_IMPORT_COMMAND))

    if stage.stage_id == "enrollment-node-tests":
        enrollment_tests = sorted(
            str(path.relative_to(REPO_ROOT))
            for path in (ENROLLMENT_ROOT / "tests").glob("*.test.mjs")
        )
        if not enrollment_tests:
            return False, "no enrollment Node test files found"
        tests = [*ENROLLMENT_SUPPORT_TESTS, *enrollment_tests]
        return run_command(["node", "--test", *tests])

    if stage.stage_id == "one-track-static-contract":
        return run_command([
            sys.executable, "-m", "unittest", "-v",
            "scripts/test_one_track_static_contract.py",
        ])

    if stage.stage_id == "one-track-module-import":
        return run_command(list(ONE_TRACK_IMPORT_COMMAND))

    if stage.stage_id == "one-track-node-tests":
        product_tests = sorted(
            str(path.relative_to(REPO_ROOT))
            for path in (ONE_TRACK_ROOT / "tests").glob("*.test.mjs")
        )
        if not product_tests:
            return False, "no one-track Node test files found"
        tests = [*product_tests, "scripts/validate_one_track_evidence.test.mjs"]
        return run_command(["node", "--test", *tests])

    if stage.stage_id == "enrollment-browser-privacy":
        return run_command(["node", "scripts/enrollment_browser_privacy_smoke.mjs"])

    if stage.stage_id == "pages-staging":
        return run_command([
            sys.executable, "-m", "unittest", "-v",
            "scripts/test_stage_pages.py", "scripts/test_stage_one_track_local.py",
        ])

    return False, f"unknown stage {stage.stage_id}"


def main() -> int:
    gate_started = time.perf_counter()
    for index, stage in enumerate(STAGES, start=1):
        started = time.perf_counter()
        passed, output = execute_stage(stage)
        elapsed = time.perf_counter() - started
        if not passed:
            print(format_failure(
                stage_id=stage.stage_id,
                problem="verification stage failed",
                cause=compact_cause(output),
                rerun=stage.rerun,
                fix=stage.fix,
            ))
            return 1
        print(f"PASS {stage.stage_id} {elapsed:.2f}s")
    total = time.perf_counter() - gate_started
    print(f"PASS gate {len(STAGES)}/{len(STAGES)} {total:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from typing import NamedTuple

REPO_ROOT = Path(__file__).resolve().parents[1]
SPIKE_ROOT = REPO_ROOT / "spikes" / "001-mobile-web-audio-gate"
EXPECTED_PYTHON = "3.13.7"
EXPECTED_NODE = "v22.22.3"


class Stage(NamedTuple):
    stage_id: str
    rerun: str
    fix: str


STAGES = (
    Stage("runtime-version", "python3 scripts/verify_gate.py", "Install the exact runtimes in README.md#prerequisites."),
    Stage("asset-integrity", "python3 -m unittest -v scripts/test_generate_gate_track.py", "python3 scripts/generate_gate_track.py"),
    Stage("static-contract", "python3 -m unittest -v scripts/test_static_contract.py scripts/test_verify_gate.py", "See README.md#troubleshooting."),
    Stage("module-import", "node --input-type=module --eval \"await import('./spikes/001-mobile-web-audio-gate/app.mjs')\"", "Inspect the relative .mjs imports named by the failure."),
    Stage("node-tests", "node --test spikes/001-mobile-web-audio-gate/tests/*.test.mjs", "Run the named failing Node test in isolation."),
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

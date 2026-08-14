#!/usr/bin/env python3
from __future__ import annotations

import re
import shutil
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCT_ROOT = REPO_ROOT / "prototype" / "one-track"
BUILD_PLACEHOLDER = b"__BUILD_SHA__"
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
FILES = (
    "index.html",
    "styles.css",
    "src/track-metadata.mjs",
    "src/build-identity.mjs",
    "src/config.mjs",
    "src/core/run-context.mjs",
    "src/core/tap-estimator.mjs",
    "src/core/handoff-planner.mjs",
    "src/core/effects.mjs",
    "src/core/session-reducer.mjs",
    "src/core/evidence-schema.mjs",
    "src/audio/audio-math.mjs",
    "src/audio/percussion-buffer.mjs",
    "src/audio/web-audio-engine.mjs",
    "src/browser/local-track-loader.mjs",
    "src/browser/loaded-session.mjs",
    "src/browser/clock-adapter.mjs",
    "src/browser/coordinator.mjs",
    "src/browser/renderer.mjs",
    "src/browser/main.mjs",
)


class LocalStageError(Exception):
    pass


def stage_one_track(build_commit: str, output: Path) -> None:
    if SHA_PATTERN.fullmatch(build_commit) is None:
        raise LocalStageError("build identity is invalid")
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise LocalStageError("output path is invalid")
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.tmp-", dir=output.parent))
    published = False
    try:
        for relative in FILES:
            source = PRODUCT_ROOT / relative
            if source.is_symlink() or not source.is_file():
                raise LocalStageError("approved source is unavailable")
            content = source.read_bytes()
            expected = 1 if relative == "index.html" or relative.endswith(".mjs") else 0
            if content.count(BUILD_PLACEHOLDER) != expected:
                raise LocalStageError("build identity contract failed")
            destination = temporary / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content.replace(BUILD_PLACEHOLDER, build_commit.encode("ascii")))
        actual = {
            path.relative_to(temporary).as_posix()
            for path in temporary.rglob("*")
            if path.is_file()
        }
        if actual != set(FILES):
            raise LocalStageError("staged file contract failed")
        temporary.rename(output)
        published = True
    finally:
        if not published:
            shutil.rmtree(temporary, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    if len(arguments) != 2:
        print("FAIL local one-track staging: expected build identity and output", file=sys.stderr)
        return 2
    try:
        stage_one_track(arguments[0], Path(arguments[1]))
    except (LocalStageError, OSError):
        print("FAIL local one-track staging: sanitized staging failure", file=sys.stderr)
        return 1
    print(f"PASS local one-track staging files={len(FILES)} audio=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = Path(__file__).resolve().with_name("gate1-public-manifest.json")
ACCEPTED_GATE1_COMMIT = "11df30f6f6cf90940bee425847614abaf26cc6f1"
ROOT_PLACEHOLDER = b"__BUILD_COMMIT__"
ENROLLMENT_PLACEHOLDER = b"__ENROLLMENT_BUILD_COMMIT__"
ONE_TRACK_PLACEHOLDER = b"__BUILD_SHA__"
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
GATE1_SOURCE_ROOT = "spikes/001-mobile-web-audio-gate"
ONE_TRACK_SOURCE_PREFIX = "prototype/one-track"
ONE_TRACK_FILES = (
    ("index.html", "index.html"),
    ("styles.css", "styles.css"),
    ("src/track-metadata.mjs", "src/track-metadata.mjs"),
    ("src/build-identity.mjs", "src/build-identity.mjs"),
    ("src/config.mjs", "src/config.mjs"),
    ("src/core/run-context.mjs", "src/core/run-context.mjs"),
    ("src/core/tap-estimator.mjs", "src/core/tap-estimator.mjs"),
    ("src/core/handoff-planner.mjs", "src/core/handoff-planner.mjs"),
    ("src/core/effects.mjs", "src/core/effects.mjs"),
    ("src/core/session-reducer.mjs", "src/core/session-reducer.mjs"),
    ("src/core/evidence-schema.mjs", "src/core/evidence-schema.mjs"),
    ("src/audio/audio-math.mjs", "src/audio/audio-math.mjs"),
    ("src/audio/percussion-buffer.mjs", "src/audio/percussion-buffer.mjs"),
    ("src/audio/web-audio-engine.mjs", "src/audio/web-audio-engine.mjs"),
    ("src/browser/local-track-loader.mjs", "src/browser/local-track-loader.mjs"),
    ("src/browser/loaded-session.mjs", "src/browser/loaded-session.mjs"),
    ("src/browser/clock-adapter.mjs", "src/browser/clock-adapter.mjs"),
    ("src/browser/coordinator.mjs", "src/browser/coordinator.mjs"),
    ("src/browser/renderer.mjs", "src/browser/renderer.mjs"),
    ("src/browser/main.mjs", "src/browser/main.mjs"),
)
ONE_TRACK_RENDER_DESTINATIONS = frozenset(
    destination for source, destination in ONE_TRACK_FILES if source.endswith((".html", ".mjs"))
)
ROOT_FILES = (
    (f"{GATE1_SOURCE_ROOT}/index.html", "gate1/index.html"),
    (f"{GATE1_SOURCE_ROOT}/styles.css", "gate1/styles.css"),
    (f"{GATE1_SOURCE_ROOT}/app.mjs", "gate1/app.mjs"),
    (f"{GATE1_SOURCE_ROOT}/audio-engine.mjs", "gate1/audio-engine.mjs"),
    (f"{GATE1_SOURCE_ROOT}/audio-math.mjs", "gate1/audio-math.mjs"),
    (f"{GATE1_SOURCE_ROOT}/asset-metadata.json", "gate1/asset-metadata.json"),
    (f"{GATE1_SOURCE_ROOT}/calibration.json", "gate1/calibration.json"),
    (f"{GATE1_SOURCE_ROOT}/assets/gate-track.wav", "gate1/assets/gate-track.wav"),
)
ROOT_MANIFEST_DESTINATIONS = frozenset(destination for _, destination in ROOT_FILES)
ROOT_RENDER_DESTINATIONS = frozenset(
    destination for source, destination in ROOT_FILES if source.endswith((".html", ".mjs"))
)
ENROLLMENT_FILES = (
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
)
PRIVATE_AUDIO_EXTENSIONS = frozenset({
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".aif", ".wma",
})


class StageError(Exception):
    """A deliberately generic, private-data-safe staging failure."""


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise StageError("manifest schema validation failed")
        result[key] = value
    return result


def _safe_relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    return (
        not path.is_absolute()
        and value == path.as_posix()
        and all(part not in {"", ".", ".."} for part in path.parts)
    )


def _load_manifest(path: Path) -> list[dict[str, str]]:
    try:
        document = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
        )
    except StageError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise StageError("manifest could not be read") from error

    if not isinstance(document, dict) or set(document) != {"schemaVersion", "acceptedCommit", "files"}:
        raise StageError("manifest schema validation failed")
    if type(document["schemaVersion"]) is not int or document["schemaVersion"] != 1:
        raise StageError("manifest schema validation failed")
    if document["acceptedCommit"] != ACCEPTED_GATE1_COMMIT:
        raise StageError("manifest accepted identity validation failed")
    files = document["files"]
    if not isinstance(files, list) or len(files) != len(ROOT_FILES):
        raise StageError("manifest allowlist validation failed")

    validated: list[dict[str, str]] = []
    sources: set[str] = set()
    destinations: set[str] = set()
    for entry in files:
        if not isinstance(entry, dict) or set(entry) != {"source", "destination", "sha256"}:
            raise StageError("manifest schema validation failed")
        source = entry["source"]
        destination = entry["destination"]
        digest = entry["sha256"]
        if not _safe_relative_path(source) or not _safe_relative_path(destination):
            raise StageError("manifest path validation failed")
        if not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None:
            raise StageError("manifest hash validation failed")
        if source in sources or destination in destinations:
            raise StageError("manifest duplicate validation failed")
        sources.add(source)
        destinations.add(destination)
        validated.append({"source": source, "destination": destination, "sha256": digest})

    if {(entry["source"], entry["destination"]) for entry in validated} != set(ROOT_FILES):
        raise StageError("manifest allowlist validation failed")
    return validated


def _read_fixed_source(repo_root: Path, relative_path: str) -> bytes:
    candidate = repo_root.joinpath(*PurePosixPath(relative_path).parts)
    try:
        if candidate.is_symlink() or not candidate.is_file():
            raise StageError("approved source validation failed")
        canonical_root = repo_root.resolve(strict=True)
        canonical_candidate = candidate.resolve(strict=True)
        canonical_candidate.relative_to(canonical_root)
        return candidate.read_bytes()
    except StageError:
        raise
    except (OSError, ValueError) as error:
        raise StageError("approved source validation failed") from error


def _write_bytes(root: Path, relative_path: str, content: bytes) -> None:
    destination = root.joinpath(*PurePosixPath(relative_path).parts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)


def _stage_gate1(temp_root: Path, repo_root: Path, manifest: list[dict[str, str]]) -> None:
    accepted = ACCEPTED_GATE1_COMMIT.encode("ascii")
    for entry in manifest:
        content = _read_fixed_source(repo_root, entry["source"])
        expected_count = 1 if entry["destination"] in ROOT_RENDER_DESTINATIONS else 0
        if content.count(ROOT_PLACEHOLDER) != expected_count:
            raise StageError("Gate 1 build identity validation failed")
        rendered = content.replace(ROOT_PLACEHOLDER, accepted)
        if ROOT_PLACEHOLDER in rendered:
            raise StageError("Gate 1 build identity validation failed")
        if hashlib.sha256(rendered).hexdigest() != entry["sha256"]:
            raise StageError("Gate 1 artifact integrity validation failed")
        _write_bytes(temp_root, entry["destination"], rendered)


def _stage_one_track(temp_root: Path, repo_root: Path, deploy_commit: str) -> None:
    deploy_bytes = deploy_commit.encode("ascii")
    for source, destination in ONE_TRACK_FILES:
        content = _read_fixed_source(repo_root, f"{ONE_TRACK_SOURCE_PREFIX}/{source}")
        expected_count = 0 if destination == "styles.css" else 1
        if content.count(ONE_TRACK_PLACEHOLDER) != expected_count:
            raise StageError("one-track build identity validation failed")
        rendered = content.replace(ONE_TRACK_PLACEHOLDER, deploy_bytes)
        if ONE_TRACK_PLACEHOLDER in rendered:
            raise StageError("one-track build identity validation failed")
        if destination in ONE_TRACK_RENDER_DESTINATIONS and rendered.count(deploy_bytes) != expected_count:
            raise StageError("one-track module identity validation failed")
        _write_bytes(temp_root, destination, rendered)


def _stage_enrollment(temp_root: Path, repo_root: Path, deploy_commit: str) -> None:
    source_prefix = "tools/m2-enrollment"
    deploy_bytes = deploy_commit.encode("ascii")
    for filename in ENROLLMENT_FILES:
        relative_source = f"{source_prefix}/{filename}"
        content = _read_fixed_source(repo_root, relative_source)
        expected_count = 2 if filename == "index.html" else (1 if filename.endswith(".mjs") else 0)
        if content.count(ENROLLMENT_PLACEHOLDER) != expected_count:
            raise StageError("enrollment build identity validation failed")
        rendered = content.replace(ENROLLMENT_PLACEHOLDER, deploy_bytes)
        if ENROLLMENT_PLACEHOLDER in rendered:
            raise StageError("enrollment build identity validation failed")
        if filename.endswith(".mjs") and rendered.count(deploy_bytes) != 1:
            raise StageError("enrollment module identity validation failed")
        _write_bytes(temp_root, f"enroll/{filename}", rendered)


def _validate_staged_tree(temp_root: Path, deploy_commit: str) -> None:
    actual = {
        path.relative_to(temp_root).as_posix()
        for path in temp_root.rglob("*")
        if path.is_file()
    }
    expected = {destination for _, destination in ROOT_FILES} | {
        destination for _, destination in ONE_TRACK_FILES
    } | {
        f"enroll/{filename}" for filename in ENROLLMENT_FILES
    }
    if actual != expected:
        raise StageError("staged allowlist validation failed")
    enrollment_root = temp_root / "enroll"
    if any(path.suffix.lower() in PRIVATE_AUDIO_EXTENSIONS for path in enrollment_root.rglob("*")):
        raise StageError("private media staging validation failed")
    gate1_root = temp_root / "gate1"
    if any(path.suffix.lower() in PRIVATE_AUDIO_EXTENSIONS for path in temp_root.rglob("*")
           if not path.is_relative_to(gate1_root)):
        raise StageError("private media staging validation failed")
    deploy_bytes = deploy_commit.encode("ascii")
    for filename in ENROLLMENT_FILES:
        content = (enrollment_root / filename).read_bytes()
        if ENROLLMENT_PLACEHOLDER in content:
            raise StageError("enrollment build identity validation failed")
        if filename.endswith(".mjs") and content.count(deploy_bytes) != 1:
            raise StageError("enrollment module identity validation failed")


def _rename_exclusive(source: Path, destination: Path) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source)
    destination_bytes = os.fsencode(destination)
    try:
        if sys.platform == "darwin":
            rename = libc.renamex_np
            rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            result = rename(source_bytes, destination_bytes, 0x00000004)
        elif sys.platform.startswith("linux"):
            rename = libc.renameat2
            rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            result = rename(-100, source_bytes, -100, destination_bytes, 0x00000001)
        else:
            raise StageError("exclusive publication is unsupported on this platform")
    except AttributeError as error:
        raise StageError("exclusive publication is unsupported by this runtime") from error
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number == errno.EEXIST:
        raise StageError("output already exists")
    if error_number in {errno.ENOSYS, errno.EINVAL}:
        raise StageError("exclusive publication is unsupported by this runtime")
    raise StageError("atomic publication failed")


def stage_pages(
    deploy_commit: str,
    output_path: Path | str,
    *,
    repo_root: Path = REPO_ROOT,
    manifest_path: Path = MANIFEST_PATH,
) -> None:
    if not isinstance(deploy_commit, str) or SHA_PATTERN.fullmatch(deploy_commit) is None:
        raise StageError("deploy identity validation failed")
    output = Path(output_path)
    repository = Path(repo_root)
    manifest_file = Path(manifest_path)
    try:
        if output.exists() or output.is_symlink():
            raise StageError("output already exists")
        parent = output.parent
        if not parent.is_dir():
            raise StageError("output parent validation failed")
        manifest = _load_manifest(manifest_file)
        temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.tmp-", dir=parent))
    except StageError:
        raise
    except OSError as error:
        raise StageError("temporary staging setup failed") from error

    published = False
    try:
        _stage_gate1(temporary, repository, manifest)
        _stage_one_track(temporary, repository, deploy_commit)
        _stage_enrollment(temporary, repository, deploy_commit)
        _validate_staged_tree(temporary, deploy_commit)
        _rename_exclusive(temporary, output)
        published = True
    except StageError:
        raise
    except (OSError, UnicodeError) as error:
        raise StageError("Pages staging failed") from error
    finally:
        if not published:
            shutil.rmtree(temporary, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    if len(arguments) != 2:
        print("FAIL Pages staging: expected deploy identity and output", file=sys.stderr)
        return 2
    try:
        stage_pages(arguments[0], Path(arguments[1]))
    except StageError as error:
        print(f"FAIL Pages staging: {error}", file=sys.stderr)
        return 1
    print(f"PASS staged Pages artifact build={arguments[0]} root=one-track enroll=preserved files={len(ONE_TRACK_FILES) + len(ROOT_FILES) + len(ENROLLMENT_FILES)} audio=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

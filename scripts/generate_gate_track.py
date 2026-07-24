#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 44_100
CHANNELS = 2
DURATION_SECONDS = 16
FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS
SUBDIVISION_SAMPLES = SAMPLE_RATE // 4
PCM_LIMIT = int(32_767 * 0.80)
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "spikes" / "001-mobile-web-audio-gate"


def triangle(phase: int) -> int:
    position = (phase >> 16) & 0xFFFF
    if position < 0x8000:
        return (position * 2) - 32_768
    return 98_303 - (position * 2)


def phase_increment(frequency_millihz: int) -> int:
    return (frequency_millihz << 32) // (SAMPLE_RATE * 1_000)


def add_tone(buffer: list[int], start: int, duration: int, frequency_millihz: int, amplitude: int, square: bool = False) -> None:
    phase = 0
    increment = phase_increment(frequency_millihz)
    for offset in range(duration):
        remaining = duration - offset
        envelope = (remaining * remaining * 32_767) // (duration * duration)
        raw = 32_767 if (square and phase < 0x80000000) else -32_768 if square else triangle(phase)
        buffer[start + offset] += (raw * amplitude * envelope) // (32_768 * 32_767)
        phase = (phase + increment) & 0xFFFFFFFF


def add_kick(buffer: list[int], start: int, strong: bool) -> None:
    duration = SAMPLE_RATE * 18 // 100
    phase = 0
    for offset in range(duration):
        remaining = duration - offset
        envelope = (remaining * remaining * 32_767) // (duration * duration)
        frequency = 95_000 - (55_000 * offset // duration)
        phase = (phase + phase_increment(frequency)) & 0xFFFFFFFF
        amplitude = 10_500 if strong else 7_500
        buffer[start + offset] += (triangle(phase) * amplitude * envelope) // (32_768 * 32_767)


def add_hat(buffer: list[int], start: int, seed: int) -> None:
    duration = SAMPLE_RATE * 4 // 100
    state = (seed | 1) & 0x7FFFFFFF
    for offset in range(duration):
        remaining = duration - offset
        envelope = (remaining * 1_200) // duration
        state = ((state >> 1) ^ (0x60000000 if state & 1 else 0)) & 0x7FFFFFFF
        raw = 1 if state & 1 else -1
        buffer[start + offset] += raw * envelope


def event_manifest() -> list[dict[str, int | str]]:
    events: list[dict[str, int | str]] = []
    for subdivision in range(DURATION_SECONDS * 4):
        sample = subdivision * SUBDIVISION_SAMPLES
        events.append({"voice": "hat", "sample": sample})
        if subdivision % 2:
            continue
        beat = subdivision // 2
        entry = beat == 4
        events.append({"voice": "kick-strong" if entry else "kick", "sample": sample})
        events.append({"voice": "bass-strong" if entry else "bass", "sample": sample})
        if beat % 4 == 0:
            events.append({"voice": "chord-strong" if entry else "chord", "sample": sample})
    return events


def synthesize() -> bytes:
    mono = [0] * FRAME_COUNT
    for event_index, event in enumerate(event_manifest()):
        start = int(event["sample"])
        voice = str(event["voice"])
        if voice.startswith("kick"):
            add_kick(mono, start, voice.endswith("strong"))
        elif voice == "hat":
            add_hat(mono, start, start + event_index + 1)
        elif voice.startswith("bass"):
            add_tone(mono, start, SAMPLE_RATE * 35 // 100, 55_000, 3_000 if voice.endswith("strong") else 1_800, square=True)
        elif voice.startswith("chord"):
            amplitude = 1_600 if voice.endswith("strong") else 900
            duration = SAMPLE_RATE * 3 // 4
            for frequency in (220_000, 277_000, 330_000):
                add_tone(mono, start, duration, frequency, amplitude)

    pcm = bytearray()
    for sample in mono:
        clipped = max(-PCM_LIMIT, min(PCM_LIMIT, sample))
        pcm.extend(struct.pack("<hh", clipped, clipped))
    return bytes(pcm)


def generate(output_dir: Path) -> dict[str, object]:
    output_dir = Path(output_dir)
    assets_dir = output_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    wav_path = assets_dir / "gate-track.wav"

    pcm = synthesize()
    with wave.open(str(wav_path), "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm)

    digest = hashlib.sha256(wav_path.read_bytes()).hexdigest()
    metadata: dict[str, object] = {
        "id": "gate-track-v1",
        "bpm": 120,
        "sampleRate": SAMPLE_RATE,
        "channels": CHANNELS,
        "durationSeconds": DURATION_SECONDS,
        "targetEntryDownbeatSeconds": 2.0,
        "postCrossfadeTailSeconds": 2.0,
        "generator": "scripts/generate_gate_track.py",
        "sha256": digest,
        "subdivisionSamples": SUBDIVISION_SAMPLES,
        "events": event_manifest(),
    }
    (output_dir / "asset-metadata.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the deterministic BPM Music Match Gate 1 track.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()
    metadata = generate(args.output_dir)
    print(metadata["sha256"])


if __name__ == "__main__":
    main()

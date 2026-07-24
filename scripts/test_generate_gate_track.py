from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
import wave
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = REPO_ROOT / "scripts" / "generate_gate_track.py"
SPIKE_ROOT = REPO_ROOT / "spikes" / "001-mobile-web-audio-gate"
COMMITTED_WAV = SPIKE_ROOT / "assets" / "gate-track.wav"
COMMITTED_METADATA = SPIKE_ROOT / "asset-metadata.json"
LICENSE_PATH = SPIKE_ROOT / "ASSET-LICENSE.md"


def load_generator():
    if not GENERATOR_PATH.exists():
        raise AssertionError(f"missing generator: {GENERATOR_PATH.relative_to(REPO_ROOT)}")
    spec = importlib.util.spec_from_file_location("generate_gate_track", GENERATOR_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load generator: {GENERATOR_PATH.relative_to(REPO_ROOT)}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GateTrackGenerationTests(unittest.TestCase):
    def test_generated_asset_matches_audio_and_event_contract(self):
        generator = load_generator()
        with tempfile.TemporaryDirectory() as first_dir, tempfile.TemporaryDirectory() as second_dir:
            first = Path(first_dir)
            second = Path(second_dir)
            generator.generate(first)
            generator.generate(second)

            first_wav = first / "assets" / "gate-track.wav"
            second_wav = second / "assets" / "gate-track.wav"
            first_metadata = json.loads((first / "asset-metadata.json").read_text())
            second_metadata = json.loads((second / "asset-metadata.json").read_text())

            self.assertEqual(first_wav.read_bytes(), second_wav.read_bytes())
            self.assertEqual(first_metadata, second_metadata)
            self.assertEqual(first_wav.read_bytes(), COMMITTED_WAV.read_bytes())
            self.assertEqual(first_metadata, json.loads(COMMITTED_METADATA.read_text()))

            digest = hashlib.sha256(first_wav.read_bytes()).hexdigest()
            self.assertEqual(first_metadata["sha256"], digest)
            self.assertEqual(first_metadata["id"], "gate-track-v1")
            self.assertEqual(first_metadata["bpm"], 120)
            self.assertEqual(first_metadata["sampleRate"], 44_100)
            self.assertEqual(first_metadata["channels"], 2)
            self.assertEqual(first_metadata["durationSeconds"], 16)
            self.assertEqual(first_metadata["targetEntryDownbeatSeconds"], 2.0)
            self.assertEqual(first_metadata["postCrossfadeTailSeconds"], 2.0)
            self.assertEqual(first_metadata["generator"], "scripts/generate_gate_track.py")

            with wave.open(str(first_wav), "rb") as wav_file:
                self.assertEqual(wav_file.getframerate(), 44_100)
                self.assertEqual(wav_file.getnchannels(), 2)
                self.assertEqual(wav_file.getsampwidth(), 2)
                self.assertEqual(wav_file.getnframes(), 705_600)
                frames = wav_file.readframes(wav_file.getnframes())

            samples = [int.from_bytes(frames[i : i + 2], "little", signed=True) for i in range(0, len(frames), 2)]
            self.assertLessEqual(max(abs(sample) for sample in samples), int(32_767 * 0.80))

            subdivision_samples = first_metadata["subdivisionSamples"]
            events = first_metadata["events"]
            self.assertGreater(len(events), 0)
            self.assertTrue(all(event["sample"] % subdivision_samples == 0 for event in events))

            entry_events = {event["voice"] for event in events if event["sample"] == 88_200}
            before_events = {event["voice"] for event in events if event["sample"] == 66_150}
            after_events = {event["voice"] for event in events if event["sample"] == 110_250}
            self.assertTrue({"kick-strong", "bass-strong", "chord-strong"}.issubset(entry_events))
            self.assertNotIn("chord-strong", before_events)
            self.assertNotIn("chord-strong", after_events)

    def test_asset_license_declares_original_cc0_synthesis(self):
        text = LICENSE_PATH.read_text()
        self.assertIn("CC0-1.0", text)
        self.assertIn("no third-party samples", text.lower())
        self.assertIn("generated for this repository", text.lower())


if __name__ == "__main__":
    unittest.main()

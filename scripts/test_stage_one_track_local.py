from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.stage_one_track_local import FILES, LocalStageError, stage_one_track


BUILD = "0123456789abcdef0123456789abcdef01234567"


class LocalOneTrackStagingTests(unittest.TestCase):
    def test_stages_only_the_production_surface_with_one_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            stage_one_track(BUILD, output)
            actual = {
                path.relative_to(output).as_posix()
                for path in output.rglob("*")
                if path.is_file()
            }
            self.assertEqual(actual, set(FILES))
            self.assertNotIn("tests", actual)
            self.assertNotIn("__BUILD_SHA__", (output / "index.html").read_text(encoding="utf-8"))
            self.assertEqual((output / "src/build-identity.mjs").read_text().count(BUILD), 1)

    def test_refuses_invalid_identity_and_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(LocalStageError):
                stage_one_track("not-a-commit", root / "site")
            output = root / "existing"
            output.mkdir()
            with self.assertRaises(LocalStageError):
                stage_one_track(BUILD, output)


if __name__ == "__main__":
    unittest.main()

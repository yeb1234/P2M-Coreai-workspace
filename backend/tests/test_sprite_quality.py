import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import sprite


class SpriteQualityTest(unittest.TestCase):
    def test_default_sprite_frame_width_is_high_enough_for_card_preview(self):
        self.assertGreaterEqual(sprite.FRAME_WIDTH, 320)
        self.assertLessEqual(sprite.JPEG_QUALITY, 2)

    def test_low_resolution_sprite_metadata_is_treated_as_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "42.jpg").write_bytes(b"fake")
            (folder / "42.json").write_text(json.dumps({
                "video_id": 42,
                "cols": sprite.COLS,
                "rows": 1,
                "frame_width": 160,
                "frame_height": 90,
                "frame_interval": sprite.FRAME_INTERVAL,
                "total_frames": 1,
                "duration": 5,
                "jpeg_quality": sprite.JPEG_QUALITY,
            }), encoding="utf-8")

            with patch.object(sprite, "SPRITE_FOLDER", folder):
                self.assertFalse(sprite.has_sprite(42))

    def test_current_sprite_metadata_is_reusable(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "42.jpg").write_bytes(b"fake")
            (folder / "42.json").write_text(json.dumps({
                "video_id": 42,
                "cols": sprite.COLS,
                "rows": 1,
                "frame_width": sprite.FRAME_WIDTH,
                "frame_height": int(sprite.FRAME_WIDTH * 9 / 16),
                "frame_interval": sprite.FRAME_INTERVAL,
                "total_frames": 1,
                "duration": 5,
                "jpeg_quality": sprite.JPEG_QUALITY,
            }), encoding="utf-8")

            with patch.object(sprite, "SPRITE_FOLDER", folder):
                self.assertTrue(sprite.has_sprite(42))


if __name__ == "__main__":
    unittest.main()

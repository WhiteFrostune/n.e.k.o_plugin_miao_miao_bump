"""Inspect the distributed sprite and its frame registration without editing it."""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def test_juzi_frames_have_transparency_and_do_not_crop_opaque_pixels() -> None:
    assets = ROOT / "static" / "assets"
    metadata = json.loads((assets / "juzi.json").read_text(encoding="utf-8"))
    with Image.open(assets / metadata["image"]) as image:
        assert image.mode == "RGBA"
        alpha = image.getchannel("A")
        assert alpha.getpixel((0, 0)) < 10
        assert alpha.getpixel((image.width // 2, 0)) < 10
        opaque = alpha.point(lambda value: 255 if value > 128 else 0)
        previous_right = 0
        for frame in metadata["frames"]:
            assert frame["x"] >= previous_right
            right = frame["x"] + frame["width"]
            bottom = frame["y"] + frame["height"]
            assert right <= image.width and bottom <= image.height
            bounds = opaque.crop((frame["x"], frame["y"], right, bottom)).getbbox()
            assert bounds is not None
            assert bounds[0] > 0 and bounds[1] > 0
            assert bounds[2] < frame["width"] and bounds[3] < frame["height"]
            previous_right = right
    assert [frame["name"] for frame in metadata["frames"]] == ["idle", "impact", "rebound"]
    assert metadata["collisionRadius"] == 40
    assert metadata["pixelGrid"] == {"width": 48, "height": 56}

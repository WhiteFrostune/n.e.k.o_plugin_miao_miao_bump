"""Inspect the distributed sprite and its frame registration without editing it."""

import hashlib
import json
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("character", ["juzi", "pudding", "milkcap"])
@pytest.mark.parametrize("art_set", ["classic", "concept-v2"])
def test_frames_have_transparency_and_do_not_crop_opaque_pixels(character: str, art_set: str) -> None:
    assets = ROOT / "static" / "assets"
    if art_set != "classic":
        assets = assets / "characters" / art_set
    metadata = json.loads((assets / f"{character}.json").read_text(encoding="utf-8"))
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
    if art_set == "classic":
        assert metadata["pixelGrid"] == {"width": 48, "height": 56}
    else:
        assert metadata["integratedFloat"] is True
        grid = metadata["pixelGrid"]
        assert 80 <= grid["width"] <= 96 and 80 <= grid["height"] <= 112
        box = metadata["drawBox"]
        assert abs((box["width"] / grid["width"]) / (box["height"] / grid["height"]) - 1) < 0.02
        float_ref = metadata["floatReference"]
        scale = box["width"] / metadata["frames"][0]["width"]
        assert abs(scale * float_ref["diameterInSource"] - 80) < 0.001
        assert abs(box["x"] + float_ref["centerInFirstFrame"]["x"] * scale) < 0.001
        assert abs(box["y"] + float_ref["centerInFirstFrame"]["y"] * scale) < 0.001
        crop = metadata["portraitBox"]
        assert crop["width"] == crop["height"]
        assert crop["x"] + crop["width"] <= grid["width"]
        assert crop["y"] + crop["height"] <= grid["height"]


def test_original_character_files_remain_byte_for_byte_available() -> None:
    hashes = json.loads((ROOT / "docs/art/classic-assets-sha256.json").read_text(encoding="utf-8"))
    for filename, expected in hashes.items():
        assert "\\" not in filename, "Asset manifest paths must use portable forward slashes"
        assert hashlib.sha256((ROOT / filename).read_bytes()).hexdigest() == expected


def test_juzi_knockout_parts_are_complete_transparent_assets_with_a_real_ring_hole() -> None:
    assets = ROOT / "static/assets/characters/knockout-v1"
    metadata = json.loads((assets / "juzi.json").read_text(encoding="utf-8"))
    assert [part["id"] for part in metadata["parts"]] == ["float", "character"]
    for part in metadata["parts"]:
        with Image.open(assets / part["image"]) as image:
            assert image.mode == "RGBA"
            alpha = image.getchannel("A")
            assert alpha.getpixel((0, 0)) == 0
            box = part["source"]
            crop = (box["x"], box["y"], box["x"] + box["width"], box["y"] + box["height"])
            assert crop[2] <= image.width and crop[3] <= image.height
            opaque = alpha.point(lambda a: 255 if a > 128 else 0)
            bounds = opaque.getbbox()
            assert bounds and crop[0] < bounds[0] and crop[1] < bounds[1]
            assert crop[2] > bounds[2] and crop[3] > bounds[3]
            grid = part["pixelGrid"]
            draw = part["drawBox"]
            assert abs(draw["width"] / draw["height"] - grid["width"] / grid["height"]) < 0.02
            if part["id"] == "float":
                assert alpha.getpixel((image.width // 2, image.height // 2)) == 0
                # A whole open donut, rather than a C-shaped or filled float.
                assert alpha.getpixel((image.width // 2, 200)) > 128
                assert alpha.getpixel((image.width // 2, 800)) > 128
                assert alpha.getpixel((200, image.height // 2)) > 128
                assert alpha.getpixel((1400, image.height // 2)) > 128


def test_juzi_motion_study_has_complete_poses_and_head_registration() -> None:
    assets = ROOT / "docs/art/juzi-motion-study-v1"
    metadata = json.loads((assets / "poses.json").read_text(encoding="utf-8"))
    assert [frame["id"] for frame in metadata["frames"]] == ["impact", "extend", "tuck"]
    with Image.open(assets / metadata["image"]) as image:
        assert image.mode == "RGBA"
        alpha = image.getchannel("A")
        assert alpha.getpixel((0, 0)) == 0
        opaque = alpha.point(lambda value: 255 if value > 128 else 0)
        for frame in metadata["frames"]:
            box, anchor = frame["source"], frame["headAnchor"]
            right, bottom = box["x"] + box["width"], box["y"] + box["height"]
            assert 0 <= box["x"] < right <= image.width
            assert 0 <= box["y"] < bottom <= image.height
            bounds = opaque.crop((box["x"], box["y"], right, bottom)).getbbox()
            assert bounds and bounds[0] > 0 and bounds[1] > 0
            assert bounds[2] < box["width"] and bounds[3] < box["height"]
            assert box["x"] < anchor["x"] < right and box["y"] < anchor["y"] < bottom
            assert 0 < frame["headWidth"] <= box["width"]


def test_live_juzi_poses_preserve_the_approved_study_and_old_parts() -> None:
    assets = ROOT / "static/assets/characters/knockout-poses-v1"
    metadata = json.loads((assets / "juzi.json").read_text(encoding="utf-8"))
    study = ROOT / "docs/art/juzi-motion-study-v1"
    reference = json.loads((study / "poses.json").read_text(encoding="utf-8"))
    assert (assets / metadata["image"]).read_bytes() == (study / reference["image"]).read_bytes()
    assert metadata["frames"] == reference["frames"]
    assert metadata["headWidthInWorld"] == reference["headWidthInWorld"]
    character = ROOT / "static/assets/characters/concept-v2/juzi.json"
    links = json.loads(character.read_text(encoding="utf-8"))
    assert (character.parent / links["knockoutPoses"]).resolve() == assets / "juzi.json"
    assert (character.parent / links["knockout"]).is_file()


def test_unseating_study_keeps_every_complete_pose_inside_its_registration() -> None:
    assets = ROOT / "docs/art/juzi-unseat-study-v1"
    metadata = json.loads((assets / "poses.json").read_text(encoding="utf-8"))
    assert [frame["id"] for frame in metadata["frames"]] == ["contact", "release", "tumble", "follow"]
    with Image.open(assets / metadata["image"]) as image:
        assert image.mode == "RGBA"
        opaque = image.getchannel("A").point(lambda value: 255 if value > 128 else 0)
        for frame in metadata["frames"]:
            box, anchor = frame["source"], frame["anchor"]
            right, bottom = box["x"] + box["width"], box["y"] + box["height"]
            assert 0 <= box["x"] < right <= image.width
            assert 0 <= box["y"] < bottom <= image.height
            bounds = opaque.crop((box["x"], box["y"], right, bottom)).getbbox()
            assert bounds and bounds[0] > 0 and bounds[1] > 0
            assert bounds[2] < box["width"] and bounds[3] < box["height"]
            assert box["x"] < anchor["x"] < right and box["y"] < anchor["y"] < bottom


def test_live_unseat_art_preserves_study_and_previous_optional_assets() -> None:
    assets = ROOT / "static/assets/characters/unseat-v1"
    study = ROOT / "docs/art/juzi-unseat-study-v1"
    metadata = json.loads((assets / "juzi.json").read_text(encoding="utf-8"))
    assert metadata == json.loads((study / "poses.json").read_text(encoding="utf-8"))
    assert (assets / metadata["image"]).read_bytes() == (study / metadata["image"]).read_bytes()
    character = ROOT / "static/assets/characters/concept-v2/juzi.json"
    links = json.loads(character.read_text(encoding="utf-8"))
    assert (character.parent / links["unseat"]).resolve() == assets / "juzi.json"
    assert (character.parent / links["knockoutPoses"]).is_file()
    assert (character.parent / links["knockout"]).is_file()


@pytest.mark.parametrize("character", ["juzi", "pudding", "milkcap"])
def test_swim_v2_has_four_registered_poses_and_matching_split_parts(character: str) -> None:
    assets = ROOT / "static/assets/characters/unseat-v2"
    metadata = json.loads((assets / f"{character}.json").read_text(encoding="utf-8"))
    split = json.loads((assets / f"{character}-split.json").read_text(encoding="utf-8"))
    assert [f["id"] for f in metadata["frames"]] == ["contact", "release", "tumble", "follow"]
    assert metadata["faceRestY"] == -35 and metadata["worldPerSourcePixel"] == .21
    assert [p["id"] for p in split["parts"]] == ["float", "character"]
    with Image.open(assets / metadata["image"]) as image:
        assert image.mode == "RGBA"
        alpha = image.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
        for frame in metadata["frames"]:
            box, anchor = frame["source"], frame["anchor"]
            right, bottom = box["x"] + box["width"], box["y"] + box["height"]
            assert 0 <= box["x"] < right <= image.width
            assert 0 <= box["y"] < bottom <= image.height
            assert box["x"] < anchor["x"] < right and box["y"] < anchor["y"] < bottom
            opaque = alpha.crop((box["x"], box["y"], right, bottom)).getbbox()
            assert opaque and opaque[0] > 0 and opaque[1] > 0
            assert opaque[2] < box["width"] and opaque[3] < box["height"]
        ring = split["parts"][0]
        box = ring["source"]
        assert alpha.getpixel((box["x"] + box["width"] // 2, box["y"] + int(box["height"] * .43))) == 0
        assert ring["drawBox"]["width"] == 80
        for part in split["parts"]:
            assert part["image"] == metadata["image"]
            assert 0 < part["pixelGrid"]["width"] <= 256
            assert 0 < part["pixelGrid"]["height"] <= 256
    live = ROOT / "static/assets/characters/concept-v2" / f"{character}.json"
    links = json.loads(live.read_text(encoding="utf-8"))
    assert (live.parent / links["knockoutV2"]).resolve() == assets / f"{character}-split.json"
    assert (live.parent / links["unseatV2"]).resolve() == assets / f"{character}.json"

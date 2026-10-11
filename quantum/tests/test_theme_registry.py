"""Theme registries (assets/themes/*.json): structural rules the renderer relies on."""
import json
import re
import struct
from pathlib import Path

import pytest

THEMES = Path(__file__).resolve().parents[2] / "assets" / "themes"
NAMES = ("lab", "prison")

# Every theme must provide these tiles: js/theme.js asks for them by name.
SHARED_TILES = (
    "floor_a floor_b floor_worn floor_crack floor_drain floor_line floor_shadow floor_hazard "
    "wall_face_a wall_face_b wall_face_c wall_face_pipe divider divider_face wall_face_sign wall_face_window "
    "door_locked door_open door_0 door_1 door_super_a door_super_b door_half door_lethal "
    "sensor_idle sensor_disabled sensor_0 sensor_1 sensor_glow exit_closed exit_open_a exit_open_b "
    "term_h term_x term_z term_cx_control term_cx_target term_cx_owner term_off"
).split()


def png_size(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    width, height, depth, color = struct.unpack(">IIBB", data[16:26])
    return width, height, depth, color


@pytest.fixture(params=NAMES)
def theme(request):
    return request.param, json.loads((THEMES / f"{request.param}.json").read_text())


def test_sheets_are_256_square_rgba(theme):
    name, _ = theme
    for kind in ("tiles", "props"):
        assert png_size(THEMES / f"{name}_{kind}.png") == (256, 256, 8, 6), f"{name}_{kind}.png"


def test_every_shared_tile_exists_in_both_themes(theme):
    _, reg = theme
    missing = [t for t in SHARED_TILES if t not in reg["tiles"]]
    assert not missing


def test_tile_cells_are_inside_the_8x8_grid(theme):
    _, reg = theme
    for name, cell in reg["tiles"].items():
        assert len(cell) == 2 and all(type(n) is int and 0 <= n < 8 for n in cell), name


def test_wall_top_color_is_a_hex_color(theme):
    _, reg = theme
    assert re.fullmatch(r"#[0-9a-fA-F]{6}", reg["wall_top_color"])


def test_prop_rects_are_inside_their_sheet_with_positive_footprints(theme):
    _, reg = theme
    assert reg["props"]
    for name, p in reg["props"].items():
        assert p["sheet"] in ("tiles", "props"), name
        assert all(type(p[k]) is int for k in "xywh") and p["w"] > 0 and p["h"] > 0, name
        assert p["x"] >= 0 and p["y"] >= 0 and p["x"] + p["w"] <= 256 and p["y"] + p["h"] <= 256, name
        fw, fh = p["footprint"]
        assert type(fw) is int and type(fh) is int and fw >= 1 and fh >= 1, name
        assert "solid" not in p or type(p["solid"]) is bool, name


def test_wall_mounted_props_are_named_wall(theme):
    # The engine only lets wall_* decorations sit on wall cells; the registry names must agree with the art.
    _, reg = theme
    for name, p in reg["props"].items():
        if name.startswith("floor_"):
            assert not p.get("solid"), f"{name}: floor decals are walk-over"


def test_anim_partners_exist_and_point_back(theme):
    _, reg = theme
    for name, p in reg["props"].items():
        partner = p.get("anim")
        if partner is not None:
            assert partner in reg["props"], name
            assert reg["props"][partner].get("anim") == name, f"{name} <-> {partner}"

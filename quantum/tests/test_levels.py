import copy
import json

import pytest

from quantum.levels import LEVEL_IDS, audio_payload, read_level, validate_level


@pytest.fixture(params=LEVEL_IDS)
def level(request):
    return read_level(request.param)


def test_builtin_level_assets_validate_and_literal_loading(level):
    assert validate_level(level) == level
    assert level["num_qubits"] == 2
    assert level["stages"]
    assert json.dumps(level, allow_nan=False)
    for stage in level["stages"]:
        assert len(stage["map"]) == 9  # 15x9 maps, divider in the middle column
        assert all(len(row) == 15 and row[7] in "#|" for row in stage["map"])
        for text in stage["narration"].values():
            assert len(text.splitlines()) <= 2
            assert all(len(line) <= 40 for line in text.splitlines())


@pytest.mark.parametrize("mutate", [
    lambda d: d.update(schema_version=3),
    lambda d: d.update(id="other"),
    lambda d: d.update(num_qubits=True),
    lambda d: d.update(num_qubits=2.0),
    lambda d: d["stages"].clear(),
    lambda d: d["stages"][0].update(max_gates=True),
    lambda d: d["stages"][0].update(map=["##", "#"]),
    lambda d: d["stages"][0].update(win={"q9": 0}),
    lambda d: d["stages"][0].update(win={"q0": True}),
    lambda d: d["stages"][0].update(required_measurements=[True]),
    lambda d: d["stages"][0].update(failure_policy="unknown"),
    lambda d: d["stages"][0].update(terminals=[None]),
    lambda d: d["stages"][0].update(gate_set=["alice", "bob", "shared"]),
    lambda d: d["stages"][0].update(objects={"bad": None}),
])
def test_rejects_malformed_schema_and_terminal_coordinates(level, mutate):
    bad = copy.deepcopy(level)
    mutate(bad)
    with pytest.raises((ValueError, TypeError)):
        validate_level(bad)


def test_terminal_ids_gate_owners_and_coordinates_are_validated(level):
    for stage in level["stages"]:
        for terminal in stage["terminals"]:
            assert terminal["owner"] in {"alice", "bob", "shared"}
            assert terminal["gate"] in stage["gate_set"][terminal["owner"]]
            assert terminal["id"] == stage["legend"][stage["map"][terminal["cell"][0]][terminal["cell"][1]]]
            if terminal["gate"] == "cx" and terminal["owner"] == "shared":
                assert terminal["target_cell"]
            elif terminal["gate"] == "cx":
                assert terminal["owner"] == "bob"
                assert terminal["activation"] == "owner"
                assert "target_cell" not in terminal


def test_terminal_bad_owner_gate_use_and_target_rejected(level):
    stage = level["stages"][0]
    if not stage["terminals"]:
        assert level["id"] == "level1"
        assert stage["max_gates"] == 0
        return
    for mutation in (
        lambda t: t.update(owner="nobody"),
        lambda t: t.update(gate="unsupported"),
        lambda t: t.update(cell=[999, 999]),
        lambda t: t.update(uses=0),
    ):
        bad = copy.deepcopy(level)
        mutation(bad["stages"][0]["terminals"][0])
        with pytest.raises((ValueError, TypeError)):
            validate_level(bad)


TRACK_FILES = {"menu": "fondo_inicio.ogg", "level1": "fondo_1.ogg", "level2": "fondo_2.ogg"}


@pytest.mark.parametrize("track", sorted(TRACK_FILES))
def test_every_track_is_base64_ogg_from_its_own_file(track):
    import base64
    data = audio_payload(track)
    assert data["encoding"] == "base64"
    assert data["mime"] == "audio/ogg"
    raw = base64.b64decode(data["data"], validate=True)
    assert raw[:4] == b"OggS"
    with open(f"audio/{TRACK_FILES[track]}", "rb") as handle:
        assert raw == handle.read()


def test_default_track_is_the_menu_track():
    assert audio_payload() == audio_payload("menu")


@pytest.mark.parametrize("track", ["soundtrack", "", "../levels/level1", None, 3, "MENU", "level3"])
def test_unknown_track_is_rejected_with_invalid_track(track):
    from quantum.engine import load_audio
    result = json.loads(load_audio(track))
    assert result["code"] == "INVALID_TRACK"
    assert "data" not in result
    with pytest.raises(ValueError):
        audio_payload(track)


def test_audio_missing_asset_is_graceful(tmp_path, monkeypatch):
    from quantum.engine import load_audio
    monkeypatch.chdir(tmp_path)
    assert json.loads(load_audio("menu"))["code"] == "AUDIO_UNAVAILABLE"
    assert json.loads(load_audio())["code"] == "AUDIO_UNAVAILABLE"


def test_audio_over_2mb_is_rejected(tmp_path, monkeypatch):
    from quantum.engine import load_audio
    monkeypatch.chdir(tmp_path)
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "fondo_1.ogg").write_bytes(b"OggS" + b"\0" * (2 * 1024 * 1024))
    assert json.loads(load_audio("level1"))["code"] == "AUDIO_UNAVAILABLE"
    (tmp_path / "audio" / "fondo_1.ogg").write_bytes(b"OggS" + b"\0" * 1024)
    assert json.loads(load_audio("level1"))["mime"] == "audio/ogg"


# ---- decorations: purely visual layer, validated but never read by the engine ----

@pytest.mark.parametrize("deco", [
    {"sprite": "plant", "cell": [4, 1], "footprint": [1, 1]},      # floor
    {"sprite": "floor_mat", "cell": [6, 4], "footprint": [2, 1]},
    {"sprite": "wall_light", "cell": [0, 5], "footprint": [1, 1]},  # wall cell, wall_ prefix
])
def test_valid_decorations_are_accepted(deco):
    level = read_level("level1")
    level["stages"][0]["decorations"] = [deco]
    assert validate_level(level)["stages"][0]["decorations"] == [deco]


@pytest.mark.parametrize("deco", [
    "plant",
    {"cell": [4, 1], "footprint": [1, 1]},                                   # no sprite
    {"sprite": "", "cell": [4, 1], "footprint": [1, 1]},
    {"sprite": 3, "cell": [4, 1], "footprint": [1, 1]},
    {"sprite": "plant", "cell": [4], "footprint": [1, 1]},
    {"sprite": "plant", "cell": [True, 1], "footprint": [1, 1]},
    {"sprite": "plant", "cell": [4, 1.0], "footprint": [1, 1]},
    {"sprite": "plant", "cell": [-1, 1], "footprint": [1, 1]},
    {"sprite": "plant", "cell": [12, 1], "footprint": [1, 1]},               # row out of map
    {"sprite": "plant", "cell": [4, 20], "footprint": [1, 1]},               # col out of map
    {"sprite": "plant", "cell": [4, 1]},                                     # no footprint
    {"sprite": "plant", "cell": [4, 1], "footprint": [0, 1]},
    {"sprite": "plant", "cell": [4, 1], "footprint": [1, -2]},
    {"sprite": "plant", "cell": [4, 1], "footprint": [True, 1]},
    {"sprite": "plant", "cell": [4, 1], "footprint": [1, 1, 1]},
    {"sprite": "plant", "cell": [4, 19], "footprint": [2, 1]},               # footprint leaves the map
    {"sprite": "plant", "cell": [11, 1], "footprint": [1, 2]},
    {"sprite": "plant", "cell": [0, 5], "footprint": [1, 1]},                # wall cell, not wall_*
])
def test_invalid_decorations_are_rejected(deco):
    level = read_level("level1")
    level["stages"][0]["decorations"] = [deco]
    with pytest.raises(ValueError):
        validate_level(level)


def test_decorations_must_be_a_list():
    level = read_level("level1")
    level["stages"][0]["decorations"] = {"sprite": "plant"}
    with pytest.raises(ValueError):
        validate_level(level)


@pytest.mark.parametrize("cell", [
    [2, 2],   # alice_start
    [2, 12],  # bob_start
    [5, 2],   # alice_h terminal
    [5, 11],  # bob_cx terminal
    [4, 3],   # sensor_q0
    [4, 10],  # sensor_q1
    [6, 1],   # door_A
    [7, 1],   # exit_A
    [6, 13],  # door_B
    [7, 13],  # exit_B
])
def test_decorations_never_cover_interactive_cells(cell):
    level = read_level("level1")
    level["stages"][0]["decorations"] = [{"sprite": "floor_mat", "cell": cell, "footprint": [1, 1]}]
    with pytest.raises(ValueError):
        validate_level(level)


def test_multi_cell_footprint_is_checked_on_every_covered_cell():
    level = read_level("level1")
    level["stages"][0]["decorations"] = [{"sprite": "wall_light", "cell": [1, 3], "footprint": [1, 2]}]
    validate_level(level)  # (1,3),(2,3): plain floor
    level["stages"][0]["decorations"] = [{"sprite": "wall_light", "cell": [5, 1], "footprint": [1, 2]}]
    with pytest.raises(ValueError):  # covers (5,1) floor and (6,1) = door_A
        validate_level(level)


def test_level1_decorations_are_visual_only_and_the_engine_ignores_them():
    from quantum.verify import verify_stage
    stage = read_level("level1")["stages"][0]
    assert stage["decorations"]
    grid, legend = stage["map"], stage["legend"]
    for d in stage["decorations"]:
        row, col = d["cell"]
        w, h = d["footprint"]
        for r in range(row, row + h):
            for c in range(col, col + w):
                label = legend[grid[r][c]]
                assert label in {"floor", "wall"}, (d, r, c, label)
                if label == "wall":
                    assert d["sprite"].startswith("wall_") and r == 0
    # The engine ignores the layer: same verification report with or without it.
    stripped = copy.deepcopy(stage)
    del stripped["decorations"]
    assert verify_stage(stage) == verify_stage(stripped)




# ---- theme and solid decorations (visual layer, validated by the engine contract) ----

@pytest.mark.parametrize("theme", ["lab", "prison"])
def test_known_themes_are_accepted_and_survive_validation(theme):
    level = read_level("level1")
    level["theme"] = theme
    assert validate_level(level)["theme"] == theme


@pytest.mark.parametrize("theme", ["jungle", "", None, 3, ["lab"], "LAB"])
def test_unknown_themes_are_rejected(theme):
    level = read_level("level1")
    level["theme"] = theme
    with pytest.raises(ValueError):
        validate_level(level)


def test_theme_is_optional():
    level = read_level("level1")
    level.pop("theme", None)
    assert "theme" not in validate_level(level)


def test_shipped_levels_declare_their_theme():
    assert [read_level(n)["theme"] for n in LEVEL_IDS] == ["lab", "prison", "lab"]


def test_load_level_hands_the_theme_to_the_client():
    import asyncio
    from quantum.engine import Engine
    out = json.loads(asyncio.run(Engine().load_level("level2")))
    assert out["theme"] == "prison"


@pytest.mark.parametrize("solid", [True, False])
def test_solid_flag_on_a_decoration_is_accepted(solid):
    level = read_level("level1")
    deco = {"sprite": "plant", "cell": [4, 1], "footprint": [1, 1], "solid": solid}
    level["stages"][0]["decorations"] = [deco]
    assert validate_level(level)["stages"][0]["decorations"] == [deco]


@pytest.mark.parametrize("solid", ["yes", 1, 0, None, [True]])
def test_solid_flag_must_be_a_boolean(solid):
    level = read_level("level1")
    level["stages"][0]["decorations"] = [{"sprite": "plant", "cell": [4, 1], "footprint": [1, 1], "solid": solid}]
    with pytest.raises(ValueError):
        validate_level(level)

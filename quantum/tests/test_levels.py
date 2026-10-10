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
        assert len(stage["map"]) == 12
        assert all(len(row) == 20 and row[9] in "#|" and row[10] in "#|" for row in stage["map"])
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


def test_audio_is_base64_when_available_and_missing_is_graceful(tmp_path, monkeypatch):
    from quantum.engine import load_audio
    monkeypatch.chdir(tmp_path)
    assert json.loads(load_audio())["code"] == "AUDIO_UNAVAILABLE"
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "soundtrack.ogg").write_bytes(b"OggS-test")
    data = audio_payload()
    assert data["encoding"] == "base64"
    assert data["mime"] == "audio/ogg"
    assert isinstance(data["data"], str)


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
    [2, 17],  # bob_start
    [5, 2],   # alice_h terminal
    [5, 16],  # bob_cx terminal
    [4, 3],   # sensor_q0
    [4, 13],  # sensor_q1
    [8, 1],   # door_A
    [9, 1],   # exit_A
    [8, 18],  # door_B
    [9, 18],  # exit_B
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
    level["stages"][0]["decorations"] = [{"sprite": "wall_light", "cell": [7, 1], "footprint": [1, 2]}]
    with pytest.raises(ValueError):  # covers (7,1) floor and (8,1) = door_A
        validate_level(level)


def test_level1_decorations_are_visual_only_and_off_the_critical_cells():
    from collections import deque
    from quantum.verify import verify_stage
    stage = read_level("level1")["stages"][0]
    decorations = stage["decorations"]
    assert sorted(d["sprite"] for d in decorations) == sorted(
        ["tank_a", "tank_b", "plant", "plant", "floor_mat", "floor_mat", "wall_light", "wall_light"]
        + ["floor_grate"] * 4)
    grid, legend = stage["map"], stage["legend"]
    cells = {legend[ch]: (r, c) for r, row in enumerate(grid) for c, ch in enumerate(row)}
    in_front = {(cells["door_A"][0] - 1, cells["door_A"][1]), (cells["door_B"][0] - 1, cells["door_B"][1])}
    covered = set()
    for d in decorations:
        row, col = d["cell"]
        w, h = d["footprint"]
        for r in range(row, row + h):
            for c in range(col, col + w):
                covered.add((r, c))
                label = legend[grid[r][c]]
                assert label in {"floor", "wall"}, (d, r, c, label)
                if label == "wall":
                    assert d["sprite"].startswith("wall_") and r == 0
    assert not covered & in_front
    # Alice's and Bob's sides mirror each other (column c <-> 19 - c).
    mirrored = {(r, 19 - c) for r, c in covered}
    assert mirrored == covered
    # Treating decorations as obstacles, each spawn still reaches its terminal, sensor and door.
    free = {(r, c) for r, row in enumerate(grid) for c, ch in enumerate(row)
            if legend[ch] != "wall" and (r, c) not in covered}

    def reach(start):
        seen, queue = {start}, deque([start])
        while queue:
            r, c = queue.popleft()
            for step in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if step in free and step not in seen:
                    seen.add(step)
                    queue.append(step)
        return seen

    for spawn, terminal, sensor, door in (("alice_start", "alice_h", "sensor_q0", "door_A"),
                                          ("bob_start", "bob_cx", "sensor_q1", "door_B")):
        reachable = reach(cells[spawn])
        assert {cells[terminal], cells[sensor], in_front_of(cells[door])} <= reachable

    # The engine ignores the layer: same verification report with or without it.
    stripped = copy.deepcopy(stage)
    del stripped["decorations"]
    assert verify_stage(stage) == verify_stage(stripped)


def in_front_of(door):
    return (door[0] - 1, door[1])


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


def test_load_level_hands_the_theme_to_the_client():
    import asyncio
    from quantum.engine import Engine
    out = json.loads(asyncio.run(Engine().load_level("level1")))
    assert out["theme"] in {"lab", "prison"}


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

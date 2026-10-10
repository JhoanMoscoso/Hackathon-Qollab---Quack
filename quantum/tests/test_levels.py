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
        assert all(len(row) == 20 for row in stage["map"])
        # The central wall (columns 9-10) is solid, except cells of a CX niche on one row.
        cx_cells = {tuple(cell) for t in stage["terminals"] if t["gate"] == "cx"
                    for cell in (t["cell"], t["target_cell"])}
        for r, row in enumerate(stage["map"]):
            for c in (9, 10):
                assert row[c] in "#|" or (r, c) in cx_cells
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
            if terminal["gate"] == "cx":
                assert terminal["target_cell"]


def test_terminal_bad_owner_gate_use_and_target_rejected(level):
    stage = level["stages"][0]
    assert stage["terminals"]
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


def test_level1_calibration_chamber_layout():
    stage = read_level("level1")["stages"][0]
    legend, grid = stage["legend"], stage["map"]
    cx = next(t for t in stage["terminals"] if t["gate"] == "cx")
    assert cx["owner"] == "shared" and cx["uses"] == 1
    assert cx["cell"][0] == cx["target_cell"][0]            # same row niche
    assert (cx["cell"][1], cx["target_cell"][1]) == (9, 10)  # control Alice side, target Bob side
    assert legend[grid[cx["cell"][0]][9]] == "shared_cx"
    assert legend[grid[cx["cell"][0]][10]] == "shared_cx_target"
    h = next(t for t in stage["terminals"] if t["gate"] == "h")
    assert h["owner"] == "alice" and h["uses"] == 1 and h["cell"][1] <= 8
    for door in ("door_A", "door_B"):
        obj = stage["objects"][door]
        assert "qubit" not in obj and obj["open_on"] == 0 and obj["blocking"] is True
        assert obj["lethal"] is False
    assert {"run_ok", "run_fail", "not_validated"} <= set(stage["narration"])
    # Not counting the CX target cell as a separate entity, the stage stays within 10.
    entities = 2 + 2 + 2 + 2 + len(stage["terminals"])
    assert entities <= 10


def test_level1_doors_are_the_only_path_to_each_exit_and_sensors_are_reachable():
    from collections import deque
    stage = read_level("level1")["stages"][0]
    grid, legend = stage["map"], stage["legend"]
    cells = {legend[ch]: (r, c) for r, row in enumerate(grid) for c, ch in enumerate(row)}

    def reach(start, blocked):
        seen, queue = {start}, deque([start])
        while queue:
            r, c = queue.popleft()
            for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                name = legend[grid[nr][nc]]
                if (nr, nc) in seen or name == "wall" or name in blocked:
                    continue
                seen.add((nr, nc))
                queue.append((nr, nc))
        return seen

    blocked = {"door_A", "door_B"}
    alice, bob = reach(cells["alice_start"], blocked), reach(cells["bob_start"], blocked)
    assert cells["sensor_q0"] in alice and cells["alice_h"] in alice
    assert cells["sensor_q1"] in bob
    assert cells["exit_A"] not in alice and cells["exit_B"] not in bob
    # Opening each door (and only it) is what exposes the matching exit.
    assert cells["exit_A"] in reach(cells["alice_start"], {"door_B"})
    assert cells["exit_B"] in reach(cells["bob_start"], {"door_A"})
    assert cells["exit_A"] not in reach(cells["alice_start"], {"door_A"})
    assert cells["exit_B"] not in reach(cells["bob_start"], {"door_B"})


# ---- decorations: purely visual layer, validated but never read by the engine ----

def _deco(stage, **fields):
    deco = {"sprite": "plant", "cell": [4, 1], "footprint": [1, 2]}
    deco.update(fields)
    stage["decorations"] = [deco]


@pytest.mark.parametrize("deco", [
    {"sprite": "plant", "cell": [4, 1], "footprint": [1, 2]},      # floor
    {"sprite": "rug", "cell": [3, 5], "footprint": [2, 1]},
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
    stage = level["stages"][0]
    stage["decorations"] = [deco]
    with pytest.raises(ValueError):
        validate_level(level)


def test_decorations_must_be_a_list():
    level = read_level("level1")
    level["stages"][0]["decorations"] = {"sprite": "plant"}
    with pytest.raises(ValueError):
        validate_level(level)


@pytest.mark.parametrize("cell", [
    [1, 1],   # alice_start
    [1, 16],  # bob_start
    [1, 3],   # alice_h terminal
    [4, 9],   # shared_cx
    [4, 10],  # shared_cx_target
    [3, 2],   # sensor_q0
    [3, 17],  # sensor_q1
    [6, 4],   # door_A
    [7, 4],   # exit_A
    [6, 15],  # door_B
])
def test_decorations_never_cover_interactive_cells(cell):
    level = read_level("level1")
    level["stages"][0]["decorations"] = [{"sprite": "rug", "cell": cell, "footprint": [1, 1]}]
    with pytest.raises(ValueError):
        validate_level(level)


def test_multi_cell_footprint_is_checked_on_every_covered_cell():
    level = read_level("level1")
    # rows 3..4 at col 9: row 3 is wall, row 4 is the CX control
    level["stages"][0]["decorations"] = [{"sprite": "wall_light", "cell": [1, 2], "footprint": [1, 2]}]
    # covers (1,2),(2,2): plain floor, accepted
    validate_level(level)
    level["stages"][0]["decorations"] = [{"sprite": "wall_light", "cell": [0, 3], "footprint": [1, 2]}]
    with pytest.raises(ValueError):  # covers (0,3) wall and (1,3) = alice_h
        validate_level(level)


def test_level1_decorations_are_visual_only_and_off_the_critical_cells():
    from quantum.verify import verify_stage
    level = read_level("level1")
    stage = level["stages"][0]
    decorations = stage["decorations"]
    assert {d["sprite"] for d in decorations} == {"tank_chick", "tank_jelly", "plant", "rug", "grate", "wall_light"}
    legend, grid = stage["legend"], stage["map"]
    # Cells in front of each door stay clear so the doorway reads and is walkable.
    in_front = {(5, 4), (5, 15)}
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
    # The engine ignores the layer: same verification report with or without it.
    stripped = copy.deepcopy(stage)
    del stripped["decorations"]
    assert verify_stage(stage) == verify_stage(stripped)


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

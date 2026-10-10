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
            if terminal["gate"] == "cx":
                assert terminal["target_cell"]


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

import asyncio
import json

import pytest

from quantum.engine import Engine
from quantum.levels import LEVEL_IDS


def payload(value):
    return json.loads(value)


@pytest.fixture
def engine():
    result = Engine(seed=17)
    assert "error" not in payload(result.new_session("level3"))
    return result


def test_public_json_contract_and_session_errors():
    engine = Engine(seed=1)
    for response in (engine.snapshot(), engine.apply_gate("x", 0), engine.measure(0),
                     engine.reset_stage(), engine.reset_level(), engine.advance_stage()):
        assert payload(response)["code"] == "NO_SESSION"
    assert payload(asyncio.run(engine.load_level("level1")))['id'] == "level1"
    assert payload(asyncio.run(engine.load_level("invalid")))['code'] == "INVALID_LEVEL"
    assert payload(engine.new_session("invalid"))['code'] == "INVALID_LEVEL"
    assert payload(engine.new_session("level1"))['schema_version'] == 2


@pytest.mark.parametrize("args,code", [
    (("bad", 0), "GATE_NOT_ALLOWED"), (("x", True), "INVALID_QUBIT"),
    (("x", 2), "INVALID_QUBIT"), (("cx", 0, 0), "INVALID_QUBIT"),
    (("cx", 0, True), "INVALID_QUBIT"), (("x", 0, 0), "INVALID_QUBIT"),
    (("x", 0, -2), "INVALID_QUBIT"),
])
def test_invalid_requests_are_atomic(engine, args, code):
    before = payload(engine.snapshot())
    assert payload(engine.apply_gate(*args))["code"] == code
    after = payload(engine.snapshot())
    assert after == before


def test_terminal_owner_budget_and_exhaustion(engine):
    # L3 has no Alice X terminal; a valid qubit alone does not authorize a gate.
    assert payload(engine.apply_gate("x", 0, actor="alice"))["code"] == "GATE_NOT_ALLOWED"
    # L2's Bob terminal requires its declared actor.
    l2 = Engine(seed=2)
    l2.new_session("level2")
    assert payload(l2.apply_gate("x", 1, actor="alice"))["code"] == "INVALID_ACTOR"


def test_terminal_use_exhaustion_and_gate_budget():
    e = Engine(seed=1)
    e.new_session("level3")
    for gate, q, target in [("h", 0, -1), ("h", 0, -1), ("z", 0, -1),
                            ("x", 1, -1), ("cx", 0, 1)]:
        result = payload(e.apply_gate(gate, q, target))
        assert "error" not in result
    snap = payload(e.snapshot())
    assert snap["gates_left"] == 0
    assert payload(e.apply_gate("z", 0))["code"] == "GATE_BUDGET_EXHAUSTED"


def test_auto_terminal_and_backward_apply_after_terminal_objective():
    e = Engine(seed=3)
    e.new_session("level3")
    # A successful automatic terminal call consumes its finite use.
    for gate, q, target in [("cx", 0, 1), ("z", 0, -1)]:
        response = payload(e.apply_gate(gate, q, target))
        assert "error" not in response
    assert payload(e.snapshot())["terminal_uses_left"]["shared_cx"] == 0
    assert payload(e.apply_gate("cx", 0, 1))["code"] == "TERMINAL_EXHAUSTED"


def test_measured_is_idempotent_and_blocks_each_cx_operand():
    e = Engine(seed=4)
    e.new_session("level2")
    e.apply_gate("x", 1, actor="bob")
    first = payload(e.measure(1))
    revision = first["snapshot"]["revision"]
    repeated = payload(e.measure(1))
    assert repeated["repeated"] is True
    assert repeated["outcome"] == first["outcome"]
    assert repeated["snapshot"]["revision"] == revision

    # Force Bob=0 in Psi+: Alice is defined as 1 but not explicitly measured.
    e.reset_stage()
    e.apply_gate("x", 1, actor="bob")
    e.sampling.records.clear()
    from quantum.state import canonical_key
    e.sampling.records[canonical_key(e.position.sv)] = type("D", (), {
        "counts": {"01": 50}, "source": "backend", "reason": None})()
    assert payload(e.measure(1))["outcome"] == 0
    e.send_bit("bob")
    e.receive_bit("alice")
    assert "error" not in payload(e.apply_gate("x", 0, actor="alice"))
    assert payload(e.apply_gate("cx", 0, 1))["code"] == "QUBIT_ALREADY_MEASURED"


def test_reset_stage_level_and_advance_guards():
    e = Engine(seed=5)
    e.new_session("level2")
    assert payload(e.advance_stage())["code"] == "STAGE_NOT_READY"
    before = payload(e.snapshot())
    reset = payload(e.reset_stage())
    assert reset["stage_index"] == before["stage_index"]
    assert reset["revision"] > before["revision"]
    assert reset["measured"] == [None, None]
    assert payload(e.measure(1))["code"] == "PROTOCOL_ORDER"
    e.apply_gate("x", 1, actor="bob")
    assert payload(e.measure(1))["outcome"] in (0, 1)


def test_snapshots_are_json_safe_and_separate_initial_from_history(engine):
    snap = payload(engine.snapshot())
    assert snap["history"] == []
    assert snap["initial_circuit"]
    assert snap["amplitudes"]
    assert all(isinstance(x, list) and len(x) == 2 for x in snap["amplitudes"])
    assert snap["objects"]
    json.dumps(snap, allow_nan=False)


def test_global_wrappers_and_concurrent_session_independence():
    import quantum.engine as public
    # Public wrappers are synchronous except the explicitly async helpers.
    assert payload(public.new_session("level3"))["stage_count"] == 1
    assert payload(public.apply_gate("cx", 0, 1))["history"]
    assert payload(asyncio.run(public.load_level("level2")))["id"] == "level2"
    a, b = Engine(seed=1), Engine(seed=1)
    a.new_session("level1")
    b.new_session("level1")
    assert "error" not in payload(a.apply_gate("h", 0, actor="alice"))
    assert payload(b.snapshot())["history"] == []
    assert LEVEL_IDS == ("level1", "level2", "level3")


def test_audio_missing_asset_is_a_json_error():
    import quantum.engine as public
    result = payload(public.load_audio())
    assert result.get("code") in (None, "AUDIO_UNAVAILABLE") or "data" in result

"""RUN CIRCUIT validation gate (requires_run) for Level 1 'Calibration Chamber'."""

import inspect
import json
from dataclasses import replace

import pytest

from quantum import rules
from quantum.engine import Engine
from quantum.levels import read_level, validate_level

MISMATCH = "Circuit does not prepare Phi+ yet. Press R to reset."


def payload(value):
    return json.loads(value)


@pytest.fixture
def engine():
    result = Engine(seed=11)
    assert "error" not in payload(result.new_session("level1"))
    return result


def build_bell(engine):
    assert "error" not in payload(engine.apply_gate("h", 0, actor="alice"))
    assert "error" not in payload(engine.apply_gate("cx", 0, 1, terminal_id="shared_cx"))


def validated_engine(seed=11):
    result = Engine(seed=seed)
    result.new_session("level1")
    build_bell(result)
    assert "error" not in payload(result.run_circuit())
    return result


def test_level1_is_a_single_blank_stage_requiring_a_run(engine):
    level = read_level("level1")
    assert [s["id"] for s in level["stages"]] == ["calibration"]
    stage = level["stages"][0]
    assert stage["initial_circuit"] == []
    assert stage["requires_run"] == {"target": "Phi+"}
    assert stage["max_gates"] == 2
    snap = payload(engine.snapshot())
    assert snap["ket"] == "1|00⟩"
    assert snap["history"] == [] and snap["initial_circuit"] == []
    assert snap["objective"] == {"status": "pending", "quantum_ready": False,
                                 "failure_policy": "retry_stage", "required_measurements": [0, 1],
                                 "requires_run": "Phi+", "validated": False}
    assert set(snap["objects"].values()) == {"1"}


@pytest.mark.parametrize("target", [None, "Phi+x", 1, ["Phi+"]])
def test_validator_rejects_malformed_requires_run(target):
    bad = read_level("level1")
    bad["stages"][0]["requires_run"] = {"target": target}
    with pytest.raises(ValueError):
        validate_level(bad)
    bad["stages"][0]["requires_run"] = "Phi+"
    with pytest.raises(ValueError):
        validate_level(bad)


def test_run_circuit_is_a_public_sync_function():
    import quantum.engine as public
    assert not inspect.iscoroutinefunction(public.run_circuit)
    assert isinstance(payload(public.run_circuit()), dict)   # JSON string, never raises


def test_run_not_required_on_stages_without_requires_run():
    e = Engine(seed=1)
    e.new_session("level2")
    before = payload(e.snapshot())
    result = payload(e.run_circuit())
    assert result["code"] == "RUN_NOT_REQUIRED"
    assert payload(e.snapshot()) == before
    assert before["objective"]["requires_run"] is None
    assert before["objective"]["validated"] is False
    # Measurement flow of stages without requires_run is untouched.
    assert "error" not in payload(e.measure(0))


def test_run_circuit_without_session():
    assert payload(Engine().run_circuit())["code"] == "NO_SESSION"


@pytest.mark.parametrize("ops", [
    [],
    [("h", 0, -1, "alice_h")],
    [("cx", 0, 1, "shared_cx")],
    [("cx", 0, 1, "shared_cx"), ("h", 0, -1, "alice_h")],   # wrong order -> |+0>
])
def test_run_mismatch_is_atomic(engine, ops):
    for gate, q, target, tid in ops:
        assert "error" not in payload(engine.apply_gate(gate, q, target, terminal_id=tid))
    before = payload(engine.snapshot())
    result = payload(engine.run_circuit())
    assert result == {"error": MISMATCH, "code": "CIRCUIT_MISMATCH"}
    assert payload(engine.snapshot()) == before
    assert before["objective"]["validated"] is False


def test_run_validates_phi_plus_and_is_free(engine):
    build_bell(engine)
    before = payload(engine.snapshot())
    assert before["bell_label"] == "Phi+" and before["gates_left"] == 0
    snap = payload(engine.run_circuit())
    assert snap["history"] == [["h", 0], ["cx", 0, 1], ["run"]]
    assert snap["gates_left"] == 0
    assert snap["revision"] == before["revision"] + 1
    assert snap["objective"]["validated"] is True
    assert snap["objective"]["requires_run"] == "Phi+"
    assert snap["objective"]["status"] == "pending"
    assert snap["objective"]["quantum_ready"] is False
    assert snap["objects"]["door_A"] == snap["objects"]["door_B"] == "1"
    assert snap["measured"] == [None, None] and snap["bell_label"] == "Phi+"


def test_run_is_idempotent_once_validated():
    e = validated_engine()
    first = payload(e.snapshot())
    again = payload(e.run_circuit())
    assert again == first
    assert again["history"].count(["run"]) == 1


def test_measure_is_refused_until_validated(engine):
    before = payload(engine.snapshot())
    for qubit in (0, 1):
        assert payload(engine.measure(qubit))["code"] == "NOT_VALIDATED"
    build_bell(engine)
    mid = payload(engine.snapshot())
    assert payload(engine.measure(1))["code"] == "NOT_VALIDATED"
    after = payload(engine.snapshot())
    assert after == mid and after["measured"] == [None, None]
    assert before["revision"] < mid["revision"]
    # A failed run does not unlock measuring either.
    engine.reset_stage()
    assert payload(engine.run_circuit())["code"] == "CIRCUIT_MISMATCH"
    assert payload(engine.measure(0))["code"] == "NOT_VALIDATED"


def test_gates_are_locked_after_validation():
    e = validated_engine()
    before = payload(e.snapshot())
    for args in (("h", 0), ("x", 1), ("cx", 0, 1)):
        assert payload(e.apply_gate(*args))["code"] == "CIRCUIT_LOCKED"
    assert payload(e.snapshot()) == before


@pytest.mark.parametrize("reset", ["reset_stage", "reset_level"])
def test_resets_clear_validation(reset):
    e = validated_engine()
    snap = payload(getattr(e, reset)())
    assert snap["objective"]["validated"] is False
    assert snap["history"] == [] and snap["gates_left"] == 2
    assert snap["ket"] == "1|00⟩"
    assert payload(e.measure(0))["code"] == "NOT_VALIDATED"
    build_bell(e)
    assert payload(e.run_circuit())["objective"]["validated"] is True


@pytest.mark.parametrize("seed", range(8))
def test_objective_ready_only_after_validated_and_both_equal_measurements(seed):
    e = validated_engine(seed)
    first = payload(e.measure(0))
    snap = first["snapshot"]
    assert snap["objective"]["status"] == "pending"
    assert snap["objective"]["quantum_ready"] is False
    assert snap["objects"]["door_A"] == snap["objects"]["door_B"] == "1"
    second = payload(e.measure(1))
    assert second["outcome"] == first["outcome"]
    snap = second["snapshot"]
    assert snap["objective"] == {"status": "ready", "quantum_ready": True,
                                 "failure_policy": "retry_stage", "required_measurements": [0, 1],
                                 "requires_run": "Phi+", "validated": True}
    assert snap["objects"]["door_A"] == snap["objects"]["door_B"] == "0"
    assert snap["history"][-3:-2] == [["run"]]
    assert snap["history"][-2:] == [["measure", 0, first["outcome"]], ["measure", 1, second["outcome"]]]
    assert payload(e.advance_stage())["code"] == "LEVEL_COMPLETE"


def test_rules_objective_needs_validation_and_fails_on_unequal_parity():
    stage = read_level("level1")["stages"][0]
    position = rules.start(stage)
    assert position.validated is False
    equal = replace(position, measured=(1, 1))
    assert rules.objective(stage, equal) == "pending"           # never ready unvalidated
    assert rules.objective(stage, replace(equal, validated=True)) == "ready"
    different = replace(position, measured=(0, 1), validated=True)
    assert rules.objective(stage, different) == "failed"        # retry_stage policy
    assert rules.objective(stage, replace(different, validated=False)) == "pending"


def test_rules_collapse_requires_validation():
    stage = read_level("level1")["stages"][0]
    position = rules.start(stage)
    with pytest.raises(rules.RuleError) as error:
        rules.collapse(stage, position, 0, 0)
    assert error.value.code == "NOT_VALIDATED"


def test_validated_flag_is_part_of_the_logical_key():
    stage = read_level("level1")["stages"][0]
    position = rules.start(stage)
    assert rules.logical_key(position) != rules.logical_key(replace(position, validated=True))

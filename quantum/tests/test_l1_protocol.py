"""Contract tests for the validated Bell-pair preparation in Level 1."""

import json
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

import pytest
from qiskit.quantum_info import Statevector

from quantum import engine as public_engine
from quantum import rules
from quantum.engine import Engine
from quantum.sampling import Distribution
from quantum.state import canonical_key


ROOT = Path(__file__).resolve().parents[2]
REQUIRED_SEQUENCE = [["h", 0], ["cx", 0, 1]]


def payload(value):
    return json.loads(value)


@pytest.fixture
def engine():
    result = Engine(seed=23)
    response = payload(result.new_session("level1"))
    assert "error" not in response
    return result


def bell_stage(engine):
    return next(stage for stage in engine.level["stages"] if stage["id"] == "bell_preparation")


def prepare_bell(engine):
    assert "error" not in payload(engine.apply_gate("h", 0, actor="alice"))
    assert "error" not in payload(engine.apply_gate("cx", 0, 1, actor="bob"))


def test_level_one_preparation_contract_and_initial_snapshot(engine):
    level = engine.level
    stage = bell_stage(engine)
    assert stage["id"] == "bell_preparation"
    assert stage["initial_circuit"] == []
    assert stage["validation"] == {
        "target_bell": "Phi+",
        "required_sequence": REQUIRED_SEQUENCE,
    }
    assert stage["gate_set"] == {"alice": ["h"], "bob": ["cx"], "shared": []}
    assert stage["max_gates"] == 2
    assert {t["owner"] for t in stage["terminals"]} == {"alice", "bob"}
    assert all(t["uses"] == 1 for t in stage["terminals"])
    snap = payload(engine.snapshot())
    assert snap["stage_id"] == "bell_preparation"
    assert snap["history"] == []
    assert snap["objective"]["quantum_ready"] is False
    validation = snap["circuit_validation"]
    assert validation == {
        "required": True, "target_bell": "Phi+", "validated": False,
        "status": "building", "required_sequence": REQUIRED_SEQUENCE,
    }
    assert snap["measurement_enabled"] is False
    assert snap["exits_unlocked"] is False
    assert snap["door_states"] == {"door_A": "closed", "door_B": "closed"}
    assert level["id"] == "level1"


def test_gate_ownership_sequence_validation_and_idempotent_run(engine):
    before = payload(engine.snapshot())
    assert payload(engine.apply_gate("h", 0))["code"] == "ACTOR_REQUIRED"
    assert payload(engine.apply_gate("cx", 0, 1))["code"] == "ACTOR_REQUIRED"
    assert payload(engine.snapshot()) == before
    assert payload(engine.apply_gate("cx", 0, 1, actor="alice"))["code"] == "INVALID_ACTOR"
    prepare_bell(engine)
    before_run = payload(engine.snapshot())
    result = payload(engine.run_circuit())
    assert result["circuit_validation"]["validated"] is True
    assert result["circuit_validation"]["status"] == "validated"
    assert result["measurement_enabled"] is True
    assert result["history"] == [*REQUIRED_SEQUENCE, ["run_circuit"]]
    assert result["revision"] == before_run["revision"] + 1
    repeated = payload(engine.run_circuit())
    assert repeated == result
    assert payload(engine.apply_gate("h", 0, actor="alice"))["code"] == "CIRCUIT_LOCKED"


def test_measure_before_validation_is_atomic_and_does_not_sample(engine):
    sample = Mock(wraps=engine.sampling.measure)
    engine.sampling.measure = sample
    before = payload(engine.snapshot())
    assert payload(engine.measure(0))["code"] == "CIRCUIT_NOT_VALIDATED"
    assert sample.call_count == 0
    assert payload(engine.snapshot()) == before


@pytest.mark.parametrize("counts,expected", [({"00": 200}, 0), ({"11": 200}, 1)])
def test_measurements_keep_doors_closed_until_equal_pair(engine, counts, expected):
    prepare_bell(engine)
    assert "error" not in payload(engine.run_circuit())
    engine.sampling.records[canonical_key(engine.position.sv)] = Distribution(counts, "backend")
    first = payload(engine.measure(0))
    assert first["outcome"] == expected
    midway = first["snapshot"]
    assert midway["door_states"] == {"door_A": "closed", "door_B": "closed"}
    assert midway["exits_unlocked"] is False
    second = payload(engine.measure(1))
    assert second["outcome"] == expected
    final = second["snapshot"]
    assert final["door_states"] == {"door_A": "open", "door_B": "open"}
    assert final["exits_unlocked"] is True
    assert final["objective"]["quantum_ready"] is True
    assert final["history"][-2:] == [["measure", 0, expected], ["measure", 1, expected]]


def test_wrong_sequence_and_incomplete_run_errors_are_atomic(engine):
    assert payload(engine.run_circuit())["code"] == "CIRCUIT_INCOMPLETE"
    assert "error" not in payload(engine.apply_gate("cx", 0, 1, actor="bob"))
    before = payload(engine.snapshot())
    assert payload(engine.run_circuit())["code"] == "INVALID_CIRCUIT"
    assert payload(engine.snapshot()) == before
    engine.apply_gate("h", 0, actor="alice")
    assert payload(engine.run_circuit())["code"] == "INVALID_CIRCUIT"


def test_bell_validator_accepts_global_phase_and_rejects_wrong_physical_state(engine):
    prepare_bell(engine)
    stage = bell_stage(engine)
    position = engine.position
    phased = replace(position, sv=Statevector(-position.sv.data))
    assert rules.run_circuit(stage, phased).circuit_validated is True
    wrong = replace(position, sv=Statevector.from_label("00"))
    with pytest.raises(rules.RuleError):
        rules.run_circuit(stage, wrong)
    from quantum.state import evolve_gate
    phi_minus = replace(position, sv=evolve_gate(position.sv, "z", 0))
    assert phi_minus.sv.probabilities_dict() == position.sv.probabilities_dict()
    with pytest.raises(rules.RuleError, match="target Bell"):
        rules.run_circuit(stage, phi_minus)


def test_pure_objective_requires_validation_proof_and_equal_parity(engine):
    stage = bell_stage(engine)
    position = rules.start(stage)
    position = replace(position, measured=(0, 0))
    assert rules.objective(stage, position) == "pending"
    proved = replace(position, circuit_validated=True)
    assert rules.objective(stage, proved) == "ready"
    assert rules.objective(stage, replace(proved, measured=(0, 1))) == "failed"
    engine.position = replace(proved, measured=(0, 1))
    snap = payload(engine.snapshot())
    assert snap["door_states"] == {"door_A": "closed", "door_B": "closed"}
    assert snap["exits_unlocked"] is False


def test_validation_not_required_on_level_two_and_run_circuit_json_error():
    e = Engine(seed=2)
    e.new_session("level2")
    assert payload(e.run_circuit())["code"] == "VALIDATION_NOT_REQUIRED"
    no_session = payload(Engine().run_circuit())
    assert no_session["code"] == "NO_SESSION"


def test_public_wrapper_and_snapshot_fixture(engine, monkeypatch):
    assert callable(public_engine.run_circuit)
    fixture = ROOT / "docs" / "snapshot-level1-example.json"
    expected = json.loads(fixture.read_text(encoding="utf-8"))
    assert payload(engine.snapshot()) == expected
    monkeypatch.setattr(public_engine, "_engine", engine)
    assert payload(public_engine.run_circuit())["code"] == "CIRCUIT_INCOMPLETE"
    prepare_bell(engine)
    assert payload(public_engine.run_circuit())["circuit_validation"]["validated"] is True


def test_reset_clears_proof_history_measurements_and_terminal_uses(engine):
    prepare_bell(engine)
    engine.run_circuit()
    engine.measure(0)
    reset = payload(engine.reset_stage())
    assert reset["circuit_validation"]["validated"] is False
    assert reset["circuit_validation"]["status"] == "building"
    assert reset["measurement_enabled"] is False
    assert reset["exits_unlocked"] is False
    assert reset["history"] == []
    assert reset["measured"] == [None, None]
    assert sorted(reset["terminal_uses_left"].values()) == [1, 1]


def test_prepared_bell_still_needs_run_and_repeated_run_after_collapse_is_idempotent(engine):
    prepare_bell(engine)
    before = payload(engine.snapshot())
    assert before["bell_label"] == "Phi+"
    assert payload(engine.measure(1))["code"] == "CIRCUIT_NOT_VALIDATED"
    assert payload(engine.snapshot()) == before
    engine.run_circuit()
    first = payload(engine.measure(1))["snapshot"]
    assert first["bell_label"] is None  # Projection does not invalidate the earlier proof.
    assert payload(engine.run_circuit()) == first
    final = payload(engine.measure(0))["snapshot"]
    assert final["exits_unlocked"] is True
    assert payload(engine.run_circuit()) == final


def test_physical_doors_dominate_both_exit_paths(engine):
    from collections import deque
    stage = engine.stage
    def reachable(start_symbol, blocked):
        grid = stage["map"]
        start = next((r, c) for r, row in enumerate(grid) for c, ch in enumerate(row) if ch == start_symbol)
        queue, seen = deque([start]), {start}
        while queue:
            r, c = queue.popleft()
            for rr, cc in ((r+1, c), (r-1, c), (r, c+1), (r, c-1)):
                if (0 <= rr < len(grid) and 0 <= cc < len(grid[0])
                        and grid[rr][cc] not in {"#", *blocked} and (rr, cc) not in seen):
                    seen.add((rr, cc))
                    queue.append((rr, cc))
        return {grid[r][c] for r, c in seen}
    assert "E" not in reachable("A", {"D"})
    assert "e" not in reachable("B", {"d"})
    assert "E" in reachable("A", set())
    assert "e" in reachable("B", set())


def test_run_measure_and_resets_reuse_the_single_backend_job(engine):
    import asyncio
    from qiskit.providers.basic_provider import BasicSimulator
    class CountingBackend:
        def __init__(self):
            self.backend = BasicSimulator()
            self.calls = 0
        def __getattr__(self, name):
            return getattr(self.backend, name)
        def run(self, *args, **kwargs):
            self.calls += 1
            return self.backend.run(*args, **kwargs)
    async def check():
        backend = CountingBackend()
        summary = payload(await engine.precompute(backend, 50, "single"))
        assert summary["backend_states"] == 1
        prepare_bell(engine)
        engine.run_circuit()
        engine.measure(0)
        engine.measure(1)
        engine.run_circuit()
        engine.reset_level()
        again = payload(await engine.precompute(backend, 50, "single"))
        assert again == summary
        assert backend.calls == 1
    asyncio.run(check())


@pytest.mark.parametrize("mutate", [
    lambda s: s.update(initial_circuit=[["h", 0], ["cx", 0, 1]]),
    lambda s: s.update(max_gates=1),
    lambda s: s["validation"].update(required_sequence=[]),
    lambda s: s["validation"].update(target_bell="not-bell"),
    lambda s: s["terminals"][1].update(qubit=1),
    lambda s: s["terminals"][1].update(target=True),
    lambda s: s["terminals"][1].update(activation="shared"),
    lambda s: s["objects"]["door_A"].update(open_on=0),
    lambda s: s.update(required_measurements=[0]),
    lambda s: s.pop("validation"),
])
def test_protocol_schema_rejects_preparation_and_door_bypasses(engine, mutate):
    from copy import deepcopy
    from quantum.levels import validate_level
    level = deepcopy(engine.level)
    mutate(level["stages"][0])
    with pytest.raises(ValueError):
        validate_level(level)

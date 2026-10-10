"""Pure gameplay transitions shared by the engine and the exact verifier."""

from __future__ import annotations

from dataclasses import dataclass, replace

from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

from quantum.state import bell_label, canonical_key, evolve_gate, initial_state, marginals, project


class RuleError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Position:
    sv: Statevector
    measured: tuple[int | None, ...]
    gates_used: int
    uses_left: tuple[int | None, ...]
    circuit_validated: bool = False
    preparation_history: tuple[tuple, ...] | None = None


def start(stage: dict, num_qubits: int = 2) -> Position:
    circuit = QuantumCircuit(num_qubits)
    for op in stage["initial_circuit"]:
        getattr(circuit, op[0])(*op[1:])
    return Position(initial_state(circuit, num_qubits), (None,) * num_qubits, 0,
                    tuple(t["uses"] for t in stage["terminals"]),
                    preparation_history=() if "validation" in stage else None)


def objective(stage: dict, position: Position) -> str:
    if "validation" in stage and not position.circuit_validated:
        return "pending"
    measured = position.measured
    win = stage["win"]
    if "parity" in win:
        if measured[0] is not None and measured[1] is not None:
            equal = measured[0] == measured[1]
            if equal != (win["parity"] == "equal"):
                return "failed"
    else:
        for key, expected in win.items():
            bit = measured[int(key[1:])]
            if bit is not None and bit != expected:
                return "failed"
    if all(measured[q] is not None for q in stage["required_measurements"]):
        return "ready"
    return "pending"


def logical_key(position: Position):
    return (canonical_key(position.sv), position.measured, position.gates_used,
            position.uses_left, position.circuit_validated, position.preparation_history)


def run_circuit(stage: dict, position: Position) -> Position:
    """Validate the constructed ideal preparation; never submit a second job.

    The proof persists through projection. Re-running after measurement must not
    re-test the now-collapsed vector as though it were the original Bell state.
    """
    validation = stage.get("validation")
    if validation is None:
        raise RuleError("VALIDATION_NOT_REQUIRED", "This stage has no RUN CIRCUIT step")
    if position.circuit_validated:
        return position
    if any(bit is not None for bit in position.measured):
        raise RuleError("QUBIT_ALREADY_MEASURED", "Reset before preparing the circuit")
    expected = tuple(tuple(op) for op in validation["required_sequence"])
    actual = position.preparation_history or ()
    sequence = " then ".join(f"{op[0].upper()}({','.join(str(q) for q in op[1:])})" for op in expected)
    if actual != expected[:len(actual)]:
        raise RuleError("INVALID_CIRCUIT", f"Gate order must be {sequence}; reset to retry")
    if len(actual) < len(expected):
        raise RuleError("CIRCUIT_INCOMPLETE", f"Complete {sequence} before RUN CIRCUIT")
    if actual != expected or bell_label(position.sv) != validation["target_bell"]:
        raise RuleError("INVALID_CIRCUIT", f"Prepare the target Bell state {validation['target_bell']} with {sequence}; reset to retry")
    return replace(position, circuit_validated=True)


def check_qubit(qubit, n):
    if type(qubit) is not int or not 0 <= qubit < n:
        raise RuleError("INVALID_QUBIT", "Qubit must be an integer within the register")


def apply(stage: dict, position: Position, gate, qubit, target=-1,
          terminal_id=None, actor=None) -> tuple[Position, str]:
    if not isinstance(gate, str) or gate.lower() not in {"x", "h", "z", "cx"}:
        raise RuleError("GATE_NOT_ALLOWED", "Unsupported gate")
    gate = gate.lower()
    check_qubit(qubit, len(position.measured))
    if gate == "cx":
        check_qubit(target, len(position.measured))
        if target == qubit:
            raise RuleError("INVALID_QUBIT", "Control and target must differ")
    elif type(target) is not int or target != -1:
        raise RuleError("INVALID_QUBIT", "Single-qubit gate has no target")
    if objective(stage, position) != "pending":
        raise RuleError("STAGE_FINISHED", "Reset or advance the finished stage")
    if "validation" in stage and position.circuit_validated:
        raise RuleError("CIRCUIT_LOCKED", "The validated circuit is locked; reset to build another circuit")
    touched = (qubit, target) if gate == "cx" else (qubit,)
    if any(position.measured[q] is not None for q in touched):
        raise RuleError("QUBIT_ALREADY_MEASURED", "Cannot apply gates to explicitly measured qubits")
    if position.gates_used >= stage["max_gates"]:
        raise RuleError("GATE_BUDGET_EXHAUSTED", "No gates remain in this stage")
    candidates = []
    for index, terminal in enumerate(stage["terminals"]):
        if terminal_id is not None and terminal["id"] != terminal_id:
            continue
        if terminal["gate"] == gate and terminal["qubit"] == qubit and terminal.get("target", -1) == target:
            candidates.append((index, terminal))
    if not candidates:
        raise RuleError("GATE_NOT_ALLOWED", "No terminal provides this operation")
    if "validation" in stage and actor is None:
        raise RuleError("ACTOR_REQUIRED", "Identify Alice or Bob when placing a validation-stage gate")
    if actor is not None and not any(t["owner"] == actor for _, t in candidates):
        raise RuleError("INVALID_ACTOR", "Actor does not own this terminal")
    candidates = [(i, t) for i, t in candidates if actor is None or t["owner"] == actor]
    available = [(i, t) for i, t in candidates if position.uses_left[i] is None or position.uses_left[i] > 0]
    if not available:
        raise RuleError("TERMINAL_EXHAUSTED", "This terminal has no uses left")
    index, terminal = available[0]
    uses = list(position.uses_left)
    if uses[index] is not None:
        uses[index] -= 1
    sv = evolve_gate(position.sv, gate, qubit, target)
    history = position.preparation_history
    if history is not None:
        history += ((gate, qubit, target) if gate == "cx" else (gate, qubit),)
    return replace(position, sv=sv, gates_used=position.gates_used + 1,
                   uses_left=tuple(uses), preparation_history=history), terminal["id"]


def collapse(stage: dict, position: Position, qubit: int, outcome: int) -> Position:
    check_qubit(qubit, len(position.measured))
    if type(outcome) is not int or outcome not in (0, 1):
        raise RuleError("INVALID_OUTCOME", "Outcome must be 0 or 1")
    if "validation" in stage and not position.circuit_validated:
        raise RuleError("CIRCUIT_NOT_VALIDATED", "Use RUN CIRCUIT successfully before measuring")
    if position.measured[qubit] is not None:
        if outcome != position.measured[qubit]:
            raise RuleError("INVALID_OUTCOME", "Repeated measurement cannot change its result")
        return position
    if objective(stage, position) != "pending":
        raise RuleError("STAGE_FINISHED", "Reset or advance the finished stage")
    sv = project(position.sv, qubit, outcome)
    if sv is None:
        raise RuleError("IMPOSSIBLE_OUTCOME", "Outcome has zero ideal probability")
    measured = list(position.measured)
    measured[qubit] = outcome
    return replace(position, sv=sv, measured=tuple(measured))


def actions(stage: dict, position: Position, allow_cx=True):
    """Actions identify actual terminals, so no verifier bypasses their budgets."""
    if objective(stage, position) != "pending":
        return []
    result = []
    for terminal in stage["terminals"]:
        if terminal["gate"] == "cx" and not allow_cx:
            continue
        try:
            apply(stage, position, terminal["gate"], terminal["qubit"],
                  terminal.get("target", -1), terminal["id"], terminal["owner"])
        except RuleError:
            continue
        result.append(("gate", terminal["id"]))
    if "validation" in stage and not position.circuit_validated:
        try:
            run_circuit(stage, position)
        except RuleError:
            pass
        else:
            result.append(("run_circuit", None))
    else:
        result.extend(("measure", q) for q, bit in enumerate(position.measured) if bit is None)
    return result


def branches(stage: dict, position: Position, action: tuple):
    if action[0] == "run_circuit":
        return [(1.0, None, run_circuit(stage, position))]
    if action[0] == "gate":
        terminal = next(t for t in stage["terminals"] if t["id"] == action[1])
        next_position, _ = apply(stage, position, terminal["gate"], terminal["qubit"],
                                 terminal.get("target", -1), terminal["id"], terminal["owner"])
        return [(1.0, None, next_position)]
    qubit = action[1]
    return [(probability, bit, collapse(stage, position, qubit, bit))
            for bit, probability in enumerate(marginals(position.sv)[qubit]) if probability > 1e-9]

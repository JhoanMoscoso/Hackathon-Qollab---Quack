"""Bounded reachability enumeration for quantum stages."""

from __future__ import annotations

from collections import deque

from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

from quantum.rules import Position, actions, branches, logical_key, objective, start
from quantum.state import canonical_key as _canonical_key, preparation_circuit


canonical_key = _canonical_key


def enumerate_stage(stage: dict, num_qubits: int = 2, max_nodes: int = 20000) -> dict[str, Statevector]:
    """Enumerate distinct physical states reachable before objective completion."""
    if type(max_nodes) is not int or max_nodes < 1:
        raise ValueError("max_nodes must be a positive integer")
    return _enumerate(stage, start(stage, num_qubits), max_nodes)


def _enumerate(stage, initial, max_nodes):
    queue = deque([initial])
    visited = {logical_key(initial)}
    physical: dict[str, Statevector] = {}
    while queue:
        pos = queue.popleft()
        key = canonical_key(pos.sv)
        previous = physical.get(key)
        if previous is not None and not previous.equiv(pos.sv, atol=1e-6, rtol=0):
            raise ValueError(f"State-key collision for {key}")
        physical.setdefault(key, pos.sv)
        if objective(stage, pos) != "pending":
            continue
        for action in actions(stage, pos):
            for _, _, nxt in branches(stage, pos, action):
                logical = logical_key(nxt)
                if logical not in visited:
                    if len(visited) >= max_nodes:
                        raise ValueError(f"Stage exceeded max_nodes={max_nodes}")
                    visited.add(logical)
                    queue.append(nxt)
    return physical


def campaign_catalog(levels) -> dict[str, Statevector]:
    """Union per-stage state catalogs, enforcing the two-qubit physical bound."""
    catalog: dict[str, Statevector] = {}
    for level in levels:
        for stage in level.get("stages", []):
            for key, sv in enumerate_stage(stage, level.get("num_qubits", 2)).items():
                if key in catalog and not catalog[key].equiv(sv, atol=1e-6, rtol=0):
                    raise ValueError(f"State-key collision across stages for {key}")
                catalog.setdefault(key, sv)
        if len(catalog) > 60:
            raise ValueError("Campaign exceeded the guarded 60-state physical bound")
    return catalog


def reachable(initial: QuantumCircuit, gate_set, max_gates: int, num_qubits: int) -> dict[str, QuantumCircuit]:
    """Compatibility helper for the spec's synthetic physics fixture, including collapse.

    A mapping restricts gates by owner; an iterable permits single-qubit gates
    on every qubit and CX in both directions. Gameplay uses enumerate_stage.
    """
    from quantum.state import initial_state

    if not isinstance(initial, QuantumCircuit):
        raise TypeError("initial must be a QuantumCircuit")
    if type(max_gates) is not int or max_gates < 0:
        raise ValueError("max_gates must be a nonnegative integer")
    state = initial_state(initial, num_qubits)
    terminals = []
    if isinstance(gate_set, dict):
        groups = [(owner, gates, [1] if owner == "bob" else [0]) for owner, gates in gate_set.items()]
    else:
        groups = [("fixture", gate_set, range(num_qubits))]
    for owner, gates, qubits in groups:
        for gate in gates:
            if gate not in {"h", "x", "z", "cx"}:
                raise ValueError("Unsupported fixture gate")
            controls = [0] if gate == "cx" and owner in {"bob", "shared"} else qubits
            for qubit in controls:
                targets = ([1] if owner in {"bob", "shared"} else range(num_qubits)) if gate == "cx" else [-1]
                for target in targets:
                    if target == qubit:
                        continue
                    terminals.append({"id": f"{gate}_{qubit}_{target}", "gate": gate,
                                      "qubit": qubit, "target": target,
                                      "owner": owner, "uses": None})
    stage = {"max_gates": max_gates, "win": {}, "required_measurements": list(range(num_qubits)),
             "terminals": terminals}
    position = Position(state, (None,) * num_qubits, 0, (None,) * len(terminals))
    return {key: preparation_circuit(sv) for key, sv in _enumerate(stage, position, 20000).items()}

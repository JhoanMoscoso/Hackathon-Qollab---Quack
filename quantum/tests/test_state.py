import numpy as np
import pytest
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

from quantum.state import (
    amplitudes,
    bell_label,
    canonical_key,
    entangled,
    evolve_gate,
    initial_state,
    ket,
    marginals,
    preparation_circuit,
    probabilities,
    project,
)


def bell() -> Statevector:
    circuit = QuantumCircuit(2)
    circuit.h(0)
    circuit.cx(0, 1)
    return Statevector.from_instruction(circuit)


def test_game_bit_order_probabilities_marginals_and_amplitudes():
    circuit = QuantumCircuit(2)
    circuit.x(0)
    sv = initial_state(circuit, 2)
    assert probabilities(sv) == {"00": 0.0, "01": 0.0, "10": 1.0, "11": 0.0}
    assert amplitudes(sv) == [[0.0, 0.0], [0.0, 0.0], [1.0, 0.0], [0.0, 0.0]]
    assert marginals(sv) == [[0.0, 1.0], [1.0, 0.0]]


def test_bell_labels_and_global_phase_invariance():
    states = [bell()]
    psi_plus = evolve_gate(states[0], "x", 1)
    phi_minus = evolve_gate(states[0], "z", 0)
    psi_minus = evolve_gate(psi_plus, "z", 0)
    assert [bell_label(s) for s in (states[0], psi_plus, phi_minus, psi_minus)] == [
        "Phi+", "Psi+", "Phi-", "Psi-"
    ]
    shifted = Statevector(np.exp(0.731j) * states[0].data)
    assert bell_label(shifted) == "Phi+"
    assert canonical_key(shifted) == canonical_key(states[0])
    assert canonical_key(Statevector(-states[0].data)) == canonical_key(states[0])
    assert probabilities(shifted) == pytest.approx(probabilities(states[0]))
    assert canonical_key(phi_minus) != canonical_key(states[0])


@pytest.mark.parametrize("qubit", [0, 1])
@pytest.mark.parametrize("outcome", [0, 1])
def test_project_bell_both_qubits(qubit, outcome):
    result = project(bell(), qubit, outcome)
    assert result is not None
    assert np.isclose(np.linalg.norm(result.data), 1.0)
    expected = "00" if outcome == 0 else "11"
    assert probabilities(result)[expected] == pytest.approx(1.0)


def test_project_impossible_branch():
    assert project(Statevector.from_label("00"), 1, 1) is None


def test_hzh_and_cx_h_interference():
    sv = Statevector.from_label("0")
    assert probabilities(evolve_gate(evolve_gate(evolve_gate(sv, "h", 0), "z", 0), "h", 0))["1"] == pytest.approx(1)
    pair = bell()
    pair = evolve_gate(pair, "cx", 0, 1)
    pair = evolve_gate(pair, "h", 0)
    assert probabilities(pair)["00"] == pytest.approx(1)


@pytest.mark.parametrize(
    ("vector", "expected"),
    [
        ([1, 0, -1, 0], "0.707|00⟩ - 0.707|01⟩"),
        ([1j, 0, -1j, 0], "0.707i|00⟩ - 0.707i|01⟩"),
        ([-1, 0, 1j, 0], "-0.707|00⟩ + 0.707i|01⟩"),
        ([-1 + 1j, 0, 0, 0], "-(0.707-0.707i)|00⟩"),
    ],
)
def test_ket_real_imaginary_and_negative_signs(vector, expected):
    assert ket(Statevector(np.asarray(vector, dtype=complex) / np.sqrt(2))) == expected


def test_entanglement_and_state_preparation_without_initialize():
    sv = bell()
    assert entangled(sv)
    prep = preparation_circuit(sv)
    assert all(instruction.operation.name != "reset" for instruction in prep.data)
    assert Statevector.from_instruction(prep).equiv(sv, atol=1e-10, rtol=0)
    assert not entangled(Statevector.from_label("00"))


@pytest.mark.parametrize(
    "args", [("cx", 0, -1), ("cx", 0, 0), ("x", 0, 1), ("bad", 0, -1)]
)
def test_invalid_gate_arity_or_gate(args):
    with pytest.raises(ValueError):
        evolve_gate(bell(), *args)


@pytest.mark.parametrize("args", [("x", True, -1), ("cx", 0, True)])
def test_qubit_arguments_reject_bool(args):
    with pytest.raises(TypeError):
        evolve_gate(bell(), *args)

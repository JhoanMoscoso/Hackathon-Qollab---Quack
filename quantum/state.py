"""Pure Statevector helpers for the game-facing quantum-state contract."""

from __future__ import annotations

import hashlib

import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit.library import StatePreparation
from qiskit.quantum_info import Statevector, entropy, partial_trace


_PROB_TOL = 1e-9
_NORM_TOL = 1e-12
_KEY_TOL = 1e-9


def _qubit_count(sv: Statevector) -> int:
    return int(sv.num_qubits)


def _validate_qubit(qubit: int, num_qubits: int, name: str = "qubit") -> None:
    if isinstance(qubit, bool) or not isinstance(qubit, int):
        raise TypeError(f"{name} must be an integer (not bool)")
    if qubit < 0 or qubit >= num_qubits:
        raise ValueError(f"{name} must be in [0, {num_qubits})")


def initial_state(initial_circuit: QuantumCircuit, num_qubits: int) -> Statevector:
    """Build a Statevector from the supplied initial circuit."""
    if isinstance(num_qubits, bool) or not isinstance(num_qubits, int):
        raise TypeError("num_qubits must be an integer (not bool)")
    if num_qubits < 1:
        raise ValueError("num_qubits must be positive")
    if not isinstance(initial_circuit, QuantumCircuit):
        raise TypeError("initial_circuit must be a QuantumCircuit")
    if initial_circuit.num_qubits != num_qubits:
        raise ValueError("initial_circuit qubit count does not match num_qubits")
    return Statevector.from_instruction(initial_circuit)


def evolve_gate(sv: Statevector, gate: str, qubit: int, target: int = -1) -> Statevector:
    """Return the state after applying a supported game gate."""
    if not isinstance(sv, Statevector):
        raise TypeError("sv must be a Statevector")
    if not isinstance(gate, str) or gate not in {"x", "h", "z", "cx"}:
        raise ValueError("gate must be one of: x, h, z, cx")
    n = _qubit_count(sv)
    _validate_qubit(qubit, n)
    if gate == "cx":
        _validate_qubit(target, n, "target")
        if target == qubit:
            raise ValueError("cx control and target must be different qubits")
        circuit = QuantumCircuit(n)
        circuit.cx(qubit, target)
    else:
        if isinstance(target, bool) or not isinstance(target, int):
            raise TypeError("target must be an integer (not bool)")
        if target != -1:
            raise ValueError("single-qubit gates do not accept a target")
        circuit = QuantumCircuit(n)
        getattr(circuit, gate)(qubit)
    return sv.evolve(circuit)


def project(sv: Statevector, qubit: int, outcome: int) -> Statevector | None:
    """Project onto one computational-basis outcome; impossible branches return None."""
    if not isinstance(sv, Statevector):
        raise TypeError("sv must be a Statevector")
    n = _qubit_count(sv)
    _validate_qubit(qubit, n)
    if isinstance(outcome, bool) or not isinstance(outcome, int):
        raise TypeError("outcome must be an integer (not bool)")
    if outcome not in (0, 1):
        raise ValueError("outcome must be 0 or 1")
    data = np.asarray(sv.data, dtype=complex).copy()
    for index in range(data.size):
        if ((index >> qubit) & 1) != outcome:
            data[index] = 0
    norm = float(np.linalg.norm(data))
    if norm <= _NORM_TOL or norm * norm <= _PROB_TOL:
        return None
    return Statevector(data / norm)


def _game_bits(index: int, num_qubits: int) -> str:
    return format(index, f"0{num_qubits}b")[::-1]


def probabilities(sv: Statevector) -> dict[str, float]:
    """Full-precision probabilities in game bit order, including zero outcomes."""
    n = _qubit_count(sv)
    probs = np.abs(np.asarray(sv.data, dtype=complex)) ** 2
    return {_game_bits(i, n): float(probs[i]) for i in range(1 << n)}


def marginals(sv: Statevector) -> list[list[float]]:
    """Per-qubit [P(0), P(1)] in q0-first game order."""
    n = _qubit_count(sv)
    result = [[0.0, 0.0] for _ in range(n)]
    for index, amp in enumerate(sv.data):
        probability = float(abs(amp) ** 2)
        for qubit in range(n):
            result[qubit][(index >> qubit) & 1] += probability
    return result


def _equiv_up_to_phase(sv: Statevector, reference: Statevector, atol: float) -> bool:
    return bool(sv.equiv(reference, atol=atol, rtol=0))


def bell_label(sv: Statevector) -> str | None:
    if _qubit_count(sv) != 2:
        return None
    references = (
        ("Phi+", [1, 0, 0, 1]),
        ("Phi-", [1, 0, 0, -1]),
        ("Psi+", [0, 1, 1, 0]),
        ("Psi-", [0, 1, -1, 0]),
    )
    for label, values in references:
        reference = Statevector(np.asarray(values, dtype=complex) / np.sqrt(2))
        if _equiv_up_to_phase(sv, reference, 1e-6):
            return label
    return None


def entangled(sv: Statevector) -> bool:
    """Return whether a two-qubit pure state is entangled."""
    if _qubit_count(sv) != 2:
        return False
    return bool(entropy(partial_trace(sv, [1]), base=2) > 1e-6)


def _format_number(value: float, digits: int = 3) -> str:
    rounded = round(float(value), digits)
    if rounded == 0:
        rounded = 0.0
    return f"{rounded:.{digits}f}".rstrip("0").rstrip(".")


def ket(sv: Statevector) -> str:
    """Human-readable ket with game-order basis labels and signed amplitudes."""
    n = _qubit_count(sv)
    terms: list[tuple[str, str]] = []
    for index, amp in enumerate(sv.data):
        amp = complex(amp)
        if abs(amp) <= _KEY_TOL:
            continue
        real, imag = amp.real, amp.imag
        if abs(imag) <= 1e-9:
            magnitude = _format_number(abs(real))
            sign = "-" if real < 0 else "+"
            coefficient = magnitude
        elif abs(real) <= 1e-9:
            magnitude = _format_number(abs(imag))
            sign = "-" if imag < 0 else "+"
            coefficient = f"{magnitude}i"
        else:
            sign = "-" if real < 0 else "+"
            # Factoring a minus out also changes the imaginary component's sign.
            factored_imag = -imag if sign == "-" else imag
            imag_sign = "-" if factored_imag < 0 else "+"
            coefficient = f"({_format_number(abs(real))}{imag_sign}{_format_number(abs(imag))}i)"
        terms.append((sign, f"{coefficient}|{_game_bits(index, n)}⟩"))
    if not terms:
        return "0"
    first_sign, first_term = terms[0]
    output = ("-" if first_sign == "-" else "") + first_term
    for sign, term in terms[1:]:
        output += f" {sign} {term}"
    return output


def amplitudes(sv: Statevector) -> list[list[float]]:
    """Complex amplitudes as [real, imag] pairs in lexicographic game order."""
    n = _qubit_count(sv)
    by_bits = {_game_bits(i, n): complex(value) for i, value in enumerate(sv.data)}
    return [[float(by_bits[bits].real), float(by_bits[bits].imag)]
            for bits in (format(i, f"0{n}b") for i in range(1 << n))]


def canonical_key(sv: Statevector) -> str:
    """Stable digest of normalized amplitudes modulo global phase."""
    vector = np.asarray(sv.data, dtype=complex).copy()
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(norm) or norm <= _NORM_TOL:
        raise ValueError("Cannot identify a zero or non-finite statevector")
    vector /= norm
    nonzero = np.flatnonzero(np.abs(vector) > _KEY_TOL)
    if nonzero.size:
        pivot = vector[nonzero[0]]
        vector *= np.exp(-1j * np.angle(pivot))
    vector.real[np.abs(vector.real) < 5e-7] = 0.0
    vector.imag[np.abs(vector.imag) < 5e-7] = 0.0
    pairs = [(round(float(z.real), 6), round(float(z.imag), 6)) for z in vector]
    payload = f"{_qubit_count(sv)}:" + ";".join(f"{r:.6f},{i:.6f}" for r, i in pairs)
    return hashlib.sha1(payload.encode("ascii")).hexdigest()[:12]


def preparation_circuit(sv: Statevector) -> QuantumCircuit:
    """Prepare sv from zero using StatePreparation (without Initialize/reset)."""
    if not isinstance(sv, Statevector):
        raise TypeError("sv must be a Statevector")
    circuit = QuantumCircuit(_qubit_count(sv))
    circuit.append(StatePreparation(np.asarray(sv.data, dtype=complex)), range(_qubit_count(sv)))
    if not Statevector.from_instruction(circuit).equiv(sv, atol=1e-10, rtol=0):
        raise ValueError("StatePreparation did not reproduce the requested state")
    return circuit


def physical_snapshot(sv: Statevector) -> dict:
    probs = probabilities(sv)
    return {
        "num_qubits": _qubit_count(sv),
        "ket": ket(sv),
        "amplitudes": [[round(x, 6) for x in pair] for pair in amplitudes(sv)],
        "probs": {key: round(value, 6) for key, value in probs.items()},
        "marginals": [[round(value, 6) for value in row] for row in marginals(sv)],
        "entangled": entangled(sv),
        "bell_label": bell_label(sv),
        "state_key": canonical_key(sv),
    }

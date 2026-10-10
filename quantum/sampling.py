"""One submission per execution; gameplay measurements never call a backend."""

from __future__ import annotations

import asyncio
import inspect
from dataclasses import dataclass
from numbers import Integral

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector

from quantum.state import canonical_key, marginals, preparation_circuit


async def resolve(value):
    return await value if inspect.isawaitable(value) else value


@dataclass
class Distribution:
    counts: dict[str, int]  # Qiskit order, not the game-facing labels.
    source: str
    reason: str | None = None


class SamplingCache:
    """Lifetime is the Python module's execution, not the current level/stage."""

    def __init__(self, seed=None):
        self.rng = np.random.default_rng(seed)
        self.records: dict[str, Distribution] = {}
        self.task = None
        self.summary = None
        self.attempted = False

    def local_counts(self, sv, shots):
        copy = sv.copy()
        copy.seed(self.rng)
        return {str(k): int(v) for k, v in copy.sample_counts(shots).items()}

    @staticmethod
    def normalize_counts(raw, n, shots):
        if not hasattr(raw, "items"):
            raise ValueError("Backend did not return counts")
        normalized = {}
        for bits, count in raw.items():
            bits = str(bits).replace(" ", "")
            if len(bits) != n or any(bit not in "01" for bit in bits):
                raise ValueError("Invalid backend bitstring")
            if isinstance(count, bool) or not isinstance(count, Integral) or count < 0:
                raise ValueError("Invalid backend count")
            normalized[bits] = normalized.get(bits, 0) + int(count)
        if sum(normalized.values()) != shots:
            raise ValueError("Backend counts do not sum to requested shots")
        return normalized

    async def precompute(self, backend, catalog: dict[str, Statevector], shots=200,
                         strategy="single", reference_key=None, packed_keys=None):
        if type(shots) is not int or not 1 <= shots <= 100000:
            raise ValueError("shots must be an integer between 1 and 100000")
        if strategy not in {"packed", "single", "batch"}:
            raise ValueError("strategy must be packed, single or batch")
        if self.task is None:
            # No await before assignment: concurrent callers share exactly one task.
            self.task = asyncio.create_task(self._precompute(backend, catalog, shots,
                                                           strategy, reference_key, packed_keys))
        return await asyncio.shield(self.task)

    async def _precompute(self, backend, catalog, shots, strategy, reference_key, packed_keys):
        self.records = {key: Distribution(self.local_counts(sv, shots),
                        "statevector_fallback", "not_submitted") for key, sv in catalog.items()}
        submitted = []
        manifest = []
        circuit_count = 0
        reason = None
        if backend is None:
            reason = "no_backend"
        elif not catalog:
            reason = "empty_catalog"
        else:
            keys = sorted(catalog)
            if strategy == "packed":
                width = next(iter(catalog.values())).num_qubits
                capacity = getattr(backend, "num_qubits", None)
                max_pairs = min(10, capacity // width) if type(capacity) is int else 10
                priorities = list(dict.fromkeys(packed_keys if packed_keys is not None else keys))
                selected = [key for key in priorities if key in catalog][:max_pairs]
            else:
                selected = keys if strategy == "batch" else [reference_key if reference_key in catalog else keys[0]]
            try:
                circuits = []
                if not selected:
                    raise ValueError("Backend has no capacity for a state pair")
                if strategy == "packed":
                    circuit = QuantumCircuit(width * len(selected), width * len(selected))
                    for index, key in enumerate(selected):
                        qubits = list(range(index * width, (index + 1) * width))
                        circuit.compose(preparation_circuit(catalog[key]), qubits=qubits, inplace=True)
                        manifest.append({"state_key": key, "qubits": qubits, "clbits": qubits})
                    circuit.measure(range(circuit.num_qubits), range(circuit.num_clbits))
                    circuits.append(transpile(circuit, backend))
                else:
                    for key in selected:
                        circuit = preparation_circuit(catalog[key])
                        circuit.measure_all()
                        circuits.append(transpile(circuit, backend))
                self.attempted = True  # Reserve before invoking/awaiting backend.run.
                submitted = selected
                circuit_count = len(circuits)
                job = await resolve(backend.run(circuits if strategy == "batch" else circuits[0], shots=shots))
                result = await resolve(job.result())
                if strategy == "packed":
                    raw = self.normalize_counts(result.get_counts(0), width * len(selected), shots)
                    for index, key in enumerate(selected):
                        counts = {}
                        for bits, count in raw.items():
                            pair = (int(bits, 2) >> (index * width)) & ((1 << width) - 1)
                            label = format(pair, f"0{width}b")
                            counts[label] = counts.get(label, 0) + count
                        self.records[key] = Distribution(counts, "backend")
                for index, key in enumerate(selected):
                    if strategy == "packed":
                        continue
                    try:
                        counts = self.normalize_counts(result.get_counts(index), catalog[key].num_qubits, shots)
                        self.records[key] = Distribution(counts, "backend")
                    except Exception as error:
                        self.records[key].reason = f"invalid_result: {type(error).__name__}: {error}"
            except Exception as error:
                reason = f"backend_error: {type(error).__name__}: {error}"
        if reason:
            for record in self.records.values():
                if record.source != "backend":
                    record.reason = reason
        sources = {record.source for record in self.records.values()}
        self.summary = {
            "states": len(catalog), "circuits": circuit_count,
            "source": next(iter(sources)) if len(sources) == 1 else "mixed" if sources else "statevector_fallback",
            "backend": str(backend) if backend is not None else None,
            "shots": shots, "strategy": strategy,
            "backend_states": sum(r.source == "backend" for r in self.records.values()),
            "submission_attempted": self.attempted,
            "packed_manifest": manifest,
            "submitted_states": len(submitted),
            "reason": reason,
            "sources": {key: record.source for key, record in self.records.items()},
        }
        return self.summary

    def describe(self, sv):
        record = self.records.get(canonical_key(sv))
        if record is None:
            return {"source": "statevector_fallback", "counts": {}, "shots": 0,
                    "reason": "not_precomputed", "backend": None}
        return {"source": record.source,
                "counts": {bits[::-1]: count for bits, count in record.counts.items()},
                "shots": sum(record.counts.values()), "reason": record.reason,
                "backend": self.summary.get("backend") if self.summary else None}

    def measure(self, sv, measured, qubit):
        record = self.records.get(canonical_key(sv))
        probs = marginals(sv)[qubit]
        filtered = {}
        discarded = 0
        # Only backend counts are a distribution worth replaying (hardware noise is intentional). A
        # statevector_fallback record is just one finite 200-shot draw of the ideal state: resampling it
        # forever would freeze that draw's quantisation error (e.g. 116/84 instead of 50/50) into every
        # measurement of the process, so local records are never the source of an outcome.
        replayable = record is not None and record.source == "backend"
        if replayable:
            for bits, count in record.counts.items():
                game = bits[::-1]
                consistent = all(bit is None or int(game[q]) == bit for q, bit in enumerate(measured))
                if consistent and probs[int(game[qubit])] > 1e-9:
                    filtered[bits] = count
                else:
                    discarded += count
        total = sum(filtered.values())
        if total:
            labels = list(filtered)
            weights = np.array([filtered[label] for label in labels], dtype=float) / total
            chosen = labels[int(self.rng.choice(len(labels), p=weights))]
            source, reason = record.source, record.reason
        else:
            chosen = next(iter(self.local_counts(sv, 1)))  # a fresh ideal draw from the statevector
            source = "statevector_fallback"
            reason = ("incompatible_counts" if replayable
                      else record.reason if record is not None else "not_precomputed")
        return int(chosen[::-1][qubit]), {
            "source": source, "reason": reason, "discarded_shots": discarded,
            "state_key": canonical_key(sv), "conditioned": discarded > 0,
        }

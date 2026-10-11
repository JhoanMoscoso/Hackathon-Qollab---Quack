"""JSON-only facade consumed from JS via callPromising; no simulator in JS."""

from __future__ import annotations

import json
from copy import deepcopy

from quantum import rules
from quantum.levels import LEVEL_IDS, audio_payload, read_level
from quantum.sampling import SamplingCache
from quantum.state import canonical_key, evolve_gate, physical_snapshot
from qiskit.quantum_info import Statevector


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def error_payload(error, default="INVALID_REQUEST"):
    return {"error": str(error), "code": getattr(error, "code", default)}


class Engine:
    """Independent engine instances are for tests; the public module owns one."""

    def __init__(self, seed=None):
        self.levels = {}
        self.level = None
        self.stage_index = 0
        self.position = None
        self.history = []
        self.revision = 0
        self.last_measurement = None
        self.sampling = SamplingCache(seed)
        self._physical_cache = {}

    @property
    def stage(self):
        self.require_session()
        return self.level["stages"][self.stage_index]

    def require_session(self):
        if self.position is None:
            raise rules.RuleError("NO_SESSION", "Create a session first")

    def _level(self, level_id):
        if not isinstance(level_id, str) or level_id not in LEVEL_IDS:
            raise rules.RuleError("INVALID_LEVEL", "Unknown level id")
        if level_id not in self.levels:
            self.levels[level_id] = read_level(level_id)
        return self.levels[level_id]

    async def load_level(self, level_id):
        try:
            return encode(self._level(level_id))
        except (ValueError, TypeError, OSError) as error:
            return encode(error_payload(error, "INVALID_LEVEL"))

    def _restart(self, index):
        self.stage_index = index
        self.position = rules.start(self.level["stages"][index], self.level["num_qubits"])
        self.history = []
        self.last_measurement = None
        self.revision += 1
        return self._snapshot()

    def new_session(self, level_id):
        try:
            level = self._level(level_id)
            # Validate preparation before replacing a live session.
            rules.start(level["stages"][0], level["num_qubits"])
            self.level = level
            return encode(self._restart(0))
        except (ValueError, TypeError, OSError) as error:
            return encode(error_payload(error, "INVALID_LEVEL"))

    def _snapshot(self):
        stage, position = self.stage, self.position
        key = canonical_key(position.sv)
        if key not in self._physical_cache:
            self._physical_cache[key] = physical_snapshot(position.sv)
        snapshot = deepcopy(self._physical_cache[key])
        objects = {}
        status = rules.objective(stage, position)
        for name, obj in stage["objects"].items():
            if "qubit" not in obj:
                objects[name] = "0" if status == "ready" else "1"
                continue
            p0, p1 = snapshot["marginals"][obj["qubit"]]
            objects[name] = "0" if p0 >= 1 - 1e-6 else "1" if p1 >= 1 - 1e-6 else "super"
        sampling = self.sampling.describe(position.sv)
        snapshot.update({
            "schema_version": 2, "level_id": self.level["id"], "stage_id": stage["id"],
            "stage_index": self.stage_index, "stage_count": len(self.level["stages"]),
            "revision": self.revision, "initial_circuit": deepcopy(stage["initial_circuit"]),
            "measured": list(position.measured), "history": deepcopy(self.history),
            "gates_left": stage["max_gates"] - position.gates_used,
            "terminal_uses_left": {t["id"]: uses for t, uses in zip(stage["terminals"], position.uses_left)},
            "objects": objects, "objective": {"status": status, "quantum_ready": status == "ready",
            "failure_policy": stage["failure_policy"], "required_measurements": stage["required_measurements"]},
            "source": sampling["source"], "sampling": sampling,
            "last_measurement": deepcopy(self.last_measurement),
        })
        if "validation" in stage:
            validated = position.circuit_validated
            circuit_status = ("complete" if status == "ready" else "failed" if status == "failed"
                              else "measuring" if any(bit is not None for bit in position.measured)
                              else "validated" if validated else "building")
            allowed = []
            for q, bit in enumerate(position.measured):
                try:
                    rules.check_measurement(stage, position, q)
                except rules.RuleError:
                    allowed.append(False)
                else:
                    allowed.append(bit is None)
            unlocked = validated and status == "ready"
            snapshot.update({
                "circuit_validation": {"required": True, "validated": validated,
                    "status": circuit_status, **deepcopy(stage["validation"])},
                "measurement_enabled": any(allowed),
                "exits_unlocked": unlocked,
                "door_states": {name: "open" if unlocked else "closed"
                                for name, obj in stage["objects"].items()
                                if obj.get("type") == "validated_exit"},
            })
            if stage["validation"].get("mode", "manual") == "automatic":
                snapshot["measurement_allowed"] = allowed
        if "feed_forward" in stage:
            phase = position.feed_forward_phase
            sent = phase in {"receive_bit", "correct_alice", "measure_alice", "complete"}
            received = phase in {"correct_alice", "measure_alice", "complete"}
            allowed = []
            for q, bit in enumerate(position.measured):
                try:
                    rules.check_measurement(stage, position, q)
                except rules.RuleError:
                    allowed.append(False)
                else:
                    allowed.append(bit is None)
            unlocked = status == "ready"
            snapshot.update({
                "feed_forward": {"phase": phase, "sender": "bob", "receiver": "alice",
                    "required_correction": ("x" if position.measured[1] == 0 else "i") if received else None},
                "classical_channel": {"sender": "bob", "receiver": "alice", "sent": sent,
                    "received": received, "value": position.measured[1] if received else None},
                "measurement_allowed": allowed, "measurement_enabled": any(allowed),
                "exits_unlocked": unlocked,
                "door_states": {name: "open" if unlocked else "closed"
                                for name, obj in stage["objects"].items()
                                if obj.get("type") == "protocol_exit"},
            })
        return snapshot

    def snapshot(self):
        try:
            return encode(self._snapshot())
        except rules.RuleError as error:
            return encode(error_payload(error))

    def apply_gate(self, gate, qubit, target=-1, terminal_id=None, actor=None):
        try:
            self.require_session()
            position, _ = rules.apply(self.stage, self.position, gate, qubit, target, terminal_id, actor)
            self.position = position
            self.history.append([gate.lower(), qubit] + ([target] if gate.lower() == "cx" else []))
            self.revision += 1
            self.last_measurement = None
            return encode(self._snapshot())
        except (rules.RuleError, TypeError, ValueError) as error:
            return encode(error_payload(error))

    def measure(self, qubit):
        try:
            self.require_session()
            rules.check_measurement(self.stage, self.position, qubit)
            previous = self.position.measured[qubit]
            if previous is not None:
                return encode({"qubit": qubit, "outcome": previous, "repeated": True,
                               "snapshot": self._snapshot()})
            if rules.objective(self.stage, self.position) != "pending":
                raise rules.RuleError("STAGE_FINISHED", "Reset or advance this stage")
            outcome, details = self.sampling.measure(self.position.sv, self.position.measured, qubit)
            self.position = rules.collapse(self.stage, self.position, qubit, outcome)
            self.history.append(["measure", qubit, outcome])
            self.revision += 1
            self.last_measurement = {"qubit": qubit, "outcome": outcome, **details}
            return encode({"qubit": qubit, "outcome": outcome, "repeated": False,
                           "snapshot": self._snapshot()})
        except (rules.RuleError, TypeError, ValueError) as error:
            return encode(error_payload(error))

    def run_circuit(self):
        try:
            self.require_session()
            validated = rules.run_circuit(self.stage, self.position)
            if validated is not self.position:
                self.position = validated
                self.history.append(["run_circuit"])
                self.revision += 1
            return encode(self._snapshot())
        except (rules.RuleError, TypeError, ValueError) as error:
            return encode(error_payload(error))

    def _classical_action(self, name, actor):
        try:
            self.require_session()
            position = getattr(rules, name)(self.stage, self.position, actor)
            if position is not self.position:
                self.position = position
                event = (["identity", 0] if name == "confirm_identity"
                         else [name, 1 if name == "send_bit" else 0, position.measured[1]])
                self.history.append(event)
                self.revision += 1
            return encode(self._snapshot())
        except (rules.RuleError, TypeError, ValueError) as error:
            return encode(error_payload(error))

    def send_bit(self, actor=None):
        return self._classical_action("send_bit", actor)

    def receive_bit(self, actor=None):
        return self._classical_action("receive_bit", actor)

    def confirm_identity(self, actor=None):
        return self._classical_action("confirm_identity", actor)

    def reset_stage(self):
        try:
            self.require_session()
            return encode(self._restart(self.stage_index))
        except rules.RuleError as error:
            return encode(error_payload(error))

    def reset_level(self):
        try:
            self.require_session()
            return encode(self._restart(0))
        except rules.RuleError as error:
            return encode(error_payload(error))

    def advance_stage(self):
        try:
            if rules.objective(self.stage, self.position) != "ready":
                raise rules.RuleError("STAGE_NOT_READY", "Measure required qubits and satisfy the objective first")
            if self.stage_index + 1 >= len(self.level["stages"]):
                raise rules.RuleError("LEVEL_COMPLETE", "No more stages; JS can load the next level")
            # JS must first check both players' spatial exits; this is the quantum guard.
            return encode(self._restart(self.stage_index + 1))
        except rules.RuleError as error:
            return encode(error_payload(error))

    def _packed_keys(self, levels, catalog):
        """Ten priority pairs cover intended routes and both winning Bell branches."""
        # L1 no longer auto-prepares Bell or has two stages. Use L2's reference;
        # priorities are physical families, independent of a level's stage count.
        bell = rules.start(levels[1]["stages"][0]).sv
        psi_plus = evolve_gate(bell, "x", 1)
        states = [Statevector.from_label(bits) for bits in ("00", "01", "10", "11")]
        states.extend([bell, psi_plus, evolve_gate(bell, "z", 0), evolve_gate(psi_plus, "z", 0)])
        plus_zero = evolve_gate(bell, "cx", 0, 1)
        states.extend([plus_zero, evolve_gate(plus_zero, "z", 0)])
        priorities = [key for key in dict.fromkeys(canonical_key(sv) for sv in states) if key in catalog]
        # New gate sets can remove an old priority family: fill from the real catalog,
        # not nonexistent keys, while retaining the ten-pair cap and single job.
        priorities.extend(key for key in sorted(catalog) if key not in priorities)
        return priorities[:10]

    async def precompute(self, backend=None, shots=200, strategy="packed"):
        try:
            from quantum.enumerate import campaign_catalog
            if self.sampling.task is not None:
                return encode(await self.sampling.precompute(backend, {}, shots, strategy))
            levels = [self._level(level_id) for level_id in LEVEL_IDS]
            catalog = campaign_catalog(levels)
            bell = rules.start(levels[1]["stages"][0])
            return encode(await self.sampling.precompute(backend, catalog, shots, strategy,
                                                        canonical_key(bell.sv), self._packed_keys(levels, catalog)))
        except (ValueError, TypeError, OSError) as error:
            return encode(error_payload(error, "PRECOMPUTE_FAILED"))


_engine = Engine()


async def load_level(level_id):
    return await _engine.load_level(level_id)


def new_session(level_id):
    return _engine.new_session(level_id)


async def precompute(backend=None, shots=200, strategy="packed"):
    return await _engine.precompute(backend, shots, strategy)


def apply_gate(gate, qubit, target=-1, terminal_id=None, actor=None):
    return _engine.apply_gate(gate, qubit, target, terminal_id, actor)


def measure(qubit):
    return _engine.measure(qubit)


def run_circuit():
    return _engine.run_circuit()


def send_bit(actor=None):
    return _engine.send_bit(actor)


def receive_bit(actor=None):
    return _engine.receive_bit(actor)


def confirm_identity(actor=None):
    return _engine.confirm_identity(actor)


def reset_level():
    return _engine.reset_level()


def reset_stage():
    return _engine.reset_stage()


def advance_stage():
    return _engine.advance_stage()


def snapshot():
    return _engine.snapshot()


def load_audio(track="menu"):
    """track: "menu" | "level1" | "level2" | "level3" (one track per level)."""
    try:
        return encode(audio_payload(track))
    except (OSError, ValueError) as error:
        return encode(error_payload(error, "AUDIO_UNAVAILABLE"))

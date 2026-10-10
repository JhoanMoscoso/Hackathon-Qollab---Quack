import asyncio
import json

import pytest
from qiskit import QuantumCircuit
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.quantum_info import Statevector

from quantum.engine import Engine
from quantum.enumerate import campaign_catalog, reachable
from quantum.levels import LEVEL_IDS, read_level
from quantum.sampling import SamplingCache
from quantum.state import canonical_key, preparation_circuit


def test_shared_snapshot_example_matches_actual_public_contract():
    with open("docs/snapshot-example.json", encoding="utf-8") as handle:
        example = json.load(handle)
    assert example == json.loads(Engine().new_session("level2"))


def test_all_campaign_recipes_are_equivalent_and_have_no_reset():
    catalog = campaign_catalog([read_level(lid) for lid in LEVEL_IDS])
    assert len(catalog) <= 60
    for sv in catalog.values():
        prep = preparation_circuit(sv)
        assert Statevector(prep).equiv(sv, atol=1e-6, rtol=0)
        assert "reset" not in prep.count_ops()


def test_spec_reachable_includes_measurement_branches_without_gates():
    initial = QuantumCircuit(2)
    initial.h(0)
    initial.cx(0, 1)
    result = reachable(initial, {"alice": [], "bob": [], "shared": []}, 0, 2)
    assert len(result) == 3
    assert canonical_key(Statevector.from_label("00")) in result
    assert canonical_key(Statevector.from_label("11")) in result


def test_reachable_owner_mapping_keeps_bobs_cx_control_on_alice():
    initial = QuantumCircuit(2)
    result = reachable(initial, {"alice": ["h"], "bob": ["cx"], "shared": []}, 2, 2)
    bell = QuantumCircuit(2)
    bell.h(0)
    bell.cx(0, 1)
    assert canonical_key(Statevector(bell)) in result


def test_full_campaign_batch_runs_locally_and_is_idempotent_across_levels():
    class Counted:
        def __init__(self):
            self.backend = BasicSimulator()
            self.calls = 0
        def __getattr__(self, name):
            return getattr(self.backend, name)
        def run(self, *args, **kwargs):
            self.calls += 1
            return self.backend.run(*args, **kwargs)

    async def check():
        backend, engine = Counted(), Engine(seed=1)
        result = json.loads(await engine.precompute(backend, 50, "batch"))
        assert result["source"] == "backend"
        assert result["circuits"] == result["states"] == 20
        engine.new_session("level3")
        engine.reset_level()
        again = json.loads(await engine.precompute(backend, 200, "single"))
        assert again == result
        assert backend.calls == 1
    asyncio.run(check())


def test_packed_circuit_decodes_each_pair_in_classical_bit_order():
    async def check():
        cache = SamplingCache(seed=3)
        zero, one = Statevector.from_label("00"), Statevector.from_label("11")
        keys = [canonical_key(zero), canonical_key(one)]
        summary = await cache.precompute(BasicSimulator(), dict(zip(keys, [zero, one])),
                                         50, "packed", packed_keys=keys)
        assert summary["circuits"] == 1 and summary["backend_states"] == 2
        assert summary["packed_manifest"][1]["clbits"] == [2, 3]
        assert cache.records[keys[0]].counts == {"00": 50}
        assert cache.records[keys[1]].counts == {"11": 50}
    asyncio.run(check())


def test_default_campaign_pack_covers_ten_priority_states_in_one_circuit():
    async def check():
        engine = Engine(seed=3)
        summary = json.loads(await engine.precompute(BasicSimulator(), shots=20))
        assert summary["strategy"] == "packed"
        assert summary["circuits"] == 1
        assert summary["submitted_states"] == summary["backend_states"] == 10
        assert summary["states"] == 20 and summary["source"] == "mixed"
        assert summary["packed_manifest"][-1]["clbits"] == [18, 19]
        assert summary["submission_attempted"] is True
    asyncio.run(check())


def test_packed_capacity_reduces_pairs_and_submission_failure_never_retries():
    class Limited:
        num_qubits = 4
        calls = 0
        def __init__(self):
            self.backend = BasicSimulator()
        def __getattr__(self, name):
            return getattr(self.backend, name)
        def run(self, circuit, shots):
            self.calls += 1
            assert circuit.num_qubits == 4
            raise RuntimeError("service unavailable")
    async def check():
        backend, engine = Limited(), Engine(seed=1)
        first = json.loads(await engine.precompute(backend, shots=20))
        second = json.loads(await engine.precompute(backend, shots=20, strategy="single"))
        assert first == second
        assert first["submitted_states"] == 2 and first["circuits"] == 1
        assert first["source"] == "statevector_fallback"
        assert backend.calls == 1
    asyncio.run(check())


@pytest.mark.parametrize("failure", ["none", "result", "bad_counts"])
def test_async_backend_result_and_errors_never_resubmit(failure):
    class Job:
        async def result(self):
            if failure == "result":
                raise RuntimeError("result failed")
            return self
        def get_counts(self, index):
            return {"garbage": 50} if failure == "bad_counts" else {"00": 50}
    class Backend:
        def __init__(self):
            self.backend = BasicSimulator()
        def __getattr__(self, name):
            return getattr(self.backend, name)
        calls = 0
        async def run(self, circuit, shots):
            self.calls += 1
            await asyncio.sleep(0)
            return Job()
    async def check():
        backend, cache = Backend(), SamplingCache(seed=1)
        state = Statevector.from_label("00")
        key = canonical_key(state)
        first, second = await asyncio.gather(
            cache.precompute(backend, {key: state}, 50),
            cache.precompute(backend, {key: state}, 50),
        )
        assert first == second
        assert backend.calls == 1
        assert first["source"] == ("backend" if failure == "none" else "statevector_fallback")
    asyncio.run(check())

import asyncio

import pytest
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.quantum_info import Statevector

from quantum.engine import Engine
from quantum.sampling import Distribution, SamplingCache
from quantum.state import canonical_key


class CountingBackend:
    def __init__(self):
        self.backend = BasicSimulator()
        self.calls = []

    def __getattr__(self, name):
        return getattr(self.backend, name)

    def run(self, circuits, **kwargs):
        self.calls.append(circuits)
        return self.backend.run(circuits, **kwargs)


def test_local_counts_seed_and_qiskit_to_game_order():
    cache = SamplingCache(seed=11)
    sv = Statevector.from_label("01")
    counts = cache.local_counts(sv, 50)
    assert counts == {"01": 50}
    assert cache.describe(sv)["counts"] == {}
    cache.records[canonical_key(sv)] = Distribution(counts, "statevector_fallback")
    assert cache.describe(sv)["counts"] == {"10": 50}


def test_noisy_incompatible_counts_fallback_not_null_projection():
    cache = SamplingCache(seed=8)
    sv = Statevector.from_label("00")
    cache.records[canonical_key(sv)] = Distribution({"01": 50}, "backend")
    outcome, details = cache.measure(sv, (None, None), 0)
    assert outcome == 0
    assert details["source"] == "statevector_fallback"
    assert details["reason"] == "incompatible_counts"


def test_filtering_conditioned_counts_and_replacement():
    cache = SamplingCache(seed=9)
    sv = Statevector.from_label("00")
    cache.records[canonical_key(sv)] = Distribution({"00": 1, "11": 49}, "backend")
    for _ in range(8):
        outcome, details = cache.measure(sv, (0, None), 1)
        assert outcome == 0
        assert details["conditioned"] is True
        assert details["discarded_shots"] == 49


def test_sync_and_async_backend_wrappers_single_and_batch():
    async def run():
        backend = CountingBackend()
        cache = SamplingCache(seed=2)
        catalog = {"a": Statevector.from_label("00"), "b": Statevector.from_label("11")}
        result = await cache.precompute(backend, catalog, shots=50, strategy="single", reference_key="a")
        assert len(backend.calls) == 1
        assert result["circuits"] == 1 and result["source"] == "mixed"
        assert cache.records["a"].source == "backend"
        assert cache.records["b"].source == "statevector_fallback"

        backend2 = CountingBackend()
        cache2 = SamplingCache(seed=2)
        result2 = await cache2.precompute(backend2, catalog, shots=50, strategy="batch")
        assert len(backend2.calls) == 1
        assert isinstance(backend2.calls[0], list)
        assert result2["circuits"] == 2
        assert all(r.source == "backend" for r in cache2.records.values())
    asyncio.run(run())


def test_shared_task_and_failed_submission_is_never_retried():
    class Broken:
        def __init__(self):
            self.calls = 0
            self.backend = BasicSimulator()
        def __getattr__(self, name): return getattr(self.backend, name)
        def run(self, *args, **kwargs):
            self.calls += 1
            raise RuntimeError("submit failed")

    async def run():
        backend, cache = Broken(), SamplingCache(seed=4)
        catalog = {"a": Statevector.from_label("00")}
        one, two = await asyncio.gather(cache.precompute(backend, catalog, 50),
                                        cache.precompute(backend, catalog, 50))
        assert one == two
        assert backend.calls == 1
        assert one["submission_attempted"] is True
        assert "backend_error" in one["reason"]
        await cache.precompute(backend, catalog, 50)
        assert backend.calls == 1
    asyncio.run(run())


def test_partial_malformed_results_fallback_and_engine_integration():
    async def run():
        backend = CountingBackend()
        engine = Engine(seed=10)
        engine.new_session("level1")
        response = await engine.precompute(backend, shots=50, strategy="single")
        assert isinstance(response, str)  # Engine facade serializes async responses.
        response = __import__("json").loads(response)
        assert response["states"] > 0
        assert len(backend.calls) == 1
        assert response["shots"] == 50
        assert all(record.source in {"backend", "statevector_fallback"}
                   for record in engine.sampling.records.values())
        assert response["source"] in {"backend", "mixed", "statevector_fallback"}
    asyncio.run(run())


@pytest.mark.parametrize("raw", [{"0": 50}, {"000": 50}, {"0x": 50}, {"00": True}, {"00": 49}])
def test_invalid_backend_counts_rejected(raw):
    with pytest.raises(ValueError):
        SamplingCache.normalize_counts(raw, 2, 50)

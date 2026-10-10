import asyncio
import json

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


# ---- Phi+ measurement must be 50/50, not frozen to one 200-shot histogram ----

def _phi_plus_engine(seed=None, precompute=True):
    engine = Engine(seed=seed)
    if precompute:
        asyncio.run(engine.precompute(None, 200))
    return engine


def _first_outcome(engine):
    """Fresh L1 session: Alice H, Bob CX, RUN, measure q0. Returns the bit q0 collapses to."""
    engine.new_session("level1")
    engine.apply_gate("h", 0, actor="alice")
    engine.apply_gate("cx", 0, 1, actor="bob")
    engine.run_circuit()
    return json.loads(engine.measure(0))["outcome"]


def _skewed_seed(low=86, high=114):
    """A seed whose local 200-shot Phi+ histogram is visibly lopsided (the quantisation noise of one precompute)."""
    for seed in range(200):
        engine = _phi_plus_engine(seed)
        _first_outcome(engine)
        counts = engine.sampling.records[canonical_key(engine.position.sv)].counts
        if not low <= counts.get("00", 0) <= high:
            return seed
    raise AssertionError("no skewed 200-shot histogram found")


def test_local_precompute_histogram_does_not_bias_phi_plus_measurement():
    """Root cause of 'Phi+ always lands on 00': measure() resampled forever from ONE finite 200-shot
    statevector histogram, so a process whose precompute drew e.g. 116/84 measured 58/42 for its whole life.
    Local (statevector_fallback) records must not be a frozen source; only backend counts are."""
    engine = _phi_plus_engine(_skewed_seed())
    zeros = sum(_first_outcome(engine) == 0 for _ in range(1500))
    assert abs(zeros / 1500 - 0.5) < 0.04, zeros


@pytest.mark.parametrize("precompute", [False, True])
def test_phi_plus_first_outcome_is_fair_across_400_fresh_sessions(precompute):
    engine = _phi_plus_engine(precompute=precompute)
    zeros = sum(_first_outcome(engine) == 0 for _ in range(400))
    assert abs(zeros / 400 - 0.5) < 0.1, zeros


def test_independent_unseeded_engines_do_not_replay_the_same_outcomes():
    sequences = {tuple(_first_outcome(engine) for _ in range(64))
                 for engine in (_phi_plus_engine(), _phi_plus_engine(), _phi_plus_engine(precompute=False))}
    assert len(sequences) == 3


def test_phi_plus_is_fair_across_reset_stage_in_one_session():
    engine = _phi_plus_engine()
    engine.new_session("level1")
    outcomes = []
    for _ in range(400):
        engine.reset_stage()
        engine.apply_gate("h", 0, actor="alice")
        engine.apply_gate("cx", 0, 1, actor="bob")
        engine.run_circuit()
        outcomes.append(json.loads(engine.measure(0))["outcome"])
    assert abs(sum(o == 0 for o in outcomes) / 400 - 0.5) < 0.1


def test_backend_counts_remain_the_draw_source_for_backend_records():
    """Hardware-like noise is intentional: a 'backend' record still defines the distribution (with replacement)."""
    cache = SamplingCache(seed=12)
    sv = Statevector([2 ** -0.5, 0, 0, 2 ** -0.5])
    cache.records[canonical_key(sv)] = Distribution({"00": 10, "11": 190}, "backend")
    ones = sum(cache.measure(sv, (None, None), 0)[0] for _ in range(400))
    assert ones > 340  # ~95% follow the backend histogram, not the ideal 50%

"""Small behavior suite: both branches and sequence shortcuts, no statistical runs."""
import json
from unittest.mock import Mock

import pytest

from quantum.engine import Engine
from quantum.sampling import Distribution
from quantum.state import canonical_key


def decode(value):
    return json.loads(value)


@pytest.mark.parametrize("bit,counts,operation,final", [
    (0, {"01": 200}, "x", "00"),
    (1, {"10": 200}, "i", "01"),
])
def test_bob_bit_delivered_before_correcting_alice(bit, counts, operation, final):
    engine = Engine(seed=1)
    initial = decode(engine.new_session("level2"))
    assert initial["bell_label"] == "Phi+"
    assert initial["measurement_allowed"] == [False, False]
    prepared = decode(engine.apply_gate("x", 1, -1, "bob_x", "bob"))
    assert prepared["bell_label"] == "Psi+"
    assert prepared["measurement_allowed"] == [False, True]
    engine.sampling.records[canonical_key(engine.position.sv)] = Distribution(counts, "backend")
    measured = decode(engine.measure(1))
    assert measured["outcome"] == bit
    assert measured["snapshot"]["measured"] == [None, bit]
    assert measured["snapshot"]["entangled"] is False
    assert measured["snapshot"]["door_states"] == {"door_A": "closed", "door_B": "closed"}
    sent = decode(engine.send_bit("bob"))
    assert sent["classical_channel"]["value"] is None
    assert decode(engine.send_bit("bob")) == sent
    received = decode(engine.receive_bit("alice"))
    assert received["classical_channel"]["value"] == bit
    assert received["feed_forward"]["required_correction"] == operation
    before = decode(engine.snapshot())
    wrong = (engine.confirm_identity("alice") if bit == 0
             else engine.apply_gate("x", 0, -1, "alice_x", "alice"))
    assert decode(wrong)["code"] == "WRONG_CORRECTION"
    assert decode(engine.snapshot()) == before
    corrected = (engine.apply_gate("x", 0, -1, "alice_x", "alice") if bit == 0
                 else engine.confirm_identity("alice"))
    assert decode(corrected)["measurement_allowed"] == [True, False]
    done = decode(engine.measure(0))
    assert done["outcome"] == 0
    assert done["snapshot"]["probs"][final] == 1
    assert done["snapshot"]["objective"]["quantum_ready"] is True
    assert done["snapshot"]["door_states"] == {"door_A": "open", "door_B": "open"}
    reset = decode(engine.reset_stage())
    assert reset["feed_forward"]["phase"] == "prepare_bob"
    assert reset["classical_channel"]["sent"] is False
    assert reset["classical_channel"]["received"] is False
    assert reset["door_states"] == {"door_A": "closed", "door_B": "closed"}


def test_shortcuts_do_not_sample_or_mutate_protocol():
    engine = Engine(seed=1)
    engine.new_session("level2")
    sampler = Mock(wraps=engine.sampling.measure)
    engine.sampling.measure = sampler
    before = decode(engine.snapshot())
    rejected = [engine.measure(0), engine.measure(1), engine.send_bit("bob"),
                engine.receive_bit("alice"), engine.confirm_identity("alice"),
                engine.apply_gate("x", 0, actor="alice")]
    assert all(decode(value)["code"] == "PROTOCOL_ORDER" for value in rejected)
    assert decode(engine.apply_gate("x", 1))["code"] == "ACTOR_REQUIRED"
    assert decode(engine.send_bit("alice"))["code"] == "INVALID_ACTOR"
    assert sampler.call_count == 0
    assert decode(engine.snapshot()) == before

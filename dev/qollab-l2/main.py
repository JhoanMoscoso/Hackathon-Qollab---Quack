"""Copy as root main.py in a Python Qollab test project with quantum/ and levels/."""
import json
from quantum import engine


def decode(raw):
    data = json.loads(raw)
    if "error" in data:
        raise RuntimeError(f"{data.get('code')}: {data['error']}")
    return data


async def main(*_args):
    decode(await engine.load_level("level2"))
    initial = decode(engine.new_session("level2"))
    assert initial["bell_label"] == "Phi+"
    assert json.loads(engine.measure(0))["code"] == "PROTOCOL_ORDER"
    print("Fresh Phi+; premature measurement blocked: OK")
    summary = decode(await engine.precompute(backend, shots=200))
    print("PRECOMPUTE:", {k: summary[k] for k in
          ("states", "circuits", "strategy", "backend_states", "source", "reason")})

    prepared = decode(engine.apply_gate("x", 1, -1, "bob_x", "bob"))
    assert prepared["bell_label"] == "Psi+"
    bob = decode(engine.measure(1))
    assert bob["snapshot"]["entangled"] is False
    assert bob["snapshot"]["measured"] == [None, bob["outcome"]]
    print("Bob X -> Psi+; Bob measured:", bob["outcome"])
    assert json.loads(engine.measure(0))["code"] == "PROTOCOL_ORDER"
    sent = decode(engine.send_bit("bob"))
    assert sent["classical_channel"]["sent"] is True
    received = decode(engine.receive_bit("alice"))
    bit = received["classical_channel"]["value"]
    assert bit == bob["outcome"]
    print("SEND/RECEIVE actual classical bit:", bit)

    if bit == 0:
        decode(engine.apply_gate("x", 0, -1, "alice_x", "alice"))
        print("Alice correction: X")
    else:
        decode(engine.confirm_identity("alice"))
        print("Alice correction: KEEP/I (no gate)")
    alice = decode(engine.measure(0))
    final = alice["snapshot"]
    assert alice["outcome"] == 0
    assert final["measured"] == [0, bit]
    assert final["door_states"] == {"door_A": "open", "door_B": "open"}
    print("Final game state:", final["ket"], "Alice=0; both doors open")
    print("Measurement sources:", bob["snapshot"]["last_measurement"]["source"],
          final["last_measurement"]["source"])
    reset = decode(engine.reset_stage())
    assert reset["feed_forward"]["phase"] == "prepare_bob"
    assert reset["classical_channel"]["received"] is False
    print("Reset clears classical channel: OK")
    print("L2 BELL BLOCK: OK (quantum protocol, not a spatial gameplay test)")

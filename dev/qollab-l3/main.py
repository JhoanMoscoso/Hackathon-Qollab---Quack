"""Standalone Qollab Python probe; copy to root with quantum/ and levels/."""
import json
from quantum import engine


def decode(raw):
    result = json.loads(raw)
    if "error" in result:
        raise RuntimeError(f"{result.get('code')}: {result['error']}")
    return result


async def main(*_args):
    decode(await engine.load_level("level3"))
    initial = decode(engine.new_session("level3"))
    assert initial["bell_label"] == "Phi+" and initial["measured"] == [None, None]
    print("L3 fresh Bell pair: OK")
    summary = decode(await engine.precompute(backend, shots=200))
    print("PRECOMPUTE:", {key: summary[key] for key in
          ("states", "circuits", "strategy", "backend_states", "source", "reason")})

    plus = decode(engine.apply_gate("cx", 0, 1, "shared_cx", "shared"))
    assert plus["entangled"] is False
    assert plus["probs"]["00"] == 0.5 and plus["probs"]["10"] == 0.5
    print("CX disentangles:", plus["ket"])
    minus = decode(engine.apply_gate("z", 0, -1, "alice_z", "alice"))
    assert minus["probs"] == plus["probs"]
    print("Z changes phase, not Z-basis probabilities:", minus["ket"])
    final = decode(engine.apply_gate("h", 0, -1, "alice_h", "alice"))
    assert final["probs"]["10"] == 1.0
    print("H turns phase into deterministic game |10>:", final["ket"])
    alice = decode(engine.measure(0))
    bob = decode(engine.measure(1))
    assert alice["outcome"] == 1 and bob["outcome"] == 0
    assert bob["snapshot"]["objective"]["quantum_ready"] is True
    assert bob["snapshot"]["objects"]["bridge_A"] == "1"
    assert bob["snapshot"]["objects"]["laser_B"] == "0"
    print("Alice=1; Bob=0; bridge and laser safe: OK")
    print("Measurement sources:", alice["snapshot"]["last_measurement"]["source"],
          bob["snapshot"]["last_measurement"]["source"])
    reset = decode(engine.reset_stage())
    assert reset["bell_label"] == "Phi+" and reset["measured"] == [None, None]
    print("Reset restores Bell and gate resources: OK")
    print("L3 THE CORE: OK (quantum protocol, not a shared-plate/spatial gameplay test)")

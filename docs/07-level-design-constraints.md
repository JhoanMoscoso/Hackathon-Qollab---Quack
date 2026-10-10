# Entangled — Level design constraints

For: Fernanda (level design). Verified by: Juanjo (E6). Status: Phase 0 tests passed on Built-in and IonQ Forte 1 remote simulator (Oct 9–10).

Revision requested by Juanjo (Oct 10, merged PR #5): Calibration Chamber builds a Bell pair from zero and validates it before measurement/unlocking. The independent/entangled opening is historical; contract/evidence in handoff06 §9 and `levels/level1.json`. The revised Python protocol passed in Qollab built-in/Forte: outcome11 unlocked both doors and reset relocked them. JS diagnostic movement/focus is confirmed; the actual game UI/walkthrough still needs integration.

L2 revision (Oct10): fresh Phi+, Bob X/measure, explicit SEND/RECEIVE, Alice X if0 or KEEP(I) if1, then Alice measures0. Final00/01 both unlock; never require Bob0. Protocol in handoff06§10. Ten map entities; classical controls in HUD. Local success1/blind0, worstcase2gates; runtime/gameplay of this revision pending.

## 1. Where the game runs

Whoever presses **Run** picks the backend, judges included. The game must work the same on all of them; only noise differs.

| Backend | Runs in | Noise | Job limit | Status |
|---|---|---|---|---|
| Built-in simulator | Browser | None (ideal) | Unlimited | Tested OK |
| IBM noise models (Fez, Boston…) | Browser (Qiskit Aer) | Yes | Unlimited | **Not tested yet** |
| IonQ Forte 1 remote simulator | IonQ cloud | Yes | **1 job, 1 circuit per Run** | Tested OK (16 qubits, 1 s) |
| IonQ hardware | Real QPU | Yes | 1 job per Run, costs credits, may queue | Not supported; README says "use a simulator" |

## 2. Quantum rules for every level

1. **2 qubits per level.** `q0` = Alice (left room), `q1` = Bob (right room). A third shared qubit is a stretch goal for L3 only, never started before L1–L3 are playable.
2. **Declared gate sets.** L3 keeps AliceH/Z, BobX, sharedCX. L1 AliceH/BobownedCX0→1. L2 BobX(q1), AliceX(q0) only after received0; KEEP(I) on1 is an explicit no-gate decision. SEND/RECEIVE are classical, not quantum gates.
3. **Every interactive object is bound to one qubit** and shows one of three states: `0`, `1`, `superposition`. A superposed object can't be crossed. The JSON decides what 0 and 1 mean for each object (door opens on 0, bridge appears on 1…).
4. **Sensor = measurement.** Stepping on it measures its qubit in the 0/1 basis. A measured qubit can't receive gates again. A qubit fixed by correlation but not yet measured still can (that is the whole idea of L2 stage 2).
5. **Gate budget.** Each level sets `max_gates` (typically 5–6) and how many times each terminal can be used.
6. **New L1 proof and physical locks.** Start |00>, empty circuit, doors closed. H→CX then RUN validates Phi+ and order; no measurement before validation. Both physical doors unlock only after both explicit measurements match. Quantum object value0 is not an open door; frontend uses door_states. Reset clears the validation proof. RUN consumes no gate/job.

## 3. The measurement-state budget (the main constraint)

On IonQ the whole game gets **one circuit**, sent once at game start. Every state the game will sample on IonQ is packed into that circuit as a 2-qubit pair. Forte 1's simulator has 29 qubits → **hard limit 14 states for the whole game. Target ≤ 10.**

**Measurement state** = the quantum state of the level when a sensor can be triggered while at least one qubit is still in superposition, plus the win state reached by the intended solution (so noise can show up there too).

- States shared between levels count once (Φ⁺ appears in L1, L2 and L3).
- States outside the packed list still work: they are sampled locally with Qiskit `Statevector` and the debugger labels them "sampled locally". Keep them to wrong paths that end in death anyway.

Current designs:

| Level | Packed states | New to the budget |
|---|---|---|
| L1 Calibration Chamber (revision) | Φ⁺ and measured outcomes 00/11; construction preview is 00→+0→Φ⁺ | Shared with existing priorities; no extra pair |
| L2 Bell Block | Φ⁺→Ψ⁺; Bob0→10→AliceX→00 / Bob1→01→KEEP(I)→01 | Covered by existing priorities |
| L3 The Core | Φ⁺, `\|+0⟩`, `\|−0⟩`, `\|10⟩` (+ Φ⁻ / Ψ⁻ if Z is used on the entangled pair) | 3–5 |
| **Total** | | **6–8 → 12–16 qubits. Fits (16 was tested).** |

A new level or stage must add **at most 3–4** new measurement states. If an idea needs more, simplify it or split it into stages.

## 4. Noise rule

Measured on Forte 1 (200 shots): Φ⁺ broke 2% of the time, Ψ⁺ 1%, a single-X state 0%. Anything that goes through a CNOT can fail ~1–3% of the time on noisy backends, **including the correct solution**.

- **Proposed rule (team decision pending):** if the ideal outcome had probability 1.0 and noise flips it, it's a **decoherence glitch**, not a death. The Observer says something like "Hardware noise detected", and the stage resets without counting as a death. This never happens on the Built-in simulator.
- Real 50/50 risks (measuring blind) stay lethal. That's the puzzle.
- Write one glitch line per level for the Observer (`narration.glitch`).

## 5. Session rules

- **One Run = the whole game.** No saves, no persistence between runs. Keep each level short (target 2–4 min for someone who understands it).
- **Level select in the menu with all levels unlocked.** Judges may not finish L1; nothing is saved anyway.
- **Loading takes 10–30 s** on the first Run (Pyodide + Qiskit + IonQ job). The loading screen needs content: premise, controls, one-line quantum hint.
- If it hangs on loading, reloading the tab fixes it (memory builds up after many runs in the same tab). Mention it in the README.

## 6. Map and asset limits

- Grid **20 × 12 cells** (16 px tiles drawn at ×2 on a 640 × 384 canvas). Central wall = columns 9–10. Alice's room on the left, Bob's on the right.
- **≤ 10 entities per level** (players, doors, sensors, terminals, exits).
- Levels are JSON files read by Python (`levels/levelN.json`). JS can't read files directly.
- Project limits: 100 files, 2 MB each. One spritesheet, one OGG, no per-level image files.
- Accessibility: states never shown by color alone (shape/stripes + debugger text), text contrast ≥ 4.5:1, superposition flicker replaced by static stripes when "Reduce motion" is on.

## 7. How to propose a level

Fill this in and pass it to Juanjo. He runs E6 before it goes into JSON.

```
Level / stage:
Story beat (1 line, English):
Initial state (circuit):            e.g. H(q0), CX(q0,q1)  → Φ⁺
Gates available (Alice / Bob / CNOT) and uses per terminal:
max_gates:
Objects (name, qubit, open_on, lethal?):
Win condition (bits + both players on exit):
Intended solution (step by step):
Expected success measuring blind:   e.g. 0.5
Measurement states used (list):
Observer lines: enter / first_gate / first_measure / death / glitch / win
Rough map sketch (20×12):
```

**A level is final only when E6 confirms:** (a) a 100% solution exists, (b) the blind success rate matches the design intent, (c) its new measurement states fit the budget.

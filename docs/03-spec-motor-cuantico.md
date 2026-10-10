# Entangled — Especificación del motor cuántico (`quantum/`)

Dueño: Juanjo. Consumidor: Jhoan (`main.js`). Todo lo que se devuelve a JS es **string JSON**.

## Conceptos que el equipo debe entender (en orden)

1. **Qubit y base computacional.** Un qubit es un vector unitario `|ψ⟩ = α|0⟩ + β|1⟩`, `|α|² + |β|² = 1`. Medir en la base computacional da 0 con probabilidad `|α|²` y 1 con `|β|²`, y deja el qubit en el valor obtenido.
2. **Registro de 2 qubits.** Estado = 4 amplitudes sobre `|00⟩,|01⟩,|10⟩,|11⟩`. Convención del juego: el primer bit es `q0` (Alice), el segundo `q1` (Bob). Ojo: Qiskit imprime bitstrings con `q0` **a la derecha** (little-endian). El motor convierte siempre a la convención del juego antes de devolver.
3. **Estado producto vs entrelazado.** Producto: `|ψ⟩ = |a⟩⊗|b⟩` (medir uno no cambia las probabilidades del otro). Entrelazado: no se puede escribir así. Test práctico: entropía de la matriz densidad reducida de q0 > 0.
4. **Estados de Bell.** `Φ⁺=(|00⟩+|11⟩)/√2` (resultados siempre iguales), `Ψ⁺=(|01⟩+|10⟩)/√2` (siempre opuestos), `Φ⁻`, `Ψ⁻` (igual que los anteriores pero con fase −, invisible al medir en base Z).
5. **Compuertas del juego** (matrices 2×2 salvo CNOT):
   - `X`: `|0⟩↔|1⟩`. Sobre `Φ⁺` en q1 → `Ψ⁺` (cambia "iguales" por "opuestos").
   - `H`: `|0⟩→|+⟩=(|0⟩+|1⟩)/√2`, `|1⟩→|−⟩=(|0⟩−|1⟩)/√2`. `H·H = I`.
   - `Z`: `|0⟩→|0⟩`, `|1⟩→−|1⟩`. No cambia probabilidades en base Z. `H·Z·H = X` (interferencia).
   - `CX(control=q0, target=q1)`: si q0 es 1, aplica X a q1. `CX(|+⟩|0⟩) = Φ⁺` (crea entrelazamiento). `CX(Φ⁺) = |+⟩|0⟩` (lo destruye).
6. **Medición parcial y correlación.** Medir q0 en `Φ⁺` y obtener 0 proyecta el registro a `|00⟩`: q1 queda definido sin tocarlo. En `Ψ⁺`, q1 queda en el valor opuesto.
7. **Feed-forward.** Tras medir q0, q1 es definido pero aún no medido: Bob puede aplicar X para elegir su valor **determinísticamente**. (Es la corrección clásica de la teleportación.)
8. **Determinismo por desentrelazar.** `Φ⁺ → CX → |+⟩|0⟩ → H(q0) → |00⟩ → X(q0) → |10⟩`. Toda rama de 100 % pasa por volver a un estado producto o por interferencia (`H Z H`).
9. **No-cloning / no-signalling.** Bob no puede saber qué hizo Alice mirando solo su qubit; por eso en el juego los dos ven el mismo debugger (canal clásico). Esto es físicamente honesto y hay que decirlo en el narrador.

## API pública (`quantum/engine.py`)

Todas las funciones son `async def` donde tocan `backend`, y síncronas en el resto (JS las llama igual con `callPromising`).

```python
async def load_level(level_id: str) -> str
# Lee levels/<id>.json (ruta literal: usar un dict LEVEL_FILES = {"level1": "levels/level1.json", ...})
# Devuelve el JSON del nivel tal cual (JS lo usa para construir el mapa) + "num_qubits".

def new_session(level_id: str) -> str
# Crea la sesión: estado inicial (del JSON: "initial_circuit": [["h",0],["cx",0,1]]), historial vacío.
# Devuelve snapshot (ver abajo).

async def precompute(backend, shots: int = 200) -> str
# BFS de estados alcanzables + UN backend.run con todos los circuitos de medición.
# Devuelve {"states": n, "circuits": n, "source": "backend"|"statevector_fallback", "backend": str(backend)}.

def apply_gate(gate: str, qubit: int, target: int = -1) -> str
# gate ∈ {"x","h","z","cx"}; para "cx" qubit=control, target=target.
# Valida contra el gate set del nivel y el presupuesto. Devuelve snapshot (o {"error": "..."}).

def measure(qubit: int) -> str
# Saca un shot de counts[state_key] (o fallback), lee el bit, proyecta el estado.
# Devuelve {"qubit": k, "outcome": 0|1, "snapshot": {...}}.

def reset_level() -> str
# Vuelve al estado inicial, limpia historial. Devuelve snapshot.

def snapshot() -> str
```

### Formato de `snapshot`

```json
{
  "num_qubits": 2,
  "ket": "0.707|00⟩ + 0.707|11⟩",
  "amplitudes": [[0.707,0.0],[0,0],[0,0],[0.707,0.0]],
  "probs": {"00":0.5,"01":0.0,"10":0.0,"11":0.5},
  "marginals": [[0.5,0.5],[0.5,0.5]],
  "measured": [null, null],
  "entangled": true,
  "bell_label": "Phi+",
  "history": [["h",0],["cx",0,1]],
  "gates_left": 4,
  "state_key": "a3f9…",
  "objects": {"door_A": "super", "bridge_B": "super"}
}
```

- `probs` y `ket` en **convención del juego** (q0 a la izquierda).
- `measured[k]` = 0/1 si el qubit ya fue medido en este nivel, si no `null`.
- `objects` lo resuelve el motor con las reglas del JSON (`"objects": {"door_A": {"qubit":0, "open_on":0}}`) → `"0" | "1" | "super"`.
- `bell_label` ∈ `{"Phi+","Phi-","Psi+","Psi-",null}` (comparación con tolerancia, módulo fase global).

## Formato de nivel (`levels/levelN.json`)

```json
{
  "id": "level1",
  "title": "Correlation",
  "num_qubits": 2,
  "initial_circuit": [["h",0],["cx",0,1]],
  "gate_set": {"alice": ["h","z"], "bob": ["x"], "shared": ["cx"]},
  "max_gates": 6,
  "win": {"q0": 0, "q1": 0},
  "map": ["##########||##########",
          "#A..D....#||#....d..B#",
          "#..S.....#||#.....s..#",
          "#....E...C||C...e....#",
          "##########||##########"],
  "legend": {
    "A":"alice_start","B":"bob_start","S":"sensor_q0","s":"sensor_q1",
    "D":"door_A","d":"door_B","C":"cnot_control/target","E":"exit_A","e":"exit_B"
  },
  "objects": {
    "door_A": {"qubit":0, "open_on":0, "lethal":false},
    "door_B": {"qubit":1, "open_on":0, "lethal":false}
  },
  "terminals": [{"cell":[3,2],"gate":"h","owner":"alice","uses":1}],
  "narration": {"enter":"...", "first_measure":"...", "death":"...", "win":"..."}
}
```

## Enumeración (`quantum/enumerate.py`)

```python
def canonical_key(sv: Statevector) -> str:
    v = sv.data.copy()
    i = np.argmax(np.abs(v) > 1e-9)        # primer amplitud no nula
    v = v * np.exp(-1j*np.angle(v[i]))      # quita fase global
    return hashlib.sha1(np.round(v, 6).tobytes()).hexdigest()[:12]

def reachable(initial: QuantumCircuit, gate_set, max_gates, num_qubits):
    # BFS sobre (statevector, circuito_de_preparación, gates_usadas)
    # vecinos: cada compuerta permitida sobre cada qubit permitido
    #        + proyección post-medición de cada qubit a 0 y a 1 (si prob > 1e-9)
    # dedupe por canonical_key. Devuelve dict key -> circuito de preparación (sin medición).
```

Circuito de medición por estado = preparación + `measure_all()`. Proyección post-medición: se implementa con numpy sobre `sv.data` (poner a 0 las amplitudes incompatibles y renormalizar); el circuito de preparación de una rama post-medición se registra como `prep + [("reset_to", key)]` y para `backend.run` se reconstruye con `StatePreparation` o, más simple, con `QuantumCircuit.initialize(vector)`. El built-in y IonQ aceptan `initialize` tras transpilación; probar en F0 y, si no, usar solo ramas sin medición previa (la rama post-medición se muestrea con `Statevector`, que sigue siendo Qiskit).

## Pruebas mínimas (pytest local, fuera de Qollab)

1. `Φ⁺` → medir q0 1000 veces: siempre `outcome(q0) == outcome(q1)`.
2. `Φ⁺` + `X(q1)` → siempre opuestos.
3. `Φ⁺` → `CX` → `H(0)` → `probs["00"] == 1.0`.
4. `H Z H` sobre `|0⟩` → `|1⟩`.
5. `canonical_key` de `Φ⁺` y de `−Φ⁺` coinciden; de `Φ⁺` y `Φ⁻` difieren.
6. `reachable` con gate set del L1 y `max_gates=6` devuelve ≤ 60 estados y contiene las keys de `Φ⁺`, `Ψ⁺`, `|00⟩`, `|10⟩`.
7. Convención: tras `X(q0)` en `|00⟩`, `probs["10"] == 1.0` (no `"01"`).

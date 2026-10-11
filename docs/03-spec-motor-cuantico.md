# Entangled — Especificación del motor cuántico (`quantum/`)

Dueño: Juanjo. Consumidor: Jhoan (`main.js`). Todo lo que se devuelve a JS es **string JSON**.

**Contrato implementado v2:** niveles con `stages[]`, API/ejemplo real en `docs/snapshot-example.json` e instrucciones de entrega en `docs/06-handoff-juanjo.md` §7. Los mapas siguen pendientes de walkthrough JS. Extensiones v2 son explícitas, no suponer que el ejemplo antiguo de un nivel sin etapas es un asset listo para cargar.

**Revisión de L1 integrada y validada (2026-10-10):** `Calibration Chamber` parte de |00⟩ y exige H de Alice, CX de Bob y `run_circuit()` antes de medir. PR #5 fusionado; protocolo completo pasó en Qollab built-in/Forte, incluida apertura para 11 y reset. Snapshot inicial en `docs/snapshot-level1-example.json`; evidencia en handoff06 §9. Falta conectar UI/colisiones y realizar el walkthrough antes de declararse jugable.

**L2 Bell Block (revisión 2026-10-10):** una etapa que re-prepara Φ⁺; Bob X(q1)→medir q1→SEND→Alice RECEIVE→X(q0) si m=0 / KEEP(I) explícito si m=1→medir q0=0. Snapshot actual en `docs/snapshot-example.json`. Protocolo Python validado en Qollab built-in/Forte (Bob1→KEEP→Alice0/01 y ambas puertas); los controles están conectados al frontend pero su recorrido visual/audio sigue pendiente. Evidencia en handoff06 §10.

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

**L3 The Core:** mismas gates/objetivo del MD06. Terminales locales pueden declarar `placement:"hud"` sin `cell`; mantienen id/owner/qubit/uses y se consumen con apply_gate. Solo CX compartida lleva celdas físicas y exige ambos jugadores. Diez entidades sin quitar H/Z/X ni sumar estados al pack. Probe `dev/qollab-l3/main.py`, handoff06§11.

Todas las funciones son `async def` donde tocan `backend`, y síncronas en el resto (JS las llama igual con `callPromising`).

```python
async def load_level(level_id: str) -> str
# Lee las rutas literales levels/level1.json, level2.json, level3.json con ramas open literales.
# Devuelve el nivel entero con schema_version=2, num_qubits y stages[].

def new_session(level_id: str) -> str
# Crea sesión desde initial_circuit del JSON; L1 usa [] → |00⟩, L2/L3 preparan Bell.
# Devuelve snapshot (ver abajo).

async def precompute(backend=None, shots: int = 200, strategy: str = "packed") -> str
# BFS de toda la campaña + a lo sumo UN backend.run en la vida de la ejecución.
# packed: diez pares prioritarios en UN circuito de veinte qubits (07 constraints).
# single: un Bell remoto; batch: opt-in para backends compatibles. Restantes fallback.
# Devuelve states, circuits realmente enviados, source backend|mixed|statevector_fallback,
# backend, shots, strategy, sources por estado, submission_attempted, reason,
# submitted_states y packed_manifest (state_key/qubits/clbits por par).

def apply_gate(gate: str, qubit: int, target: int = -1,
               terminal_id=None, actor=None) -> str
# gate ∈ {"x","h","z","cx"}; para "cx" qubit=control, target=target.
# Valida contra el gate set del nivel y el presupuesto. Devuelve snapshot (o {"error": "..."}).
# Sin id explícito se resuelve un terminal compatible y se consumen sus usos igualmente.
# L1 y Bell Block exigen actor="alice"/"bob" explícito; L3 conserva actor opcional.

def run_circuit() -> str
# En L1 valida orden H(0),CX(0,1) y estado Phi+ módulo fase global; no consume gates/jobs.
# Devuelve snapshot con prueba validada persistente; aún no abre puertas ni mide.
# Idempotente después de validación, incluso tras colapso; reset elimina esa prueba.

def measure(qubit: int) -> str
# Saca un shot de counts[state_key] (o fallback), lee el bit, proyecta el estado.
# Devuelve {"qubit": k, "outcome": 0|1, "snapshot": {...}}.
# En L1, antes de RUN válido devuelve CIRCUIT_NOT_VALIDATED sin muestrear/mutar.
# En L2 solo Bob puede medir tras su X; Alice solo tras RECEIVE + corrección correcta.

def send_bit(actor=None) -> str
# Actor bob; envía únicamente el resultado ya observado q1. No acepta un bit arbitrario.

def receive_bit(actor=None) -> str
# Actor alice, después de SEND. Copia el valor real del mensaje en classical_channel.

def confirm_identity(actor=None) -> str
# Actor alice; decisión KEEP/I explícita únicamente con bit recibido 1.
# No aplica matriz nueva, no consume gate/terminal/job. Bit0 debe usar apply_gate X(q0).

def reset_level() -> str
# Vuelve al estado inicial, limpia historial. Devuelve snapshot.

def reset_stage() -> str
# Reinicia solo etapa activa. Los resets no borran counts ni el guard del envío.

def advance_stage() -> str
# Solo desde objective.quantum_ready; JS debe confirmar ambas salidas antes de llamarlo.
# Última etapa devuelve code LEVEL_COMPLETE; JS puede cargar el próximo nivel.

def load_audio(track: str = "menu") -> str
# track: "menu" (audio/fondo_inicio.ogg) | "level1" (fondo_1.ogg) | "level2" (fondo_2.ogg, también niveles 2 y 3).
# JSON {mime,encoding:"base64",data}; pista desconocida -> code INVALID_TRACK;
# archivo ausente o >2 MB -> code AUDIO_UNAVAILABLE. Rutas literales separadas (requisito de Qollab).
# JS la llama bajo demanda (primera vez que necesita la pista) y cachea el buffer decodificado; nunca por frame.

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
  "history": [],
  "initial_circuit": [["h",0],["cx",0,1]],
  "gates_left": 1,
  "state_key": "a3f9…",
  "objects": {"door_A": "super", "bridge_B": "super"}
}
```

- `probs` y `ket` en **convención del juego** (q0 a la izquierda).
- `amplitudes` ordenadas lexicográficamente en esa convención: 00,01,10,11. Redondeo solo al serializar, no para evolucionar/proyectar.
- `measured[k]` = 0/1 si el qubit ya fue medido en este nivel, si no `null`.
- `objects` lo resuelve el motor con las reglas del JSON (`"objects": {"door_A": {"qubit":0, "open_on":0}}`) → `"0" | "1" | "super"`.
- `bell_label` ∈ `{"Phi+","Phi-","Psi+","Psi-",null}` (comparación con tolerancia, módulo fase global).
- Campos v2 adicionales: `schema_version`, `level_id`, `stage_id`, `stage_index` base0, `stage_count`, `revision`, `terminal_uses_left`, `objective`, `source`, `sampling`, `last_measurement`. Ver snapshot completo entregado.
- `history` registra acciones posteriores a preparación, incluida `["measure",q,outcome]`; no se duplica la preparación oculta. `measured` solo registra observaciones explícitas: un qubit definido por correlación sigue disponible para gates.
- `objective.status` = pending/ready/failed; `quantum_ready` exige win y `required_measurements` (ambos qubits en MVP). Victoria espacial se decide en JS. Errores conservan `error` y agregan `code` estable.
- L1 añade `circuit_validation` (required/validated/status/target_bell/required_sequence), `measurement_enabled`, `exits_unlocked` y `door_states`. `objects[door_A]="0"` sigue siendo el valor cuántico: **no indica que la puerta esté abierta**. Arte/colisión del nuevo tipo `validated_exit` deben usar `door_states`.
- En L1 `quantum_ready` exige prueba previa, ambas medidas explícitas y paridad igual. `circuit_validation.status="complete"` significa protocolo cuántico completo, no que los jugadores ya llegaron a salidas. Las gates quedan bloqueadas tras RUN hasta reset. `history` registra `["run_circuit"]` como evento de validación, no gate física del diagrama.
- L2 añade `feed_forward.phase` y `required_correction`, `classical_channel` (sender/receiver/sent/received/value), `measurement_allowed` por qubit y `door_states`/`exits_unlocked`. Mensaje visible en la consola solo tras recibir; el debugger global sigue siendo una vista conjunta/clásica, no el estado local de Alice. Gates/SEND/RECEIVE/KEEP usan roles explícitos; orden equivocado → `PROTOCOL_ORDER`, corrección equivocada → `WRONG_CORRECTION` sin mutar ni gastar recursos.
- La prueba de secuencia no equivale a violar la desigualdad de Bell. Alice podría inferir el resultado de Bob midiendo temprano en Ψ⁺ ideal, pero esa medición consumiría su qubit e impediría la corrección posterior: el protocolo la bloquea antes de muestrear.

## Formato de nivel (`levels/levelN.json`)

**Ejemplo v1 histórico para contexto, no válido en el loader v2.** Los assets reales son `levels/level1.json`–`level3.json`: cabecera con `schema_version,id,title,num_qubits,stages`; cada etapa incluye `id`, `required_measurements`, `failure_policy`. `uses:null` significa reutilizable y limitado por max_gates. Terminales llevan id/qubit/target. CX compartida de L3 requiere target_cell; la CX de Bob en L1 usa activation=owner, control q0/target q1 y una celda en su sala, sin requerir ambas placas. No inferir operandos de CX a partir del owner.

L1 declara `validation: {target_bell:"Phi+",required_sequence:[["h",0],["cx",0,1]]}` y dos `validated_exit` con `blocking:true,unlock_when:"objective_ready"`, sin `open_on`. Las puertas físicas abren para 00 **y** 11 tras preparación validada y ambas medidas; no usar la regla legacy de puerta verde=0 para ese tipo.

L2 declara `feed_forward: {sender_qubit:1,receiver_qubit:0,preparation_gate:["x",1],corrections:{"0":"x","1":"i"},classical_channel:"explicit_send_receive"}`. Dos `protocol_exit` se abren con objetivo completo, no con el bit Bob: tanto 00 como 01 finales son válidos. Identidad y mensaje son eventos clásicos del historial, no gates físicas. Reset borra mensaje/decisión y re-prepara Φ⁺, sin reenviar al backend.

`placement:"hud"` admite solo gates locales Alice/Bob, sin cell/target_cell, nunca CX. Parser JS omite su entidad física; Python valida gate/owner/qubit/usos/presupuesto. En L3 botones/teclas H/Z de Alice y X de Bob usan cola/epochguard; deshabilitados al medir, agotar recursos o terminar. No inferir geometría de una celda faltante ni simular gates en el renderer.

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
from quantum.enumerate import canonical_key, enumerate_stage, campaign_catalog, reachable
# canonical_key: normaliza, elimina fase global y ceros con signo;
# incluye num_qubits, serialización estable sin depender de bytes de dtype.
# enumerate_stage(stage): BFS lógico con presupuesto, mediciones y usos de terminal.
# Devuelve dict key -> Statevector; dedupe físico solo para el catálogo.
# reachable(initial,gate_set,max_gates,num_qubits): fixture genérico de la spec;
# incluye proyección y devuelve dict key -> circuito de preparación.
```

Circuito de medición = circuito **nuevo** de `StatePreparation(vector)` + `measure_all()`, transpilado al backend. `initialize` fue rechazado en Forte por `reset`, incluso transpilado; no usarlo en esta estrategia. Se verifica equivalencia de la receta antes de enviarla. Muestreo con reemplazo, counts en orden Qiskit interno y conversión al devolver JSON. Solo los counts de **backend** se reutilizan como fuente de cada medición; un registro local (`statevector_fallback`) es una única muestra finita de 200 shots y no se re-muestrea (congelaría su error de cuantización, p. ej. 116/84 en vez de 50/50): cada medición local es un sorteo nuevo del vector ideal. Resultados imposibles para la medición solicitada se filtran con diagnóstico; si no queda masa, fallback Qiskit. Las probabilidades/estado siguen siendo ideales, no reconstrucción física de ruido.

## Pruebas mínimas (pytest local, fuera de Qollab)

1. `Φ⁺` → medir q0 1000 veces: siempre `outcome(q0) == outcome(q1)`.
2. `Φ⁺` + `X(q1)` → siempre opuestos.
3. `Φ⁺` → `CX` → `H(0)` → `probs["00"] == 1.0`.
4. `H Z H` sobre `|0⟩` → `|1⟩`.
5. `canonical_key` de `Φ⁺` y de `−Φ⁺` coinciden; de `Φ⁺` y `Φ⁻` difieren.
6. `reachable` con fixture genérico Clifford y `max_gates=6` devuelve ≤ 60 estados y contiene las keys de `Φ⁺`, `Ψ⁺`, `|00⟩`, `|10⟩`. No exigir Ψ⁺ al L1 restringido a H(0),CX(0,1).
7. Convención: tras `X(q0)` en `|00⟩`, `probs["10"] == 1.0` (no `"01"`).

8. L1: circuito vacío, incompleto, orden incorrecto, Phi+ sin RUN y una sola medida no abren puertas. RUN compara estado completo, no counts/paridad; aceptar fase global, rechazar estado producto aunque haya historial correcto. Ambas ramas 00/11 abren ambas puertas después de medir ambos; reset las vuelve a cerrar. Gates sin actor se rechazan en L1, RUN repetido es idempotente y nunca envía otro job.

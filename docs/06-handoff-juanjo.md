# Handoff — Juan José (Python / Qiskit)

Eres dueño de `quantum/` y de `levels/*.json`. El contrato con Jhoan está en `docs/03-spec-motor-cuantico.md`; este documento dice **en qué orden probar** y qué anotar. Cada experimento termina con una nota en `docs/findings-qiskit.md` (funciona / no funciona / cómo lo resolviste), porque de esas notas salen las decisiones de arquitectura y el texto técnico de la project page.

## 0. Entorno (30 min)

Local:
```
python -m venv .venv && source .venv/bin/activate
pip install "qiskit>=2.5.2,<3" numpy pytest
```
Qollab: crea **tu propio** proyecto de prueba de tipo **Python / Qiskit** (`main.py`, salida por consola). Es más rápido que el proyecto JS para experimentar: `backend` es global, `await` funciona a nivel de módulo, `print` sale en consola. Cuando algo funcione ahí, lo mueves a `quantum/engine.py` del repo.

Reglas del runtime que te afectan:
- `backend` lo elige quien presiona Run; nunca lo crees tú.
- IonQ (simuladores remotos y hardware): **un solo `backend.run` por Run**. Local: ilimitado.
- Sin `input()`. Sin escritura persistente. Rutas de archivos propios **como string literal** o no se cargan.
- Qiskit imprime bitstrings con `q0` a la **derecha** (little-endian). El juego usa `q0` a la **izquierda**. Toda salida del motor se convierte.

## 1. Experimentos (en orden, cada uno < 45 min)

### E1 — Orden de bits y estados de Bell (local)
```python
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
qc = QuantumCircuit(2); qc.x(0)
print(Statevector(qc).probabilities_dict())   # esperado en Qiskit: {'01': 1.0}  -> en el juego es "10"
def to_game(bits: str) -> str: return bits[::-1]
```
Verifica `Φ⁺ = H(0), CX(0,1)`, `Ψ⁺ = Φ⁺ + X(1)`, `Φ⁻ = Φ⁺ + Z(0)`, `Ψ⁻ = Ψ⁺ + Z(0)`. Escribe `bell_label(sv)` comparando con tolerancia `1e-6` **módulo fase global**.

### E2 — Lista de circuitos en un solo `backend.run` (Qollab: built-in, luego IonQ Forte 1 remote)
```python
import json
from qiskit import QuantumCircuit
circs = []
for k in range(3):
    qc = QuantumCircuit(2, 2); qc.h(0); qc.cx(0, 1)
    if k == 1: qc.x(1)
    if k == 2: qc.z(0)
    qc.measure([0, 1], [0, 1]); circs.append(qc)
job = await backend.run(circs, shots=200)
res = await job.result()
for i in range(3): print(i, res.get_counts(i))
print(str(backend))
```
Anota: ¿acepta lista? ¿`get_counts(i)` funciona? ¿Cuánto tarda en IonQ con 3, 30 y 60 circuitos a 200 shots? **Si la lista no funciona en IonQ, la estrategia pasa a fallback `Statevector.sample_counts` para todo lo que no sea el primer circuito; avísalo de inmediato.**

### E3 — Statevector como fuente de verdad (local)
- `Statevector(qc)`, `sv.evolve(gate_circuit)`, `sv.probabilities_dict()`.
- Proyección por medición parcial con numpy (no uses `sv.measure()` porque es aleatoria; tú decides el resultado con el shot):
```python
import numpy as np
def project(sv_data, qubit, outcome, n):
    v = sv_data.copy()
    for idx in range(len(v)):
        if (idx >> qubit) & 1 != outcome: v[idx] = 0   # idx bit `qubit` en convención Qiskit
    norm = np.linalg.norm(v); return v / norm if norm > 1e-12 else None
```
- Detección de entrelazamiento: `from qiskit.quantum_info import partial_trace, entropy`; `entropy(partial_trace(sv, [1])) > 1e-6`.
- Ket legible: función propia que recorre amplitudes no nulas y arma `"0.707|00⟩ + 0.707|11⟩"` (con bits en convención del juego, signo `-` cuando la parte real es negativa, `i` cuando es imaginaria).

### E4 — Preparar estados post-medición en un circuito real (Qollab built-in e IonQ)
Las ramas post-medición necesitan un circuito que prepare ese estado para medirlo en `backend.run`. Prueba `qc.initialize(vector)` y `StatePreparation` (`qiskit.circuit.library`). Si `initialize` falla en IonQ por el `reset`, prueba `StatePreparation` sin reset. Si ambos fallan: esas ramas se muestrean con `Statevector.sample_counts` (sigue siendo Qiskit) y se marca `"source": "statevector_fallback"` en el snapshot.

### E5 — Enumeración de estados alcanzables (local)
Implementa `quantum/enumerate.py` según la spec: BFS con dedupe por `canonical_key`. Mide el tamaño del conjunto para cada nivel (abajo). Objetivo: ≤ 60 estados por nivel. Si L3 con `max_gates=5` supera 60, baja a 4.

### E6 — Verificador de niveles (local, el más importante)
Para cada nivel: búsqueda exhaustiva de secuencias (compuertas + mediciones) hasta `max_gates` y reporte de:
- ¿existe una secuencia con probabilidad de victoria = 1.0? (debe existir)
- ¿cuál es la probabilidad de victoria midiendo a ciegas sin compuertas? (L1 etapa 1: 0.5; L1 etapa 2: 1.0; L2 etapa 1: 0.0; L2 etapa 2: 0.5; L3: 0.0)
- lista de todas las soluciones mínimas (para el narrador y el README).

### E7 — Rendimiento del puente JS↔Python (proyecto JS junto con Jhoan, H+4)
Mide con `performance.now()` en JS el coste de `apply_gate` y `measure`. Objetivo < 20 ms. Si `Statevector` de 3 qubits tarda más, cachea por `state_key`.

## 2. Definición de los niveles (para E5/E6 y para `levels/*.json`)

Convención: `q0` = Alice, `q1` = Bob. Objetos: `open_on` = valor que lo deja pasar; `lethal` = pisarlo en el otro valor mata.

### L1 — Calibration (Lab). Sin compuertas. Dos etapas, el registro se re-prepara entre ellas.
- Etapa 1 "Independent lock": `initial_circuit = [["h",0],["h",1]]`. Puertas `door_A(q0)`, `door_B(q1)`, ambas `open_on: 0`. Cerradura de paridad: la salida se abre si los dos resultados **coinciden** (`win: {"parity": "equal"}`). Medidos a ciegas: p = 0.5. Fallo = "lock jams", reinicio de etapa (sin muerte).
- Etapa 2 "Entangled lock": `initial_circuit = [["h",0],["cx",0,1]]` (Φ⁺). Misma cerradura. p = 1.0 siempre.

### L2 — Bell Block (Prison). Gate set: Bob `["x"]`. Dos etapas.
- Etapa 1 "Opposites": Φ⁺. Cada celda tiene dos puertas: `north(open_on 0)` y `south(open_on 1)`, ambas llevan al pasillo. Trampa: `win: {"parity": "different"}` — si los dos resultados coinciden, alarma (muerte). A ciegas: p = 0.0. Solución: `X(q1)` → Ψ⁺ → p = 1.0.
- Etapa 2 "Feed-forward": Φ⁺ de nuevo. Alice: dos corredores (`north open_on 0`, `south open_on 1`), ambos válidos. Bob: una reja `gate_B(q1, open_on 0, lethal: true)` y una terminal `X` dentro de su celda, reutilizable. A ciegas: p = 0.5. Solución: Alice mide primero; si `measured[0] == 1` (y por tanto `q1` ya es 1), Bob aplica X y luego mide. p = 1.0. **Regla del motor:** `apply_gate` sobre un qubit ya medido debe estar prohibido (`error`), pero sobre un qubit *definido por correlación y no medido* debe estar permitido. Esa distinción es el nivel entero.

### L3 — The Core. Gate set: Alice `["h","z"]`, Bob `["x"]`, shared `["cx"]`. `max_gates: 5`. Una etapa.
- `initial_circuit = [["h",0],["cx",0,1]]` (Φ⁺). Alice: `bridge_A(q0, open_on 1, lethal: true)` (0 = cae). Bob: `laser_B(q1, open_on 0, lethal: true)` (1 = vaporizado). `win: {"q0": 1, "q1": 0}`.
- A ciegas: p = 0.0 (siempre muere uno). Solución canónica: `CX(0,1)` → `|+⟩|0⟩`; `Z(0)` → `|−⟩|0⟩`; `H(0)` → `|10⟩`. Verifica que E6 la encuentra y que no hay solución sin CX.
- Stretch (solo si L1–L3 están jugables): `q2` = puerta de salida compartida; estado inicial GHZ `[["h",0],["cx",0,1],["cx",1,2]]`, `win: {"q0":1,"q1":0,"q2":0}`. Calcula la solución con E6 antes de proponerlo.

## 3. Orden de implementación de `quantum/engine.py`

1. `new_session` + `snapshot` + `apply_gate` solo con `Statevector` (sin backend). Entrega a Jhoan a **H+4** un `snapshot` de ejemplo en `docs/snapshot-example.json` para que haga su mock.
2. `measure` con muestreo `Statevector.sample_counts` (fallback). Ya es jugable en local.
3. `enumerate.py` + `precompute(backend, shots)` con un solo `backend.run`. `measure` pasa a consumir `counts[state_key]`.
4. Reglas de nivel: gate set por jugador, `uses` por terminal, `max_gates`, etapas, `parity`.
5. `load_level` con rutas literales y `load_audio()` que devuelve los bytes del OGG.
6. Tests en `quantum/tests/test_engine.py` (los 7 de la spec + E6 para los tres niveles).

## 4. Trampas conocidas

- Devuelve siempre `json.dumps(...)`. Los `complex` de numpy no son serializables: conviértelos a `[re, im]` y redondea a 6 decimales. Los `np.float64` conviértelos a `float`.
- Desde JS todo se llama con `callPromising`; tus funciones que usan `backend` deben ser `async def` y usar `await backend.run(...)` y `await job.result()`.
- `Statevector.sample_counts(shots, qargs=None)` acepta `seed` en versiones recientes; no dependas de él.
- No importes matplotlib ni uses `circuit.draw('mpl')`: lento en Pyodide y Jhoan dibuja el circuito en JS desde `history`.
- `canonical_key` debe eliminar la fase global **antes** de redondear, o Φ⁺ y −Φ⁺ dan keys distintas y la enumeración se duplica.
- `project()` usa la convención Qiskit para el índice del bit (`idx >> qubit`); la conversión a la convención del juego se hace solo al formatear strings.
- Si en Qollab un `print` de un dict con `np.float64` se ve raro, no es error: es la repr de numpy.

## 5. Qué entregas y cuándo

| Hora | Entrega |
|------|---------|
| H+3 | `docs/findings-qiskit.md` con E1–E2. Decisión: ¿lista en `backend.run` funciona en IonQ? |
| H+4 | `docs/snapshot-example.json` para el mock de Jhoan. |
| H+8 | `engine.py` pasos 1–2 funcionando en Qollab con Jhoan (gates + measure con fallback). |
| H+10 | Pasos 3–4. E5 y E6 reportados para L1–L3. `levels/level1.json`, `level2.json`. |
| H+14 | `levels/level3.json` verificado. Tests en verde. |
| H+18 | Texto técnico de la project page ("How quantum is essential", "One job per run strategy") en inglés, 300 palabras. |

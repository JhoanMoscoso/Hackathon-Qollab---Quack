# Handoff — Juan José (Python / Qiskit)

Eres dueño de `quantum/` y de `levels/*.json`. El contrato con Jhoan está en `docs/03-spec-motor-cuantico.md`; este documento dice **en qué orden probar** y qué anotar. Cada experimento termina con una nota en `docs/findings-qiskit.md` (funciona / no funciona / cómo lo resolviste), porque de esas notas salen las decisiones de arquitectura y el texto técnico de la project page.

**Actualización experimental y de entrega: 2026-10-09.** Juanjo creó el proyecto separado **Q-Quack py**, de tipo Python/Qiskit. Los experimentos se resumen en §6; el contexto detallado está en Engram. **El motor, niveles, snapshot y pruebas locales ya están implementados**; estado de entrega e instrucciones para Jhoan en §7. Los bloques E1–E4 siguen siendo experimentos de `main.py`, no el bootstrap del juego.

## 0. Entorno (30 min)

Local:
```
python -m venv .venv && source .venv/bin/activate
pip install "qiskit>=2.5.2,<3" numpy pytest
```
Qollab: crea **tu propio** proyecto de prueba de tipo **Python / Qiskit** (`main.py`, salida por consola), separado del proyecto JS de Jhoan. `backend` es global y `print` sale en consola. **El runtime observado llama a `main` con tres argumentos posicionales**: los experimentos usan `async def main(*_args)` mientras se confirma la firma exacta de la plantilla. Un bloque que solo define helpers no es un programa completo. Tras validar los experimentos y autorizar implementación, lo probado se lleva a `quantum/engine.py`.

Reglas del runtime que te afectan:
- `backend` lo elige quien presiona Run; nunca lo crees tú.
- IonQ (simuladores remotos y hardware): **un solo `backend.run` por Run**. Local: ilimitado.
- Sin `input()`. Sin escritura persistente. Rutas de archivos propios **como string literal** o no se cargan.
- Qiskit imprime bitstrings con `q0` a la **derecha** (little-endian). El juego usa `q0` a la **izquierda**. Toda salida del motor se convierte.
- Built-in devuelve un job síncrono: `await backend.run(...)` directo falló con `BasicProviderJob`. Usa el adaptador de E2 para esperar solo objetos awaitable; no asumir que todos los backends tienen la misma interfaz.
- Cada prueba remota y cada tamaño de lote se ejecutan en un **Run nuevo**. Si falla un envío, no mandes un circuito alternativo dentro de ese mismo Run.

## 1. Experimentos (en orden, cada uno < 45 min)

### E1 — Orden de bits y estados de Bell (local)
```python
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
def to_game(bits: str) -> str: return bits[::-1]

async def main(*_args):
    qc = QuantumCircuit(2); qc.x(0)
    probs = Statevector(qc).probabilities_dict()
    print("Qiskit:", probs)  # '01': 1.0
    print("Juego:", {to_game(str(bits)): float(p) for bits, p in probs.items()})
    # esperado en el juego: {'10': 1.0}
```
Verifica `Φ⁺ = H(0), CX(0,1)`, `Ψ⁺ = Φ⁺ + X(1)`, `Φ⁻ = Φ⁺ + Z(0)`, `Ψ⁻ = Ψ⁺ + Z(0)`. Escribe `bell_label(sv)` comparando con tolerancia `1e-6` **módulo fase global**.

**Estado: comprobaciones de E1 completadas.** Orden de bits, cuatro Bell, amplitudes/signos, `bell_label` y comparación módulo fase global confirmados en consola. Asserts con `Statevector.equiv(atol=1e-6, rtol=0)` pasaron para los estados originales y fases globales −1 y exp(iπ/3); |00⟩ fue rechazado como no Bell. Esto valida el experimento, no un motor implementado. Los counts de E2 por sí solos no distinguen Φ⁺ de Φ⁻.

### E2 — Lista de circuitos en un solo `backend.run` (Qollab: built-in, luego IonQ Forte 1 remote)
```python
import inspect
from qiskit import QuantumCircuit

async def resolve(value):
    return await value if inspect.isawaitable(value) else value

async def main(*_args):
    circs = []
    for k in range(3):
        qc = QuantumCircuit(2, 2); qc.h(0); qc.cx(0, 1)
        if k == 1: qc.x(1)
        if k == 2: qc.z(0)
        qc.measure([0, 1], [0, 1]); circs.append(qc)
    job = await resolve(backend.run(circs, shots=200))
    res = await resolve(job.result())
    for i in range(3): print(i, res.get_counts(i))
    print(str(backend))
```
Anota: ¿acepta lista? ¿`get_counts(i)` funciona? ¿Cuánto tarda en IonQ con 3, 30 y 60 circuitos a 200 shots? Solo probar 30/60 después de validar 3; cada tamaño en un Run independiente. **Si la lista no funciona, no enviar una segunda vez:** el escape individual + fallback fue validado; la entrega actual implementa además el pack de pares en un circuito pedido por Jhoan en `08-level-design-constraints.md` (ver §7). No generalizar un fallo de Aria a Forte ni confirmar batch a partir de un circuito individual.

Para diagnosticar **un circuito individual**, reemplaza el bloque desde `job = ...` hasta la última impresión por:
```python
    job = await resolve(backend.run(circs[0], shots=200))
    res = await resolve(job.result())
    print(res.get_counts())
    print(str(backend))
```
**No conserves el bucle de tres `get_counts(i)`**: solo existe un resultado. Ese bucle produjo un error de índice después de un envío individual exitoso.

**Estado: decisión de compatibilidad registrada para el entorno observado.** Lote de tres y lectura por índice confirmados en built-in. Lote de tres rechazado en Aria con HTTP 400 `Only job type ionq.circuit.v1 is supported`. Circuito individual confirmado en Forte. Juanjo reportó el mismo HTTP 400 para el lote de tres y después **confirmó explícitamente que usó Forte**; falta el tiempo de esa ejecución. **No medir 30/60 mientras el lote de tres esté rechazado.** La estrategia propuesta del handoff pasa a un circuito individual remoto y muestreo Qiskit local para los restantes; no es implementación ni afirmación sobre todos los entornos IonQ.

### E3 — Statevector como fuente de verdad (local)
- `Statevector(qc)`, `sv.evolve(gate_circuit)`, `sv.probabilities_dict()`.
- Proyección por medición parcial con numpy (no uses `sv.measure()` porque es aleatoria; tú decides el resultado con el shot):
```python
import numpy as np
def project(sv_data, qubit, outcome, n):
    v = sv_data.copy()
    for idx in range(len(v)):
        if ((idx >> qubit) & 1) != outcome: v[idx] = 0   # idx bit `qubit` en convención Qiskit
    norm = np.linalg.norm(v); return v / norm if norm > 1e-12 else None
```
- Detección de entrelazamiento: `from qiskit.quantum_info import partial_trace, entropy`; `entropy(partial_trace(sv, [1])) > 1e-6`.
- Ket legible: función propia que recorre amplitudes no nulas y arma `"0.707|00⟩ + 0.707|11⟩"` (con bits en convención del juego, signo `-` cuando la parte real es negativa, `i` cuando es imaginaria).

`project` es un helper: para ejecutarlo en Qollab agrega los imports `QuantumCircuit`/`Statevector` de E1 y un `async def main(*_args)` que construya Φ⁺, proyecte q0 a 0/1 y compruebe la norma. No necesita `backend.run`: elige built-in para estas pruebas locales.

**Estado: comprobaciones experimentales de E3 completadas.** Proyección Φ⁺ sobre q0 verificada: resultado 0 → `{'00': 1.0}`, resultado 1 → `{'11': 1.0}` en convención del juego; asserts de normalización pasaron. También se verificaron `evolve` y entrelazamiento: entropía reducida inicial 1 bit y posterior 0 en ambas ramas; Alice=0 sin gate → |00⟩, Alice=1 con X(q1) → |10⟩, con probabilidad 1. La prueba adicional pasó ket real positivo/negativo e imaginario, proyección q1 Bell, estado producto y ramas imposibles (`None`). Esto no valida reglas de motor: los scripts no mantienen `measured`, terminales o presupuesto, ni implementan el motor.

**Advertencia empírica:** los counts de Forte individual incluyeron bitstrings fuera del soporte ideal de Φ⁺. Antes de proyectar un resultado muestreado, verifica que tenga probabilidad ideal no nula; si no, la proyección no es válida. El diseño de filtrado/fallback y la separación entre probabilidades ideales y empíricas debe acordarse antes del motor; no está resuelto por este experimento.

### E4 — Preparar estados post-medición en un circuito real (Qollab built-in e IonQ)
Las ramas post-medición necesitan un circuito que prepare ese estado para medirlo en `backend.run`. Prueba `qc.initialize(vector)` y `StatePreparation` (`qiskit.circuit.library`). Si `initialize` falla en IonQ por el `reset`, prueba `StatePreparation` sin reset. Si ambos fallan: esas ramas se muestrean con `Statevector.sample_counts` (sigue siendo Qiskit) y se marca `"source": "statevector_fallback"` en el snapshot.

**Estado: compatibilidad básica verificada para los casos probados; cobertura general pendiente.** `initialize` del producto Qiskit |01⟩ / juego |10⟩ pasó en built-in con 200 shots ideales. En Forte, `transpile(qc, backend)` conservó dos `reset` y el traductor SDK rechazó el circuito con `IonQGateError: gate 'reset' is not supported on the 'qis' IonQ backends`; no se obtuvieron counts. La alternativa `StatePreparation` sin reset ya pasó en ambos backends para el producto computacional y un producto superpuesto con signo relativo. Prepara sobre un circuito nuevo desde |0…0⟩; no agregues `StatePreparation` al circuito previo suponiendo que resetea ni elimines resets arbitrariamente.

**Validación básica de E4 cerrada:** producto computacional y producto superpuesto con signo se prepararon sin reset en built-in y Forte. La prueba adicional `StatePreparation([s,-s,0,0])` seguida de H(q0) también pasó: ambos backends devolvieron Qiskit `{'01':200}` / juego `{'10':200}`, con 5.5 s UI built-in y 16.4 s Forte. La equivalencia ideal y ausencia de reset se comprobaron antes del envío. La transpilación puede simplificar la secuencia: esto valida su comportamiento compuesto, no demuestra conservación física de cada gate ni preparación universal. No agregar pruebas E4 indefinidamente; validar recetas de cada estado del catálogo durante E5/precompute, cuando se autorice implementación.

### E5 — Enumeración de estados alcanzables (local)
Implementa `quantum/enumerate.py` según la spec: BFS con dedupe por `canonical_key`. Mide el tamaño del conjunto para cada nivel (abajo). Objetivo: ≤ 60 estados por nivel. Si L3 con `max_gates=5` supera 60, baja a 4.

### E6 — Verificador de niveles (local, el más importante)
Para cada etapa: búsqueda exhaustiva de secuencias y **políticas condicionadas al resultado de medición** hasta `max_gates`, respetando qubits medidos y recursos; reporte de:
- ¿existe una estrategia con probabilidad de victoria = 1.0 por intento? Debe existir salvo **L1 etapa 1**: sin compuertas, su óptimo es 0.5 por intento. Reiniciar no convierte esa etapa en una solución determinista de un solo intento.
- ¿cuál es la probabilidad de victoria midiendo a ciegas sin compuertas? (L1 etapa 1: 0.5; L1 etapa 2: 1.0; L2 etapa 1: 0.0; L2 etapa 2: 0.5; L3: 0.0)
- lista de todas las soluciones mínimas (para el narrador y el README).

Para precompute se deduplican vectores por `canonical_key`; para verificar acciones legales también cuentan mediciones explícitas, gates restantes y usos de terminal. Un mismo vector con diferentes recursos no es el mismo nodo lógico. **E5/E6 ejecutados localmente** sobre las cinco etapas implementadas; resultados en §7. La verificación es cuántica/con recursos, no sustituye el walkthrough espacial en JS.

### E7 — Rendimiento del puente JS↔Python (proyecto JS junto con Jhoan, H+4)
Mide con `performance.now()` en JS el coste de `apply_gate` y `measure`. Objetivo < 20 ms. Si `Statevector` de 3 qubits tarda más, cachea por `state_key`.

## 2. Definición de los niveles (para E5/E6 y para `levels/*.json`)

Convención: `q0` = Alice, `q1` = Bob. Objetos: `open_on` = valor que lo deja pasar; `lethal` = pisarlo en el otro valor mata.

### L1 — Calibration (Lab). Sin compuertas. Dos etapas, el registro se re-prepara entre ellas.
- Etapa 1 "Independent lock": `initial_circuit = [["h",0],["h",1]]`. Puertas `door_A(q0)`, `door_B(q1)`, ambas `open_on: 0`. Cerradura de paridad: la salida se abre si los dos resultados **coinciden** (`win: {"parity": "equal"}`). Medidos a ciegas: p = 0.5. Fallo = "lock jams", reinicio de etapa (sin muerte).
- Etapa 2 "Entangled lock": `initial_circuit = [["h",0],["cx",0,1]]` (Φ⁺). Misma cerradura. p = 1.0 siempre.

**Ajuste implementado explícitamente en `levels/level1.json`:** `door_A/B` son indicadores no bloqueantes; `joint_lock` sigue el objetivo de paridad y permite las dos ramas 00/11. JS debe respetar `blocking: false` y exigir `objective.quantum_ready` para las salidas. Queda revisar esta representación y el recorrido con Jhoan; la garantía cuántica no demuestra el walkthrough espacial.

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

**Contrato implementado v2, pendiente de integración con Jhoan:** niveles con `stages[]`, `reset_stage`/`advance_stage`, usos de terminales y `required_measurements`. `apply_gate(gate,q,target)` se conserva y resuelve/consume automáticamente un terminal compatible; acepta `terminal_id`/`actor` opcionales. La prueba 6 usa fixture genérico, no L1 sin gates. `precompute` cubre la campaña y es idempotente durante el Run: default `packed`, diez pares en un único circuito según el nuevo documento del equipo; `single` es el escape Bell + fallback, `batch` opt-in para el built-in compatible. Nunca reenvía tras error ni al cambiar/reiniciar niveles.

## 4. Trampas conocidas

- Devuelve siempre `json.dumps(...)`. Los `complex` de numpy no son serializables: conviértelos a `[re, im]` y redondea a 6 decimales. Los `np.float64` conviértelos a `float`.
- Desde JS todo se llama con `callPromising`; las funciones de integración backend pueden ser `async def`, pero esperan `backend.run`/`job.result` **solo si son awaitable**, como E2. `callPromising` no garantiza que el job subyacente sea async.
- `Statevector.sample_counts(shots, qargs=None)` no recibe un keyword `seed` en la [API oficial consultada](https://quantum.cloud.ibm.com/docs/en/api/qiskit/qiskit.quantum_info.Statevector). Para tests reproducibles usa `sv.seed(value)`; no redondees el vector antes de calcular/proyectar.
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

H+n significa n horas desde el arranque: son metas originales, no entregas ya cumplidas. El ejemplo de snapshot puede acordarse con Jhoan sin esperar a los benchmarks IonQ.

## 6. Evidencia acumulada y siguiente paso

Fuente: salidas de consola/capturas compartidas por Juanjo el 2026-10-09; proyecto **Q-Quack py**. Tiempos son los mostrados por la UI, incluyen runtime y **no aíslan** `backend.run` ni la proyección. Versiones exactas y IDs de Runs todavía no registrados. Engram conserva el detalle; esta tabla es el resumen compartido, sin crear otra bitácora Markdown por ahora.

| Prueba | Backend / nº circuitos enviados | Resultado | Tiempo UI |
|---|---|---|---|
| E1 orden de bits | Cálculo local Statevector | X(q0): Qiskit `01`, juego `10`, probabilidad 1. | No registrado |
| E1 cuatro Bell y fase global | Built-in seleccionado, cálculo local sin envío | Φ⁺: 00/11 positivos; Ψ⁺: 10/01 positivos; Φ⁻: 00 positivo, 11 negativo; Ψ⁻: 10 negativo, 01 positivo. Módulos 0.707107. Labels correctos, fases globales −1 y exp(iπ/3) aceptadas; estado 00 no Bell. `E1 Bell + fase global: OK`. | 3.8 s |
| E2 lote 3 | Built-in (24q), BasicSimulator / 3 | 0: `{'00':108,'11':92}`; 1: `{'01':98,'10':102}`; 2: `{'11':102,'00':98}`. `get_counts(0/1/2)` funciona; 200 shots cada uno. | 3.2 s |
| E2 lote 3 | IonQ Aria 1 simulator (25q) / intento de 3 | HTTP 400: `Only job type ionq.circuit.v1 is supported`. Sin counts. Causa exacta de integración no confirmada. | 5.1 s |
| E2 individual, primera ejecución | IonQ Forte 1 simulator (29q) / 1 | `{'00':93,'10':1,'11':106}`. Resultado recibido; después falló un bucle residual al buscar experimento 1. | 16.7 s |
| E2 individual, ejecución corregida | IonQ Forte 1 simulator (29q) / 1 | `{'00':90,'01':1,'10':2,'11':107}`, 200 shots, sin error. | 17.1 s |
| E2 lote 3 en Forte | Forte confirmado explícitamente por Juanjo / intento de 3 | HTTP 400: `Only job type ionq.circuit.v1 is supported`, durante envío; sin counts. | No registrado |
| E3 proyección q0 de Φ⁺ | Built-in seleccionado, cálculo local sin envío | Alice=0 → `{'00':1.0}`; Alice=1 → `{'11':1.0}`. Normalización validada en ambas ramas. | 4.0 s |
| E3 entrelazamiento y feed-forward | Built-in seleccionado, cálculo local sin envío | Entropía inicial 1, posterior 0 en ambas ramas. Alice=0 sin corrección → `{'00':1.0}`; Alice=1 con `evolve` X(q1) → `{'10':1.0}`. Asserts pasaron; `E3 entrelazamiento + feed-forward: OK`. | 4.3 s |
| E3 ket y proyecciones adicionales | Built-in seleccionado, cálculo local sin envío | Ket Φ⁺/Φ⁻/amplitud imaginaria correcto; Bob=0 → 00, Bob=1 → 11 normalizados; producto 10 del juego y ramas imposibles `None` validados. `E3 ket + proyección Bob + producto: OK`. | 4.0 s |
| E4 initialize producto | Built-in (24q), BasicSimulator / 1 | Target Qiskit 01: preparación ideal OK, ops `reset:2,u2:2,measure:2,cx:1`. Counts Qiskit `{'01':200}`, juego `{'10':200}`. | 4.1 s |
| E4 initialize producto | IonQ Forte 1 simulator (29q) / intento de 1 | Preparación ideal OK, ops `reset:2,measure:2,ry:1,rz:1,cx:1,rx:1`. Rechazo por `reset` en traductor SDK QIS, sin counts. | 4.5 s |
| E4 StatePreparation producto | Built-in (24q), BasicSimulator / 1 | Preparación ideal OK; ops `u2:2,measure:2,cx:1`, sin reset. Counts Qiskit `{'01':200}`, juego `{'10':200}`, sin error. | 3.9 s |
| E4 StatePreparation producto | IonQ Forte 1 simulator (29q) / 1 | Preparación ideal OK; ops `measure:2,ry:1,rz:1,cx:1,rx:1`, sin reset. Counts Qiskit `{'01':200}`, juego `{'10':200}`; `E4 StatePreparation: resultado recibido`, sin error. | 16.6 s |
| E4 StatePreparation superposición | Built-in (24q), BasicSimulator / 1 | Target `[s,-s,0,0]`, ideal juego 00/10=0.5 cada uno; equivalencia y signo local OK. Ops `u2:2,measure:2,cx:1`, sin reset. Counts Qiskit `{'00':106,'01':94}`, juego `{'00':106,'10':94}`; 200 shots, sin error. | 3.3 s |
| E4 StatePreparation superposición | IonQ Forte 1 simulator (29q) / 1 | Mismo target, equivalencia y signo local OK. Ops `measure:2,ry:1,rz:1,cx:1,p:1,sx:1`, sin reset. Counts Qiskit `{'00':109,'01':91}`, juego `{'00':109,'10':91}`; 200 shots, sin error. | 16.7 s |
| E4 StatePreparation + H, interferencia | Built-in (24q), BasicSimulator / 1 | Ideal Qiskit 01 / juego 10 equivalente; ops `u2:2,measure:2,cx:1`, sin reset. Counts Qiskit `{'01':200}`, juego `{'10':200}`; sin error. | 5.5 s |
| E4 StatePreparation + H, interferencia | IonQ Forte 1 simulator (29q) / 1 | Ideal equivalente; ops `rz:2,measure:2,ry:1,cx:1,rx:1`, sin reset. Counts Qiskit `{'01':200}`, juego `{'10':200}`; sin error. | 16.4 s |

En la segunda ejecución individual de Forte, 3/200 shots (1.5 %) quedaron fuera del soporte ideal {00,11}; en la primera fue 1/200 (0.5 %). Son desviaciones observadas en **simulador**; no una tasa total de ruido, evidencia de hardware real ni prueba de la causa. Los counts permanecen en convención Qiskit; la prueba E3 sí formatea sus etiquetas en convención del juego.

### Estado de los experimentos y transición a la entrega

1. **Comunicar resultado E2 a Jhoan:** el lote de tres en Forte fue rechazado como Aria, mientras el individual de Forte funciona. Proponer un circuito remoto + `Statevector.sample_counts` para los demás, con fuente explícita. No probar 30/60 ni reenviar individual dentro del Run fallido.
2. **E1 completado:** conservar evidencia de amplitudes, labels, fase global y no Bell; no hace falta repetirlo para avanzar a E3.
3. **E3 completado experimentalmente:** proyección q0/q1, producto/ramas imposibles, `evolve`, entropía y ket con signos/imaginarios ya pasaron. Avanzar a E4; no es necesario repetir estas pruebas ni interpretarlas como reglas de gameplay implementadas.
4. **Snapshot entregado:** `docs/snapshot-example.json` reproduce el resultado real de `new_session("level2")` y tiene test de igualdad contra la API. Jhoan puede construir su mock y adaptar el render a etapas/fuentes v2.
5. **Motor y E5/E6 implementados:** después de autorización explícita de Juanjo. Validación de todas las recetas del catálogo pasó localmente; E7 y el bootstrap completo en Qollab/JS permanecen pendientes. No hace falta seguir repitiendo E4 básico.

**Balance:** E1/E3 y E4 básico completados experimentalmente; E2 fundamenta el modo individual + fallback, con benchmarks 30/60 bloqueados/no realizados; E5/E6 ejecutados localmente; E7 pendiente. No confundir E1–E4 del handoff con Fases 1–4 del plan: el exit gate F0 exige canvas + counts vía puente JS/Python y sigue pendiente de demostrar en el juego.

## 7. Entrega implementada para Jhoan

Rama: `feat/juanjo-quantum-engine`, actualizada con `origin/main` incluyendo assets/OGG de Fernanda y `08-level-design-constraints.md` de Jhoan. Este commit entrega Python/niveles/docs; no implementa el esqueleto JS ni modifica los assets de Fernanda. Mapas MVP marcados `requires_js_walkthrough`; budgets L2 de una gate y representación L1 conjunta son decisiones explícitas, revisables en integración. L2/opposites y L3 tienen más de diez entidades físicas si se cuentan todas las placas/terminales/salidas: queda alinear ese presupuesto con Jhoan, sin ocultarlo ni quitar gates esenciales.

### Archivos y API

- `quantum/engine.py`: fachada JSON, sesión única, snapshots, gates/medición/reset/etapas. Exporta `load_level`, `new_session`, `precompute`, `apply_gate`, `measure`, `reset_level`, `reset_stage`, `advance_stage`, `snapshot`, `load_audio`.
- `quantum/state.py`: física ideal, proyección, Bell, entropía reducida, orden de amplitudes, canonicalización y recetas `StatePreparation` sin reset.
- `quantum/rules.py`: transiciones puras, medición explícita, gate budget y terminales. Reusado por gameplay, BFS y verificador.
- `quantum/sampling.py`: counts empíricos, fuente efectiva, filtro de resultados imposibles, envío global único y fallback Qiskit. `precompute` comparte una tarea para llamadas concurrentes; no retry remoto.
- `quantum/enumerate.py`, `quantum/verify.py`: catálogo BFS y verificación exacta de políticas adaptativas con DAG de soluciones mínimas bajo la métrica gates en peor rama, luego mediciones.
- `levels/level1.json`–`level3.json`: cinco etapas, schema v2, mapas 20×12 y columnas centrales 9–10 bloqueadas. Celdas `[fila,columna]` base 0, terminales con IDs, CX control/target. Narración inglesa máximo dos líneas de cuarenta caracteres; `glitch` es informativo, no implementa la regla de reset propuesta por el equipo.
- `docs/snapshot-example.json`: snapshot real de L2/opposites antes de precompute, no un resultado de backend inventado.
- `quantum/tests/`: física, API, etapas, assets, sampling, errores/concurrencia y verificación. `requirements-dev.txt` y `pytest.ini` para entorno local.

### Integración mínima en el proyecto Python de Qollab

Subir `quantum/*.py` y los tres `levels/*.json` junto a `main.py`. Mantener estas rutas literales; no subir `.venv`, caches ni tests al runtime. Este probe hace **un solo envío**; no combinarlo con el antiguo hello remoto en el mismo Run:

```python
from quantum import engine

async def main(*_args):
    print(await engine.load_level("level2"))
    print(engine.new_session("level2"))
    print(await engine.precompute(backend, shots=200))  # packed por defecto, un circuito
    print(engine.apply_gate("x", 1))
    print(engine.measure(0))
    print(engine.measure(1))
```

En JS: usar `callPromising`, parsear cada string JSON y serializar eventos; `load_level` devuelve el nivel entero con `stages[]`. Posiciones, simultaneidad CX y ambas salidas son responsabilidad JS. `advance_stage` solo chequea objetivo cuántico: llamarlo después de que ambos jugadores estén en salidas. `reset_stage` conserva avance de nivel; `reset_level` vuelve a la primera etapa. Ambos conservan precompute.

Snapshots v2 separan `initial_circuit` de `history` (acciones únicamente). `amplitudes` van en orden lexicográfico del juego 00,01,10,11. Una medición repetida es idempotente. `source`/`sampling` describen el estado actual; `last_measurement.source` informa lo realmente usado. Counts crudos del backend y probabilidades ideales se mantienen separados. El filtro evita proyecciones imposibles, pero condiciona ruido: no simula una trayectoria física ruidosa completa.

`load_audio` devuelve JSON/base64 con mime o `AUDIO_UNAVAILABLE`; el OGG provisional de Fernanda ya está en `audio/soundtrack.ogg` tras incorporar sus commits. No se inventó ni alteró música. Reproducirlo requiere gesto del usuario en JS. GHZ fuera de alcance.

### Pack global vigente (nuevo contrato del equipo)

Diez pares prioritarios: |++⟩, Φ⁺, los cuatro estados computacionales, Ψ⁺, Φ⁻, |+⟩Alice|0⟩Bob y |−⟩Alice|0⟩Bob. Cubren inicios, las ramas de victoria y soluciones canónicas; otros once estados del catálogo quedan con fuente local explícita. En Forte (29 qubits) se usan veinte, debajo del máximo catorce pares. Backend con capacidad menor reduce el pack, no fuerza veinte qubits. `packed_manifest` vincula cada state_key con sus qubits/bits clásicos y el resultado conjunto se marginaliza por par.

**Evidencia:** pack de diez pares probado con BasicSimulator local en un único envío; **no** probado todavía por Juanjo en Forte. El documento de Jhoan registra su prueba de dieciséis qubits; eso no se presenta como prueba de este pack de veinte. Si este envío falla, el motor continúa local sin segundo job. `strategy="single"` solo puede elegirse antes del primer precompute, en un nuevo Run; no es un reintento automático.

### E5/E6 local — resultado reproducible

Entorno probado: Python 3.14.7, Qiskit 2.5.2, numpy 2.3.5. No son necesariamente las versiones exactas del runtime Qollab; registrarlas en el probe final si difieren.

| Etapa | Estados físicos | Nodos lógicos | P a ciegas | P óptima por intento | Gates mínimas, peor rama |
|---|---|---|---|---|---|
| L1 independent | 9 | 9 | 0.5 | 0.5 | 0 |
| L1 entangled | 3 | 7 | 1 | 1 | 0 |
| L2 opposites | 6 | 14 | 0 | 1 | 1 |
| L2 feed-forward | 6 | 14 | 0.5 | 1 | 1 |
| L3 core | 20 | 245 | 0 | 1 | 3 |

Unión de campaña: **21 estados físicos**. L3 sin CX alcanza como máximo **0.5**, por tanto no tiene política determinista bajo estas reglas y presupuesto. El verificador incluye la solución canónica CX,Z,H y sus alternativas mínimas; feed-forward requiere una política condicionada, no una lista fija. Todas las recetas del catálogo se comprobaron localmente equivalentes y sin reset. Esto no sustituye test remoto del lote (no soportado) ni walkthrough espacial.

Desde la raíz del repo, después de instalar `requirements-dev.txt` en un virtualenv:
```bash
python -m pytest -q
python -m quantum.verify
```
El CLI devuelve JSON con métricas y DAG de soluciones y un exit code no cero si fallan los objetivos esperados. Test de precompute ejecuta campaña completa en BasicSimulator local y confirma idempotencia incluso con resets/cambio de nivel. Backends fake sync/async cubren fallo de envío/resultado/counts inválidos sin segundo envío.

Validación final de entrega local: **111 tests pasaron**, sin skips; CLI `quantum.verify` terminó con exit code 0; el loader leyó el OGG de Fernanda como JSON/base64. Revisión independiente del motor y del pack no dejó bloqueantes; se corrigió un error de validación de terminales malformados con regresión. Estos tests no sustituyen E7 ni el walkthrough en Qollab.

### Lo que sigue, sin mezclar entrega con fase completada

1. Jhoan consume snapshot v2 y prueba el probe anterior en built-in y Forte; registrar resultados de **esta implementación**, no reutilizar evidencia de scripts previos como si fuera integración.
2. En proyecto JS, validar `callPromising`, stage/reset, cola de acciones, terminales/CX, salidas y recorrido de los mapas. Esto cierra el trabajo F0/F1 según exit gates del MD 01.
3. E7: medir puente JS↔Python; no hay aún benchmark <20 ms ni garantía 60 fps.
4. Probar un IBM noise model si disponible y revisar cómo se presenta mezcla/fallback/filtrado. El modo por defecto es conservador para cualquier backend; batch es opt-in solo en los compatibles.

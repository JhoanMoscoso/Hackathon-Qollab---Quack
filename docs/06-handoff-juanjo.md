# Handoff — Juan José (Python / Qiskit)

Eres dueño de `quantum/` y de `levels/*.json`. El contrato con Jhoan está en `docs/03-spec-motor-cuantico.md`; este documento dice **en qué orden probar** y qué anotar. Cada experimento termina con una nota en `docs/findings-qiskit.md` (funciona / no funciona / cómo lo resolviste), porque de esas notas salen las decisiones de arquitectura y el texto técnico de la project page.

**Actualización experimental y de entrega: 2026-10-09.** Juanjo creó el proyecto separado **Q-Quack py**, de tipo Python/Qiskit. Los experimentos se resumen en §6; el contexto detallado está en Engram. **El motor, niveles, snapshot y pruebas locales ya están implementados**; estado de entrega e instrucciones para Jhoan en §7. Los bloques E1–E4 siguen siendo experimentos de `main.py`, no el bootstrap del juego.

**Revisión de L1 del 2026-10-10:** reemplaza las dos etapas automáticas por construcción de Bell desde |00⟩ + RUN CIRCUIT + medición + puertas físicas. PR #5 integrado en main; **Juanjo validó el protocolo nuevo en Qollab built-in y Forte**, incluyendo 11 que abre ambas puertas y reset que las cierra. Evidencia §9. Foco/movimiento del diagnóstico también confirmados; el walkthrough/UI del juego completo sigue pendiente.

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
Anota: ¿acepta lista? ¿`get_counts(i)` funciona? ¿Cuánto tarda en IonQ con 3, 30 y 60 circuitos a 200 shots? Solo probar 30/60 después de validar 3; cada tamaño en un Run independiente. **Si la lista no funciona, no enviar una segunda vez:** el escape individual + fallback fue validado; la entrega actual implementa además el pack de pares en un circuito pedido por Jhoan en `07-level-design-constraints.md` (ver §7). No generalizar un fallo de Aria a Forte ni confirmar batch a partir de un circuito individual.

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
- ¿existe estrategia de victoria = 1.0 por intento? En el nuevo L1 sí: H→CX→RUN→medir ambos. La antigua excepción L1/independent=0.5 es histórica, ya no una etapa actual.
- ¿probabilidad de victoria midiendo a ciegas sin gates? Nuevo L1: 0 porque la medición sin validación está bloqueada; no porque |00⟩ tenga resultados aleatorios. L2 etapas: 0.0/0.5; L3: 0.0.
- lista de todas las soluciones mínimas (para el narrador y el README).

Para precompute se deduplican vectores por `canonical_key`; nodos lógicos también consideran observaciones, recursos y ahora historial/prueba de validación. Φ⁺ preparado y Φ⁺ validado comparten vector, pero no acciones legales. E5/E6 local se ejecutó para las cuatro etapas actuales; ver §7 y §9. No sustituye walkthrough espacial.

### E7 — Rendimiento del puente JS↔Python (proyecto JS junto con Jhoan, H+4)
Mide con `performance.now()` en JS el coste de `apply_gate` y `measure`. Objetivo < 20 ms. Si `Statevector` de 3 qubits tarda más, cachea por `state_key`.

**Estado: validado para el caso de dos qubits medido.** Juanjo ejecutó `Q-Quack bridge test` en built-in y Forte; ambos reportaron `target_20ms_met: true`. p95: X de Bob 1.20 ms en ambos, medir Alice 1.50 ms built-in / 1.40 ms Forte. Tres warm-ups, veinte muestras por operación, llamada JS→Python→JSON sin render y sin precompute. Resultados completos y límites en §8. No hace falta agregar optimizaciones de caché por este resultado; GHZ/tres qubits no se midió.

## 2. Definición de los niveles (para E5/E6 y para `levels/*.json`)

Convención: `q0` = Alice, `q1` = Bob. Objetos: `open_on` = valor que lo deja pasar; `lethal` = pisarlo en el otro valor mata.

### L1 — Calibration Chamber. Una etapa: construir, ejecutar, medir y escapar.
- Inicio: `initial_circuit: []` → |00⟩, historial vacío, dos puertas físicas cerradas. La coincidencia 00 por sí sola no autoriza victoria.
- Alice dispone de H(q0), Bob de CX(0,1); una vez cada terminal y max_gates=2. Bob activa la operación del par, no una gate local sobre q1; L3 conserva CX compartida con ambas placas.
- Secuencia exigida: H(q0)→CX(q0,q1), seguido de `run_circuit()` que comprueba orden y Φ⁺ módulo fase global. No es otra llamada a backend.run.
- Medir antes de validación se rechaza sin consumir muestreo ni mutar sesión. RUN válido congela el circuito pero no abre puertas.
- Medir ambos en Z produce idealmente 00/11. Solo después de ambas medidas coincidentes se abren las dos `validated_exit`, independientemente del valor local 0/1. Reset quita prueba/historial/observaciones y vuelve a cerrar.
- UI usa `measurement_enabled`, `door_states` y `exits_unlocked`; llegar a ambas salidas sigue siendo requisito espacial. No usar `objects="0"` como equivalente de puerta abierta.

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

Fuente: salidas de consola/capturas compartidas por Juanjo el 2026-10-09 y reportes E7 del 2026-10-10; proyectos **Q-Quack py** y **Q-Quack bridge test**. Los tiempos UI incluyen runtime y **no aíslan** `backend.run` ni la proyección; E7 tiene mediciones separadas en §8. Versiones exactas del runtime e IDs de Runs todavía no registrados. Engram conserva el detalle; este archivo es el resumen compartido, sin crear otra bitácora Markdown.

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
| Motor completo + pack 20 qubits | Qollab built-in (24q) / 1 | 21 estados, diez pares enviados, diez con fuente backend, `mixed`, sin error. L2/opposites: X de Bob → Ψ⁺, Alice=0/Bob=1, ambas medidas desde backend, objetivo ready, reset OK y `PRUEBA DEL MOTOR: OK`. | 18.7 s |
| Motor completo + pack 20 qubits | Qollab IonQ Forte 1 simulator (29q) / 1 | Mismo resumen y fuente; Alice=1/Bob=0, objetivo ready, reset OK y prueba final OK. Plataforma imprime `Circuit execution time: 1000ms`; no equivale al tiempo total ni al puente JS. | 21.3 s |

En la segunda ejecución individual de Forte, 3/200 shots (1.5 %) quedaron fuera del soporte ideal {00,11}; en la primera fue 1/200 (0.5 %). Son desviaciones observadas en **simulador**; no una tasa total de ruido, evidencia de hardware real ni prueba de la causa. Los counts permanecen en convención Qiskit; la prueba E3 sí formatea sus etiquetas en convención del juego.

### Estado de los experimentos y transición a la entrega

1. **Comunicar resultado E2 a Jhoan:** el lote de tres en Forte fue rechazado como Aria, mientras el individual de Forte funciona. Proponer un circuito remoto + `Statevector.sample_counts` para los demás, con fuente explícita. No probar 30/60 ni reenviar individual dentro del Run fallido.
2. **E1 completado:** conservar evidencia de amplitudes, labels, fase global y no Bell; no hace falta repetirlo para avanzar a E3.
3. **E3 completado experimentalmente:** proyección q0/q1, producto/ramas imposibles, `evolve`, entropía y ket con signos/imaginarios ya pasaron. Avanzar a E4; no es necesario repetir estas pruebas ni interpretarlas como reglas de gameplay implementadas.
4. **Snapshot entregado:** `docs/snapshot-example.json` reproduce el resultado real de `new_session("level2")` y tiene test de igualdad contra la API. Jhoan puede construir su mock y adaptar el render a etapas/fuentes v2.
5. **Motor y E5/E6 implementados:** validación de recetas del catálogo pasó localmente. Motor real pasó en Qollab Python y el diagnóstico JS/E7 también pasó en ambos backends. Sigue pendiente adaptar y recorrer el frontend del juego; no repetir E4 básico ni E7 sin una regresión o cambio de escenario.

**Balance:** E1/E3/E4 básico y E7 validados en escenarios previos; E5/E6 actualizados al nuevo L1. Su pack y protocolo completo ahora pasaron en Qollab Python en ambos backends, además de movimiento/foco del diagnóstico JS. Falta adaptar/recorrer el juego con Jhoan, no repetir las pruebas de consola. F0 básico no valida automáticamente F1/F2/F3.

## 7. Entrega implementada para Jhoan

Rama: `feat/juanjo-quantum-engine`, actualizada con `origin/main` incluyendo assets/OGG de Fernanda y `07-level-design-constraints.md` de Jhoan (renombrado desde 08). La entrega de Juanjo agrega Python/niveles/docs; el frontend JS incorporado viene de Jhoan. Mapas MVP marcados `requires_js_walkthrough`; budgets L2 de una gate y representación L1 conjunta son decisiones explícitas, revisables en integración. L2/opposites y L3 tienen más de diez entidades físicas si se cuentan todas las placas/terminales/salidas: queda alinear ese presupuesto con Jhoan, sin ocultarlo ni quitar gates esenciales.

### Archivos y API

- `quantum/engine.py`: fachada JSON, sesión única, snapshots, gates/medición/reset/etapas. Exporta `load_level`, `new_session`, `precompute`, `apply_gate`, `measure`, `reset_level`, `reset_stage`, `advance_stage`, `snapshot`, `load_audio`.
- `quantum/state.py`: física ideal, proyección, Bell, entropía reducida, orden de amplitudes, canonicalización y recetas `StatePreparation` sin reset.
- `quantum/rules.py`: transiciones puras, medición explícita, gate budget y terminales. Reusado por gameplay, BFS y verificador.
- `quantum/sampling.py`: counts empíricos, fuente efectiva, filtro de resultados imposibles, envío global único y fallback Qiskit. `precompute` comparte una tarea para llamadas concurrentes; no retry remoto.
- `quantum/enumerate.py`, `quantum/verify.py`: catálogo BFS y verificación exacta de políticas adaptativas con DAG de soluciones mínimas bajo la métrica gates en peor rama, luego mediciones.
- `levels/level1.json`–`level3.json`: cuatro etapas actuales (nuevo L1 una, L2 dos, L3 una), schema v2, mapas 20×12 y columnas centrales 9–10 bloqueadas. Coordenadas `[fila,columna]`. L1 usa CX de Bob; L3 compartida. Narración máximo dos líneas de cuarenta caracteres; ruido/glitch no introduce reset automático.
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

**La lista anterior describe el pack histórico.** Nuevo L1 elimina |++⟩ y el catálogo pasa de 21 a 20; prioridades actuales: cuatro computacionales, cuatro Bell (se agrega Ψ⁻), |+0⟩ y |−0⟩. Diez pares/veinte qubits y diez estados locales. El manifest nuevo pasó localmente y en el proyecto Q-Quack L1 protocol en ambos backends; sus reportes de §9 son evidencia nueva, no reinterpretación de los antiguos.

**Evidencia actual:** pack de diez pares probado localmente y **con el motor completo en Qollab Python**, en built-in y Forte. Ambos devolvieron `states:21,circuits:1,strategy:packed,submitted_states:10,backend_states:10,source:mixed,submission_attempted:true,reason:null`, con 200 shots. Gates/medición de L2/opposites y reset pasaron; ambas medidas usaron fuente backend. Esto sustituye la duda de compatibilidad de veinte qubits, no demuestra aún JS/canvas/1P/2P ni las otras etapas jugadas. Si el envío falla, el motor continúa local sin segundo job. `single` solo se elige antes del primer precompute en un nuevo Run.

El panel de probabilidades de veinte bits es el resultado **conjunto de los diez pares independientes**: el motor extrae cada par mediante `packed_manifest`. No son veinte personajes, un nivel de veinte qubits ni una distribución de dos qubits mal formateada. `mixed` significa diez estados de backend y once locales; no un error. Los tiempos UI incluyen carga/runtime/espera; no sirven para E7. No calcular una tasa de ruido global a partir de esos listados sin separar soporte/marginales por estado.

### E5/E6 local — resultado reproducible

Entorno probado: Python 3.14.7, Qiskit 2.5.2, numpy 2.3.5. No son necesariamente las versiones exactas del runtime Qollab; registrarlas en el probe final si difieren.

| Etapa | Estados físicos | Nodos lógicos | P a ciegas | P óptima por intento | Gates mínimas, peor rama |
|---|---|---|---|---|---|
| L1 bell_preparation | 4 | 12 | 0 (medir bloqueado) | 1 | 2 + RUN obligatorio |
| L2 opposites | 6 | 14 | 0 | 1 | 1 |
| L2 feed-forward | 6 | 14 | 0.5 | 1 | 1 |
| L3 core | 20 | 245 | 0 | 1 | 3 |

Unión actual de campaña: **20 estados físicos** tras revisar L1 (la histórica tenía 21). L1 sin CX tiene éxito 0; el DAG incluye RUN entre gates y medidas. L3 sin CX sigue máximo 0.5 y mínimo determinista tres gates. Todas las recetas equivalentes/sin reset se probaron localmente; no sustituye Qollab del cambio ni walkthrough espacial.

Desde la raíz del repo, después de instalar `requirements-dev.txt` en un virtualenv:
```bash
python -m pytest -q
python -m quantum.verify
```
El CLI devuelve JSON con métricas y DAG de soluciones y un exit code no cero si fallan los objetivos esperados. Test de precompute ejecuta campaña completa en BasicSimulator local y confirma idempotencia incluso con resets/cambio de nivel. Backends fake sync/async cubren fallo de envío/resultado/counts inválidos sin segundo envío.

Validación final de entrega local: **111 tests pasaron**, sin skips; CLI `quantum.verify` terminó con exit code 0; el loader leyó el OGG de Fernanda como JSON/base64. Revisión independiente del motor y del pack no dejó bloqueantes; se corrigió un error de validación de terminales malformados con regresión. Estos tests no sustituyen E7 ni el walkthrough en Qollab.

### Lo que sigue, sin mezclar entrega con fase completada

1. **Probe Python completo pasó en ambos.** Compartir resultados con Jhoan y consumir snapshot v2; no hace falta repetir los experimentos previos para avanzar.
2. En proyecto JS, validar `callPromising`, stage/reset, cola de acciones, terminales/CX, salidas y recorrido de los mapas. Esto cierra el trabajo F0/F1 según exit gates del MD 01.
3. **E7 cumplió <20 ms en ambos backends en el arnés**; usar métricas §8 en el debugger/texto de entrega. No asumir 60 fps ni todas las operaciones/escenarios cubiertos.
4. Probar un IBM noise model si disponible y revisar cómo se presenta mezcla/fallback/filtrado. El modo por defecto es conservador para cualquier backend; batch es opt-in solo en los compatibles.

### Integración de main — conflictos Git versus contrato de gameplay

Se incorporó el frontend de Jhoan desde `main` y se combinó `.gitignore` sin quitar reglas de ninguno. **Resolver ese conflicto no significa completar el puente real**: el bootstrap JS actual usa `LEVEL_ID='test'` y el mock/v1, mientras esta fachada admite `level1`–`level3` v2. El parser JS usa `[columna,fila]`; los terminales v2 usan `[fila,columna]`. La adaptación debe seleccionar `stages[stage_index]`, convertir coordenadas y respetar objetivo conjunto/indicadores no bloqueantes, terminal CX y avance/reset. Mantener el dev/mock funcional mientras se realiza ese trabajo; no cambiar `LEVEL_ID` a ciegas ni afirmar F0/F1 cerrado porque las suites aisladas pasan.

Después de resolver el merge pasaron **111 tests Python y 124 tests JS**, sin fallos ni skips. Esto confirma que se preservan ambos componentes por separado, no una ejecución integrada del frontend con el backend Python en Qollab.

### Entrega del handoff: E7 y texto técnico

- `dev/qollab-bridge/` contiene un diagnóstico **separado**, no reemplaza el frontend de Jhoan: llama a la fachada con `callPromising`, recibe counts, permite mover un cuadrado y mide eventos gates/measure/snapshot.
- Cargar sus archivos como `index.html`, `main.js`, `probe.js`, `main.css`, `requirements.txt` en la raíz de un proyecto JS de prueba, junto a `quantum/`, `levels/` y el OGG. No modificar el proyecto Python ya validado. Referencia oficial: https://qollab.xyz/learn/docs/js-qiskit-projects.
- El diagnóstico hace un solo precompute; excluye su tiempo de E7. Tres iteraciones de calentamiento, veinte muestras por operación; reporta p50/p95/máximo de llamada+JSON, sin DOM/render. Si p95 gates/medición excede 20 ms, E7 no alcanza el objetivo: registrar y optimizar con evidencia.
- El proyecto demostró puente/counts/E7 y Juanjo confirmó movimiento/foco en ambos: F0 básico del diagnóstico comprobado. No demuestra F1 del juego completo con colisiones, CX y 1P/2P ni el protocolo L1 recién revisado.
- Después, entregar a Samuel el texto técnico en inglés de aproximadamente 300 palabras basado en evidencia, y cerrar con Jhoan la adaptación v2 y los recorridos.

Validación del diagnóstico: tres tests de JS cubren llamada async/errores JSON, percentiles y un solo precompute con veinte muestras tras calentamiento. Suite **111 tests Python + 127 tests JS** pasó; los tiempos reales, distintos de esos tests, están en §8.

### Texto técnico para Samuel — borrador basado en evidencia

El bloque siguiente está entregado para edición, no implica que el juego JS esté validado en Qollab. Mantener la distinción de integración pendiente hasta cerrar los exit gates.

> Entangled is designed as a cooperative puzzle game in which Alice and Bob interact with a shared two-qubit register. Its puzzles depend on quantum amplitudes, not arbitrary random choices. Independent superpositions produce matching results only half the time, while a Bell pair produces correlated outcomes. Applying X changes correlation into anticorrelation. Relative phase becomes observable through interference, and CNOT can disentangle the register before a deterministic target is prepared.
>
> Python and Qiskit are the quantum source of truth. The engine evolves a full-precision Statevector, computes probabilities and reduced-state entanglement, and projects only the qubit explicitly measured. Correlation can make Bob's state definite without marking it measured: Bob can still apply a correction based on Alice's classically communicated result. Once a qubit is explicitly measured, gameplay gates touching it are rejected. Terminal uses and gate budgets are enforced by the same rules used by the solver.
>
> Qollab's IonQ integration accepted individual circuits but rejected circuit lists during our experiments. We therefore prepare ten priority two-qubit states as independent pairs in one twenty-qubit circuit and submit it once per execution. A classical-bit manifest extracts each pair's empirical counts from the joint result. Other reachable states use Qiskit sampling, and the engine reports backend, local, or mixed sources. Resets and level changes do not submit additional jobs.
>
> The revised calibration protocol passed on Qollab's built-in and Forte simulators. Players prepare and validate a Bell pair from zero before measuring; matching zero bits alone cannot unlock doors. Twenty physical states were verified locally. Both reported runs observed eleven and correctly unlocked both doors; visual gameplay still requires integration.
>
> Backend statistics remain separate from ideal probabilities; incompatible outcomes are filtered or sampled locally with diagnostics. This is not a continuous noisy hardware trajectory. A separate Qollab JavaScript probe measured gate and measurement p95 latency at or below 1.5 milliseconds on both tested backends; the complete gameplay walkthrough remains an integration check.

## 8. E7 real — resultados y cierre de la entrega de Juanjo

Fuente: reportes JSON de **Q-Quack bridge test** enviados por Juanjo, 2026-10-10. Caso: L2/opposites, X(q1), medir q0 y snapshot. Se excluyen tres iteraciones de calentamiento; veinte muestras por operación. Percentiles nearest-rank: p95 es la muestra 19 de 20 ordenadas. Cronómetro desde antes de `callPromising` hasta después de `JSON.parse`: incluye puente, ejecución Python y serialización/deserialización, **no render/DOM ni precompute**. No es un benchmark de todas las gates/etapas/dispositivos.

| Backend | Operación | Muestras | p50 ms | p95 ms | Máximo ms |
|---|---|---|---|---|---|
| Built-in (24q) | `apply_gate("x",1)` | 20 | 0.90 | 1.20 | 1.50 |
| Built-in (24q) | `measure(0)` | 20 | 1.00 | 1.50 | 1.70 |
| Built-in (24q) | `snapshot()` | 20 | 0.50 | 1.00 | 1.10 |
| Forte 1 simulator (29q) | `apply_gate("x",1)` | 20 | 0.90 | 1.20 | 2.30 |
| Forte 1 simulator (29q) | `measure(0)` | 20 | 0.90 | 1.40 | 2.80 |
| Forte 1 simulator (29q) | `snapshot()` | 20 | 0.40 | 0.60 | 0.80 |

Objetivo: p95 de gates/medición **<20 ms**, alcanzado en ambas ejecuciones. Incluso los máximos observados quedaron debajo de 3 ms. No se necesita optimizar o agregar caches basándose en estas muestras; rendimiento de render, cargas concurrentes, otras operaciones y tres qubits requieren pruebas propias si se incorporan.

### Arranque separado de la interacción

| Backend | Tiempo total UI | Llamada `precompute` desde JS | Ejecución de circuito reportada |
|---|---|---|---|
| Built-in | 12.5 s | 1548.4 ms (1.5484 s) | No reportada |
| Forte | 22.7 s | 16003.4 ms (16.0034 s) | 1000 ms |

`precompute_ms` comprende construcción del catálogo/preparaciones, sampling fallback, envío/espera, decodificación y respuesta JSON; no aislarlo como tiempo de red o de circuito. La línea 1000 ms es la métrica que imprime la plataforma, no latencia JS ni tiempo total. Pantalla de carga necesaria; **después del arranque los eventos reutilizan counts y evolucionan/proyectan localmente**, sin un nuevo job por gate/medición/reset. Es la razón arquitectónica de que Forte pueda tener un arranque de ~16 s para precompute y eventos de ~1 ms, no que el cloud esté respondiendo en 1 ms por medición.

Ambos reportes: `states:21`, `circuits:1`, `strategy:packed`, `submitted_states:10`, `backend_states:10`, `source:mixed`, `shots:200`, `reason:null`. Medidas de comprobación: built-in Alice=0/Bob=1, Forte Alice=1/Bob=0, ambas fuentes backend y objetivo satisfecho. No hubo fallback por fallo remoto.

### Counts Bell y límites del ruido

- Built-in: `00:102,11:98`, total 200; soporte ideal de Φ⁺.
- Forte: `00:110,11:87,10:1,01:2`, total 200; tres shots (1.5 %) fuera del soporte ideal.
- Ese 1.5 % es incompatibilidad observada de **este par** en un simulador remoto, no tasa global de error ni medición de hardware real. Medir en Z no identifica todos los errores de fase. El muestreo posterior sigue las reglas de estado ideal/filtrado documentadas, no una trayectoria física ruidosa.
- El histograma de veinte bits es el job empaquetado completo, no los dos qubits del nivel; para debugger usar marginal de `sampling.counts` del estado.

### Qué sigue, sin más experimentos redundantes

1. Conservar proyectos/salidas; Juanjo ya confirmó clic/foco y movimiento del cuadrado en ambos.
2. Adaptación Jhoan v2: etapa, coordenadas, terminal IDs y actor; L1 añade botón RUN, sensores bloqueados antes y colisiones por door_states. CX de Bob requiere control0/target1, no inferir qubit desde owner; L3 conserva ambas placas. Mantener objetivos/salidas/reset/advance.
3. Nuevo L1 en Qollab Python ya pasó: probarlo ahora con interfaz real, luego recorrer las cuatro etapas para F2/F3. E7/F0 básico y la consola no sustituyen gameplay.
4. Acordar presupuesto de entidades L2/opposites y L3, y regla propuesta de glitches. IBM noise model es prueba adicional pendiente antes de entrega final, no bloqueo de E7.
5. Samuel recibe el borrador técnico actualizado de §7 con métricas E7 verificadas. Los entregables de código/snapshot/E1–E7 de Juanjo quedan registrados; integración espacial/juego completo sigue siendo trabajo conjunto.

## 9. Revisión L1 — preparación validada y desbloqueo físico

Solicitud de Juanjo, 2026-10-10. Rama `feat/juanjo-l1-bell-validation`, commit `8a82c8e`, publicada en **PR #5 y fusionada por el equipo** (main `2f42913`). Inicialmente se mantuvo local por instrucción del usuario; luego autorizó el PR. Prueba manual del protocolo Python completada en ambos backends. Todavía falta adaptar y recorrer el frontend; actualizar main no actualiza los proyectos Qollab automáticamente.

| Momento | Estado ideal del registro (juego) | Medición habilitada | Puertas físicas |
|---|---|---|---|
| Inicio | 00, circuito vacío | No | Ambas cerradas |
| Solo H de Alice | (00+10)/√2 | No | Ambas cerradas |
| H→CX de Bob, sin RUN | Φ⁺ | No | Ambas cerradas |
| RUN válido | Φ⁺, prueba persistente | Sí | Ambas cerradas |
| Una observación | 00 o 11; otra aún no observada | Sí para la restante | Ambas cerradas |
| Ambas observadas e iguales | 00 o 11 | No quedan pendientes | Ambas abiertas |
| Preparación incorrecta/resultados diferentes | Sin objetivo válido | Reintentar según caso | Ambas cerradas |

API nueva: `run_circuit()`, JSON como las demás. Incompleto → `CIRCUIT_INCOMPLETE`; orden/estado incorrecto → `INVALID_CIRCUIT`; medir antes → `CIRCUIT_NOT_VALIDATED`; gate sin actor en L1 → `ACTOR_REQUIRED`; gates postvalidación → `CIRCUIT_LOCKED`. L2/L3 no requieren RUN y conservan llamadas anteriores. RUN repetido es idempotente incluso después de colapso, y nunca llama backend; la prueba se refiere al estado **antes** de medir, no a que el estado colapsado siga siendo Bell.

```python
engine.new_session("level1")
engine.apply_gate("h", 0, -1, "alice_h", "alice")
engine.apply_gate("cx", 0, 1, "bob_cx", "bob")
engine.run_circuit()  # valida, todavía no abre ni mide
engine.measure(0)     # puertas aún cerradas
engine.measure(1)     # ambas abiertas si resultados iguales
```

`docs/snapshot-level1-example.json` reproduce el snapshot inicial real y está testeado; `docs/snapshot-example.json` de L2 no cambia. Separar físicamente `door_states` de `objects` evita interpretar el 0 inicial como apertura. Test BFS espacial confirma que cada salida está detrás de su puerta sin bypass; falta el walkthrough JS real.

Verificación local de L1: éxito1, ciego0, sinCX0, dos gates + RUN + dos medidas; cuatro vectores/12 nodos lógicos. El catálogo usa identidad física; verificador/BFS distinguen el mismo Φ⁺ preparado y validado por la prueba/historial. Presupuesto L1: diez entidades (2 jugadores/2 sensores/2 terminales/2 puertas/2 salidas), RUN es UI, no otra entidad del mapa.

La política de ruido no cambió: proyección ideal y filtro/fallback diagnosticado, no una trayectoria física ruidosa completa. La condición lógica rechaza medidas diferentes; no se introduce nuevo modelo de readout ni se deduce entrelazamiento desde counts. El motor/protocolo nuevo ya pasó en Qollab; falta probar el UI RUN antes de declarar el nivel jugable.

Validación local: **137 tests Python + 127 tests JS** pasaron, CLI exit 0 y revisión sin bloqueantes. Casos: fase global/Φ⁻, actor omitido, RUN/colapso, RNG bloqueado antes de validar, reset/prueba, ambas ramas y ausencia de segundo job. Prueba BasicSimulator local complementada ahora por evidencia Qollab siguiente.

### Nuevo L1 en Qollab — protocolo completo validado

Fuente: salidas enviadas por Juanjo de **Q-Quack L1 protocol**, 2026-10-10, paquete `qollab-juanjo-l1-validation.zip`. Ambas ejecuciones finalizaron sin error y con `L1 NEW PROTOCOL: OK (quantum protocol, not a spatial gameplay test)`.

| Backend | Tiempo UI | Precompute | Resultados | Fuente de ambas medidas | Final/reset |
|---|---|---|---|---|---|
| Built-in simulator (24q) | 8.6 s | 20 estados, 1 circuito, 10 enviados/10 backend, mixed, reason null | Alice=1, Bob=1 | backend/backend | Ambas puertas abiertas; reset cierra y borra validación |
| IonQ Forte 1 simulator (29q) | 20.1 s | Mismo resumen | Alice=1, Bob=1 | backend/backend | Ambas puertas abiertas; reset cierra y borra validación |

Verificado por asserts del probe: inicio |00⟩ no mide/abre; H deja (00+10)/√2 y puertas cerradas; CX prepara Φ⁺ pero medir aún se bloquea; RUN valida y conserva puertas cerradas; primera medida no abre; ambas coincidencias 11 abren; RUN repetido no altera el final; reset elimina prueba y relock. El resultado 11 en ambos es evidencia útil de que las puertas no dependen de `open_on:0`. No es una demostración de un RNG fijo ni de la frecuencia 50/50 con solo dos ejecuciones.

Solo se observó remotamente la rama 11 en estos reportes; la rama 00 ya tiene prueba local forzada. No hace falta repetir Runs solo para perseguir 00. Forte imprime `Circuit execution time: 1000ms`, distinto del total UI; aquí no se midió precompute aislado ni nueva latencia E7. No inferir mejora de rendimiento comparando Runs con diferente carga/caché.

Histograma de veinte bits = distribución conjunta del pack. Sin reportes de marginales/descarte por par, no calcular una tasa de ruido de esta ejecución a partir de la lista. La consola confirma el modelo de desbloqueo, **no colisión/animación/escape visual ni 1P/2P**.

Paquete conservado para reproducibilidad: `/home/juanm/singularity-tmp/opencode/qollab-juanjo-l1-validation.zip` (catorce archivos, main/requirements en raíz). Prueba de consola completada; no repetir salvo regresión. **Próximo paso con Jhoan:** conectar RUN, actor/operandos de Bob, measurement_enabled y door_states, y verificar secuencia completa caminando al sensor/puertas/salidas. No usar el ZIP viejo ni asumir que Publish/merge incorpora esos controles al frontend.

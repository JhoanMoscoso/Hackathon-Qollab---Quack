# Entangled — Arquitectura

## Restricciones de la plataforma (Qollab) que la definen

- Proyecto **JS**: `index.html` (solo contenido de body; `<script>` se ignora) + `main.js` + `main.css` (único CSS cargado). Otros `.html`/`.css` no se cargan.
- `main.js` importa JS propio con `./ruta` y **módulos Python propios por nombre punteado** (`import * as engine from 'quantum.engine'`). Las funciones Python se llaman con `.callPromising(...)` / `.callPromisingKwargs(...)`. En IonQ una llamada síncrona rompe el run.
- `backend` es global, lo elige quien presiona Run. **Nunca** crear un backend en código.
- IonQ (simulador remoto y hardware): **un solo `backend.run` por Run**. Local: ilimitado.
- Sin `localStorage`, cookies, WebSocket, workers, XHR. Solo `fetch` GET a servidores con CORS `*`. No se guarda nada entre runs.
- JS **no puede leer archivos del proyecto**. Python sí, si la ruta aparece como string literal en el código. Binarios OK. Esto aplica a niveles JSON, OGG y PNG.
- Límites: 100 archivos, 2 MB cada uno. Sin límite de tiempo por run.
- Librerías JS: `three`, `postprocessing`, `tween.js`, `meshline` por nombre; cualquier otra desde URL completa (`https://cdn.jsdelivr.net/npm/<pkg>/+esm`). No usamos ninguna.
- Qiskit ≥ 2.5.2 instalado siempre. `requirements.txt` solo si hace falta algo más (no hace falta).
- Navegadores: Chrome/Edge/Opera recientes, Firefox ≥ 153. Safari no.

## Decisión de arquitectura (única)

**Juego en JS (Canvas 2D) + motor cuántico en Python/Qiskit en el mismo navegador (Pyodide).**
JS es dueño del loop, el render, el input y la máquina de estados. Python es dueño del estado cuántico: es la única fuente de verdad del registro, de las probabilidades y de los resultados de medición.

Alternativas rechazadas:
- *Simulador cuántico escrito en JS* (lo que sugería Gemini): viola la regla "usar Qiskit". Rechazado.
- *Proyecto Python puro con matplotlib*: no hay input de teclado ni loop interactivo. Rechazado.
- *Backend externo (Flask/FastAPI)*: Qollab solo permite GET, y los jueces corren en Qollab. Rechazado.
- *Phaser/Three.js*: peso y tiempo de aprendizaje sin beneficio para un grid 2D. Rechazado.

## Estructura de archivos

```
index.html            # contenedores: #loading, #menu, #game (canvas), #debugger, #narrator, #a11y-live
main.css
main.js               # bootstrap: import engine (py) + módulos js; arranca máquina de estados
js/
  state.js            # máquina de estados: loading → menu → level → dead → win → credits
  input.js            # mapeo 1P (WASD+E, Tab cambia personaje) / 2P (WASD+E, Flechas+Enter)
  grid.js             # mapa por celdas, colisiones, consulta de celda
  entities.js         # Player, Door, Bridge, Laser, Sensor, GateTerminal, CnotTerminal, Exit
  render.js           # dibujo del mapa, entidades y estados (0 / 1 / superposición), capas
  debugger.js         # panel: ket, barras de probabilidad, circuito dibujado desde el historial
  narrator.js         # cajas de texto del contexto, por evento (enter level, gate, measure, death, win)
  audio.js            # Web Audio: SFX sintetizados + reproducción del OGG (Blob)
  menu.js             # menú principal, opciones (1P/2P, reduce motion, text size), créditos
  sprites.js          # spritesheet como data-URL base64 (o paleta/procedural si P4 = neón)
quantum/
  engine.py           # API pública para JS (ver 03-spec)
  enumerate.py        # BFS de estados alcanzables + circuitos de medición
  levels.py           # carga de levels/*.json (rutas como string literal) y del OGG
levels/
  level1.json  level2.json  level3.json
audio/
  soundtrack.ogg      # ≤ 2 MB
docs/                 # estos documentos (no se suben a Qollab si no se quiere)
README.md             # inglés; se reutiliza en la project page
LICENSE               # MIT
```

## Flujo de datos

```
[Run] → Pyodide carga Qiskit (10–30 s, pantalla #loading)
      → main.js: engine.load_level.callPromising("level1")  → JSON del nivel (string)
      → engine.precompute.callPromising(backend, shots)       → UN backend.run con un circuito
                                                                  packed; restantes estados fallback
      → loop del juego (JS, 60 fps, solo render/movimiento)

Jugador pisa terminal de compuerta → JS: engine.apply_gate("H", 0) → snapshot
Jugador pisa sensor               → JS: engine.measure(0)          → {outcome, snapshot}
snapshot → render (estado de puertas/puentes/láseres) + debugger + narrador + audio
```

Todo lo que cruza el puente JS↔Python viaja como **string JSON** (`json.dumps` en Python, `JSON.parse` en JS). Evita proxies, `Map` y problemas de `.toJs()`.

## Modelo del registro cuántico en el juego

- `q0` = Alice (lado izquierdo, color A). `q1` = Bob (lado derecho, color B). Stretch: `q2` = objeto compartido.
- Cada objeto interactuable del mapa está ligado a un qubit y a un valor que lo "activa":
  - `|0⟩` → estado "desactivado / libre"; `|1⟩` → "activado / bloqueo". El JSON del nivel decide qué significa para cada objeto (una puerta se abre con 0, un puente aparece con 1).
  - Mientras el qubit no está medido y tiene probabilidad > 0 de ambos valores, el objeto se dibuja en **superposición** (parpadeo/semitransparente + icono ⟂). No se puede cruzar.
- **Sensor** (placa de observación): mide **su** qubit en la base computacional. El resultado fija el objeto. Los demás qubits se actualizan según la correlación (el motor lo calcula).
- **Terminal de compuerta**: aplica una compuerta de 1 qubit al qubit del jugador que la pisa (H, Z para Alice; X para Bob). Se consume (una vez por nivel) o es reutilizable según el JSON.
- **Terminal CNOT**: está en la pared central. Requiere a Alice en la celda de control y a Bob en la celda target al mismo tiempo (2P) o alternar con Tab en 1P (ambos personajes parados ahí). Aplica CX(q0→q1).
- **Salida**: condición de victoria = patrón de bits requerido en los objetos (ej. `"win": {"q0": 1, "q1": 0}`) **y** ambos jugadores en sus celdas de salida.
- **Muerte**: pisar una celda cuyo objeto quedó en el valor letal, o pisar un objeto en superposición. Reinicia el nivel; el registro se re-prepara al estado inicial del JSON.

## Estrategia "un job por Run" (IonQ)

1. Antes de enviar, BFS de las tres etapas actuales considera budgets/usos/mediciones, prueba RUN de L1 y fases SEND/RECEIVE/corrección de L2. Catálogo físico20; cache/guard duran todo el Run. Las primeras pruebas históricas tenían21. Contratos 03 y 06 §9–10.
2. Para 2 qubits con compuertas Clifford el conjunto cabe en ≤ 60 estados (estados estabilizadores); con presupuesto 6 suele ser 15–40. Para 3 qubits se limita por presupuesto.
3. `StatePreparation` sin reset + medida y transpilación. **Modo por defecto packed**, alineado con `07-level-design-constraints.md`: diez estados prioritarios en pares independientes de un único circuito de veinte qubits; se decodifican counts por par mediante un manifest explícito de bits clásicos. Si el backend declara menos capacidad se reduce el pack. Otros estados usan Qiskit local; falla de envío/resultado → fallback sin reenviar. `single` queda como modo de un Bell y `batch` como opt-in solo para compatibles. **Motor, pack y puente JS de diagnóstico probados en Qollab built-in y Forte**; el recorrido/adaptación del juego sigue pendiente.

   **L1 revisado y validado en Qollab Python en ambos backends:** inicio |00⟩, H Alice/CX Bob, después `run_circuit` valida sin otro job. Sensores bloqueados antes; puertas por prueba+ambas medidas iguales, no bit local. Manifest nuevo (Ψ⁻ en vez de |++⟩, 20 estados/diez pares) pasó; rama 11 abre ambas puertas y reset relock. UI/escape del juego pendiente; evidencia 06 §9.

   **L2 revisado:** re-preparar Φ⁺; BobX/medida→SEND→AliceRECEIVE→Xsi0/KEEPsi1→Alice0. Mensaje/corrección son acciones locales sin job; fases y permisos por qubit se exponen al HUD. 00/01 finales abren puertas por protocolo, no bitBob. El debugger conjunto es una vista clásica/omnisciente, no evidencia de que Alice recibe información sin canal.

   **L3 The Core:** H/Z de Alice y X de Bob son terminalesHUD con mismos usos/budget; CX sigue con ambas placas físicas. Diez entidades, carriles sensor→peligro→salida obligatorios. No cambia el catálogo20/pack diez pares ni el motor de evolución. Validación local/probe listos; aceptación visual y Run propio delL3 pendiente.
4. Resultado: `counts[state_key]`. En juego, medir el qubit k en el estado S = sacar un shot de `counts[S]` y leer el bit k. El estado post-medición se calcula con `Statevector` y se busca su key para la siguiente medición.
5. Si `backend.run` falla (IonQ caído, lista no soportada), fallback: `Statevector(S).sample_counts(shots)` por estado. Se informa en el debugger ("sampled locally").

El estado/probabilidades son ideales y los counts backend son estadísticas separadas. Outcomes imposibles se filtran y se informa fuente efectiva/descarte; esto condiciona el ruido y no reproduce una trayectoria física continua. No etiquetar un porcentaje de incompatibilidad como tasa total de error de hardware. Diagnóstico JS validado; integración del juego e IBM noise model pendientes; ver evidencia en 06 §8.

## Rendimiento

- Pyodide + import de Qiskit: 10–30 s la primera vez por sesión. Pantalla de carga obligatoria con texto.
- Llamada JS→Python: solo en eventos, nunca por frame. E7 con tres warm-ups y veinte muestras: p95 gates 1.20 ms en ambos; medir 1.50 ms built-in / 1.40 ms Forte. Incluye JSON, excluye render/precompute. Cumplió <20 ms en el caso medido, no garantía de toda operación/dispositivo.
- `precompute` desde JS medido: 1548.4 ms built-in / 16003.4 ms Forte a 200 shots; UI total 12.5 s / 22.7 s. Separar carga/espera de eventos; no asumir <1 s local ni confundir los 1000 ms de circuito reportados por Forte con tiempo end-to-end.
- Canvas: mapa ≤20×12, sin partículas pesadas; rendimiento y cantidad de entidades deben medirse en integración, sin garantía 60 fps todavía.
- No usar `circuit.draw('mpl')` (matplotlib en Pyodide es lento). El circuito se dibuja en JS.

## Assets

- **Sprites**: no se pueden `fetch`. Opción elegida: spritesheet PNG → base64 → `js/sprites.js` (`const SHEET = "data:image/png;base64,..."`). Un PNG de 16×16 tiles ocupa < 50 KB. Alternativa si P4 = neón: todo procedural con `ctx` (rectángulos, líneas, glow con `shadowBlur`).
- **Soundtrack**: `quantum/levels.py` lee `audio/soundtrack.ogg` como bytes (ruta literal) y lo devuelve; JS crea `new Blob([bytes], {type:'audio/ogg'})` → `URL.createObjectURL` → `Audio`. Autoplay requiere gesto: se arranca al pulsar "Start" en el menú.
- **SFX**: osciladores Web Audio (`js/audio.js`), sin archivos. Idea alineada al tema: la frecuencia del tono de "medición" se mapea a la probabilidad del resultado.

## Accesibilidad (requisito explícito de las reglas)

- Todo jugable con teclado; sin acciones que requieran ratón salvo el click inicial de foco.
- Estados de objetos codificados por color + forma + texto en el debugger (`aria-live="polite"` con el ket y el resultado de cada medición).
- Contraste ≥ 4.5:1 para texto; paleta cian/naranja (distinguible con deuteranopia).
- Opción "Reduce motion" (desactiva parpadeo de superposición → se reemplaza por patrón rayado).
- Opción "Large text".
- Foco visible en el menú (`:focus-visible`).

# Entangled — Plan de ejecución por fases (lineal, ~30 h)

Horas relativas al arranque (H0). Cada fase tiene una **puerta de salida** (exit gate) verificable. No se avanza de fase sin pasar la puerta.

## Fase 0 — Arranque (H0 → H3)

Objetivo: un proyecto Qollab JS que corre, llama Qiskit desde Python, y pinta en pantalla. Repo creado. Decisiones P1–P4 cerradas.

| Quién | Tarea |
|-------|-------|
| Jhoan | Crear repo GitHub (MIT, `.gitignore`, estructura de `docs/02-arquitectura.md`). Crear proyecto en Qollab (tipo JS). Subir el esqueleto. Probar Run en built-in simulator y en IonQ Forte 1 (remote simulator). |
| Juanjo | `quantum/engine.py` v0: función `hello(backend)` que arma un Bell, hace `backend.run`, devuelve counts como JSON. Confirmar que `callPromising` funciona desde `main.js`. |
| Fernanda | Decidir P4 con el equipo. Definir paleta (2 colores de jugador + 3 neutros). Empezar soundtrack (loop 60–90 s, OGG ≤ 2 MB). |
| Samuel | Leer `docs/04-setup-hoy.md` sección "Entrega". Crear esqueleto del README en inglés y de la project page. Guion del video (storyboard de 6 escenas). |
| Todos | Cerrar P1, P2, P3 (máx. 30 min de reunión). |

**Exit gate F0:** en Qollab, al presionar Run se ve un canvas con un cuadrado moviéndose con teclas y un texto con counts de un Bell. Funciona en built-in y en IonQ Forte 1.

## Fase 1 — Núcleo (H3 → H10)

Objetivo: motor cuántico completo y motor de juego sin niveles reales.

| Quién | Tarea |
|-------|-------|
| Juanjo | `quantum/engine.py` según `docs/03-spec-motor-cuantico.md`: sesión, `apply_gate`, `measure`, `snapshot`, enumeración de estados alcanzables, `precompute(backend, shots)` con un solo `backend.run`, fallback a `Statevector.sample_counts`. Tests locales con pytest (fuera de Qollab). |
| Jhoan | `js/grid.js` (mapa, colisiones), `js/entities.js` (jugadores, puertas, sensores, terminales), `js/input.js` (1P/2P), `js/render.js` (canvas, capas), `js/debugger.js` (ket, barras, circuito dibujado desde historial), `js/state.js` (máquina de estados: menu → level → dead → win). Loader de nivel desde JSON (vía Python). |
| Fernanda | Tileset o paleta procedural según P4. Sprites: Alice, Bob, puerta (3 estados: 0, 1, superposición), sensor, terminal de compuerta, terminal CNOT, salida. Soundtrack v1. |
| Samuel | README: secciones "What it is", "Quantum concepts", "How to run", "Controls", "What existed before the window" (nada: todo nuevo; se declaran librerías). Capturar clips de F0 para el video. |

**Exit gate F1:** en un nivel de prueba, Alice aplica H, Bob aplica X, ambos van al CNOT, uno mide; el debugger muestra ket/barras/circuito correctos; la muerte reinicia; funciona en 1P y 2P.

## Fase 2 — Niveles 1 y 2 + menú (H10 → H18)

| Quién | Tarea |
|-------|-------|
| Juanjo | `levels/level1.json`, `levels/level2.json` (mapa + gate set + estado inicial + condición de victoria). Verificar con el motor que L1 y L2 son resolubles y que "medir sin pensar" falla como se diseñó. |
| Jhoan | Menú principal (New game 1P / 2P, Options, Credits con atribución Qollab & IonQ), pantalla de carga (Pyodide tarda), overlay "click to focus", pantalla de muerte/victoria, transición de nivel. Narrador (cajas de texto del contexto elegido). |
| Fernanda | Arte final de L1–L2, SFX con Web Audio (`js/audio.js`): paso, compuerta aplicada, medición/colapso, muerte, victoria. Integrar OGG. |
| Samuel | Project page en Qollab (markdown): descripción, conceptos, cómo correr, controles, créditos, licencia. Primer corte del video con L1. |

**Exit gate F2:** L1 y L2 se completan de punta a punta desde el menú, con audio, en Qollab (built-in e IonQ sim).

## Fase 3 — Nivel 3 + pulido + accesibilidad (H18 → H24)

| Quién | Tarea |
|-------|-------|
| Juanjo | `levels/level3.json` (desentrelazar/interferencia). Stretch: tercer qubit. Revisión de textos de física del narrador y del README (rigor). |
| Jhoan | L3 jugable. Pase de accesibilidad: foco de teclado, `aria-live`, contraste, reduce-motion, tamaño de texto. Pantalla final. |
| Fernanda | Arte L3, balance de audio, pantalla de título. |
| Samuel | Video v2 completo (2–3 min). Project page final. |

**Exit gate F3:** los 3 niveles se completan; checklist de accesibilidad marcado; sin errores en consola.

## Fase 4 — Congelación y entrega (H24 → H28)

1. Code freeze. Solo bugs bloqueantes.
2. Run completo en: built-in simulator, un IBM noise model, IonQ Forte 1 (remote). Capturar evidencia (screenshots) para la project page.
3. Publicar versión en Qollab (MIT). Verificar que la página pública se abre sin login y Run funciona.
4. Subir video (YouTube unlisted o Drive público). Probar el link en incógnito.
5. El capitán envía desde la página de registro: proyecto + video + tema **Quantum Playground**.
6. Verificar la atribución "This effort is supported by Qollab & IonQ" en project page y README.

**Buffer:** H28 → H30.

## Riesgos y mitigación

| Riesgo | Mitigación |
|--------|------------|
| Pyodide + Qiskit tarda 10–30 s en cargar | Pantalla de carga con texto explicativo; no bloquear el menú si se puede. |
| `backend.run` con lista de circuitos falla en IonQ | Probar en F0. Fallback: `Statevector.sample_counts` (sigue siendo Qiskit). |
| Teclado no responde en el iframe | Overlay "Click to play" que da foco al canvas. |
| OGG no carga | Cortar música, quedan SFX. |
| Qiskit `draw('mpl')` lento | No se usa; el circuito se dibuja en JS desde el historial. |
| Alguien se queda sin tarea | Siempre hay README/project page/tests pendientes. |

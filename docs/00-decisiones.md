# Entangled — Registro de decisiones

Hackathon Qollab × IonQ, tema **Quantum Playground**. Nodo: LATAM Quantum Node – Chapter Córdoba.
Ventana: 9 oct 19:00 ET → 11 oct 19:00 ET. Presupuesto real del equipo: ~30 h.

## Equipo

| Persona  | Rol                              | Área del repo                     |
|----------|----------------------------------|-----------------------------------|
| Juanjo   | Python / Qiskit (motor cuántico) | `quantum/`, `levels/*.json`       |
| Jhoan    | JS / motor de juego, repo        | `main.js`, `js/`, `index.html`    |
| Fernanda | Arte y música                    | `assets/` (via `js/sprites.js`), `audio/` |
| Samuel   | Video y documentación            | `README.md`, project page, video  |

## Decisiones tomadas

| # | Decisión | Valor |
|---|----------|-------|
| D1 | Tipo de proyecto Qollab | **JS project**: `index.html` + `main.js` + `main.css`. Motor cuántico en Python/Qiskit importado desde `main.js`. |
| D2 | Render | Canvas 2D vanilla. Sin Phaser/Godot/Three. |
| D3 | Vista y movimiento | Top-down por celdas (grid). Sin física continua. |
| D4 | Modos de juego | 1 jugador (alterna Alice/Bob con `Tab`) y 2 jugadores mismo teclado (WASD+E / Flechas+Enter). Se elige en el menú principal. 1P es el default. |
| D5 | Fallo | Colapso adverso = muerte y reinicio del nivel (registro cuántico se re-prepara). |
| D6 | IonQ (1 job por Run) | Al iniciar un nivel se enumeran todos los estados alcanzables y se mandan **todos** los circuitos de medición en un solo `backend.run`. El juego consume esas muestras. Mismo código en simulador local. |
| D7 | Quantum Debugger | Siempre visible: ket actual, barras de probabilidad, circuito construido (historial de compuertas, dibujado en JS). |
| D8 | Música | Soundtrack: 1 archivo OGG ≤ 2 MB (cargado vía Python → Blob). SFX: sintetizados con Web Audio. |
| D9 | Idioma | Juego, project page, README y video en **inglés**. Docs internos en español. |
| D10 | Accesibilidad | Teclado completo, contraste AA, estados codificados por color **y** forma/texto, región `aria-live` para el debugger, opción reduce-motion. |
| D11 | Licencia | MIT en Qollab y en GitHub. Atribución obligatoria: "This effort is supported by Qollab & IonQ". |
| D12 | Repo | GitHub público (Jhoan). Qollab se actualiza subiendo la carpeta/zip del repo (Upload your own files). |

## Decisiones pendientes (default propuesto si no se decide a H+2)

| # | Decisión | Opciones | Default propuesto |
|---|----------|----------|-------------------|
| P1 | Contexto / historia | A) The Lab · B) Twin Cells (prisión) · C) Inside the Circuit | **C** (máxima novedad y arte más barato). Fallback seguro: A. |
| P2 | Filosofía de puzzle | a) 100 % determinista · b) feed-forward · c) progresión L1 correlación → L2 feed-forward → L3 desentrelazar/interferencia | **c** |
| P3 | Gate set | Base: Alice {H, Z}, Bob {X}, CNOT compartido. Extras: medir en base X, S/T, tercer qubit (GHZ) en L3 | **Base + tercer qubit como stretch goal de L3.** Sin base X, sin S/T. |
| P4 | Dirección de arte | Pixel art 16×16 · Vector/flat geométrico · Neón procedural | Depende de P1. Con C → neón procedural (casi sin sprites). Con A/B → pixel art 16×16 mínimo (≤ 12 tiles + 2 sprites). |

## Líneas de corte (scope cuts)

- H+18 sin L1 y L2 jugables de punta a punta → el nivel 3 se elimina; se pule L1–L2.
- H+24 sin música integrada → se elimina el OGG, quedan los SFX sintetizados.
- El modo 2 jugadores es solo un mapeo de teclas extra; si molesta, se recorta sin tocar diseño.
- El tercer qubit (GHZ) es stretch goal. Nunca se empieza antes de que L1–L3 estén jugables.

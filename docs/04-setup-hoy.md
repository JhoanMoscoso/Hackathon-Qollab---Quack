# Entangled — Setup de hoy (Fase 0) y checklist de entrega

## 1. Repo GitHub (Jhoan, 20 min)

```
git init entangled && cd entangled
# LICENSE: MIT con "Copyright (c) 2026 <nombres del equipo>"
# README.md: inglés, mínimo "Entangled — a co-op quantum puzzle game. Built for the Qollab × IonQ Quantum Hackathon 2026. This effort is supported by Qollab & IonQ."
# .gitignore: __pycache__/, .venv/, node_modules/, *.zip
```

Ramas: `main` siempre corre en Qollab. Cada persona trabaja en `feat/<nombre>`; PRs rápidos sin review formal (hackathon), pero **nunca** se mergea algo que rompa Run.

Regla de oro: lo que está en `main` es lo que se sube a Qollab. Nada de "lo tengo local".

## 2. Proyecto en Qollab (Jhoan, 30 min)

1. `qollab.xyz/new` → **JS / Qiskit wrapper** (o Upload your own files con la carpeta del repo).
2. Nombre: `entangled`. Descripción provisional en inglés.
3. Pegar el esqueleto mínimo (abajo). Run en **Built-in simulator**. Luego Run en **IonQ Forte 1 (remote simulator)**.
4. Guardar el link del proyecto en el README y en el Slack del equipo.

Sincronización repo → Qollab: zip de la raíz del repo (sin `docs/`, sin `.git`) → "Upload your own files". Hacerlo al final de cada fase. Verificar que `index.html` y `main.js` quedan en la raíz.

### Esqueleto mínimo para validar F0

**Actualización de Juanjo:** el esqueleto siguiente es histórico. No ejecutar `hello` y `precompute` en el mismo Run IonQ: consumiría dos envíos. El motor real y el pack de veinte qubits ya pasaron en Qollab Python; el diagnóstico vigente para canvas + puente y E7 está en `dev/qollab-bridge/`, con instrucciones en `docs/06-handoff-juanjo.md`. Sus archivos HTML/JS/CSS/requirements van en la raíz del proyecto de prueba, junto a `quantum/` y `levels/`; no reemplazar el frontend de Jhoan sin coordinar.

`index.html`
```html
<div id="loading">Loading quantum runtime…</div>
<canvas id="game" width="640" height="384" tabindex="0" aria-label="Entangled game"></canvas>
<pre id="debug" aria-live="polite"></pre>
```

`main.css`
```css
body{background:#0b0e14;color:#e6edf3;font-family:system-ui,monospace}
canvas{display:block;outline:2px solid transparent}
canvas:focus-visible{outline-color:#58a6ff}
```

`quantum/engine.py`
```python
import json
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

async def hello(backend, shots=100):
    qc = QuantumCircuit(2, 2); qc.h(0); qc.cx(0, 1)
    probs = Statevector(qc).probabilities_dict()
    qc.measure([0, 1], [0, 1])
    job = await backend.run([qc], shots=shots)   # lista: valida "1 job" con varios circuitos
    counts = (await job.result()).get_counts()
    return json.dumps({"probs": probs, "counts": counts, "backend": str(backend)})
```

`main.js`
```js
import * as engine from 'quantum.engine';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const dbg = document.getElementById('debug');
let x = 2, y = 2;

const res = JSON.parse(await engine.hello.callPromising(backend, 100));
document.getElementById('loading').remove();
dbg.textContent = JSON.stringify(res, null, 2);

canvas.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') x++; if (e.key === 'ArrowLeft') x--;
  if (e.key === 'ArrowDown') y++;  if (e.key === 'ArrowUp') y--;
});
canvas.focus();

function frame(){
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#58a6ff'; ctx.fillRect(x*32, y*32, 32, 32);
  requestAnimationFrame(frame);
}
frame();
```

Qué valida: import Python desde JS, `backend.run` con lista de circuitos, `Statevector`, canvas, teclado en el iframe. Si `backend.run([qc])` falla en IonQ con lista, anotar y usar `backend.run(qc)` → **cambia la estrategia IonQ a fallback Statevector** (ver 02-arquitectura).

## 3. Entorno local (todos, 15 min)

```
python -m venv .venv && source .venv/bin/activate
pip install "qiskit>=2.5.2,<3" numpy pytest
pytest quantum/tests
```
El juego completo solo corre en Qollab con su `backend` real. Para desarrollar localmente sin Pyodide: `.venv/bin/python dev/engine_server.py` y abrir `http://localhost:8000/dev/` (corre el motor Python/Qiskit real; muestreo local, sin backend).

## 4. Checklist de entrega (Samuel, Fase 4)

- [ ] Proyecto publicado en Qollab, público, licencia MIT seleccionada.
- [ ] Project page: What it is · Why quantum is essential (superposition, entanglement, measurement, interference; not RNG) · How to run (press Run, pick Built-in; also works on IonQ Forte 1 simulator) · Controls (1P/2P) · Level guide · Architecture (JS + Python/Qiskit in browser, one-job strategy) · What existed before the window (nothing; libraries: Qiskit, Pyodide runtime) · Team · License · "This effort is supported by Qollab & IonQ".
- [ ] README.md del repo = misma info + link al proyecto Qollab y al video.
- [ ] Repo GitHub público, MIT, sin secretos, dependencias listadas.
- [ ] Video 2–3 min, link público sin login (YouTube unlisted/Drive "anyone with the link"). Probado en incógnito.
- [ ] Run verificado en: Built-in, un IBM noise model, IonQ Forte 1 remote. Screenshots en la project page.
- [ ] Submit por el capitán desde `qollab.xyz/programs/hackathon/register` antes de **11 oct 19:00 ET**, tema **Quantum Playground**.
- [ ] Post en redes (obligación si se gana; mejor hacerlo igual).

## 5. Guion del video (Samuel, 2:30)

| t | Escena |
|---|--------|
| 0:00 | Título + una frase: "Two players, two rooms, one entangled register." |
| 0:15 | Qollab: presionar Run, pantalla de carga, menú. |
| 0:30 | L1: medir y ver que los dos objetos siempre coinciden. Debugger muestra Φ⁺. |
| 1:00 | L2: Bob aplica X, anticorrelación; Alice mide, Bob usa feed-forward. |
| 1:35 | L3: medir sin pensar → muerte; luego CNOT + H: ket pasa a |00⟩, X → |10⟩, victoria. |
| 2:10 | Debugger en IonQ Forte 1 simulator (ruido en las barras). Arquitectura en una frase. |
| 2:25 | Créditos + "This effort is supported by Qollab & IonQ". |

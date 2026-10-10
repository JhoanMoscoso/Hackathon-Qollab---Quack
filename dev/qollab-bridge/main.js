import * as engine from 'quantum.engine';
import { runProbe } from './probe.js';

const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const status = document.getElementById('status');
let x = 2, y = 2;
function draw() {
  context.fillStyle = '#141b26';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#58a6ff';
  context.fillRect(x * 32, y * 32, 28, 28);
}
canvas.addEventListener('click', () => canvas.focus());
canvas.addEventListener('keydown', (event) => {
  const movement = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] }[event.code];
  if (!movement) return;
  event.preventDefault();
  x = Math.max(0, Math.min(19, x + movement[0]));
  y = Math.max(0, Math.min(11, y + movement[1]));
  draw();
});
draw();
try {
  const report = await runProbe(engine, backend);
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  status.textContent = `Bridge works. E7 target: ${report.target_20ms_met ? 'met' : 'not met'}. `
    + `Backend states: ${report.precompute.backend_states}. Inspect sources; fallback is not remote success.`;
  console.log('QOLLAB BRIDGE REPORT', JSON.stringify(report));
} catch (error) {
  status.textContent = `Diagnostic failed: ${error.message}`;
  console.error(error);
}

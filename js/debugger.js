// Quantum debugger panel: ket, probability bars, circuit, status. The helpers at the top are pure
// (unit-tested); createDebugger() at the bottom is the only part that touches the DOM.
// Everything shown comes from the engine snapshot: nothing is computed here.

export const PROB_ORDER = ['00', '01', '10', '11'];
const PLAYER_NAMES = ['Alice', 'Bob'];

/** Probability bars in the fixed game order (JSON key order is not reliable). */
export function barData(probs) {
  return PROB_ORDER.map((key) => {
    const p = probs?.[key] ?? 0;
    return { label: `|${key}⟩`, key, p, pct: `${(p * 100).toFixed(1)}%` };
  });
}

/** One circuit column per history entry: ["h",0] | ["cx",c,t] | ["m",q,outcome]. */
export function circuitColumns(history) {
  const cols = [];
  for (const entry of history ?? []) {
    if (!Array.isArray(entry) || entry.length === 0) continue;
    const [name, a, b] = entry;
    if (name === 'cx') cols.push({ kind: 'cx', label: 'CX', control: a, target: b });
    else if (name === 'm') cols.push({ kind: 'm', label: 'M', qubit: a, outcome: b });
    else cols.push({ kind: 'gate', label: String(name).toUpperCase(), qubit: a });
  }
  return cols;
}

/** Concise screen-reader sentence for the aria-live region. */
export function liveText(snap, lastMeasure) {
  if (!snap) return '';
  const parts = [`State: ${snap.ket}.`];
  if (snap.bell_label) parts.push(`Bell state ${snap.bell_label}.`);
  if (lastMeasure) parts.push(`Measured ${PLAYER_NAMES[lastMeasure.qubit]} qubit: ${lastMeasure.outcome}.`);
  return parts.join(' ');
}

// ---------- DOM part ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
const COL_W = 44;
const WIRE_Y = [22, 62];
const LEFT = 78;

function svgEl(name, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function htmlEl(name, className, text) {
  const el = document.createElement(name);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function drawBox(svg, cx, y, label, cls) {
  svg.append(svgEl('rect', { x: cx - 14, y: y - 14, width: 28, height: 28, class: `c-box ${cls}` }));
  svg.append(svgEl('text', { x: cx, y: y + 5, 'text-anchor': 'middle', class: 'c-text' }, label));
}

function drawCircuit(svg, cols) {
  svg.replaceChildren();
  const width = LEFT + Math.max(cols.length, 4) * COL_W + 8;
  svg.setAttribute('viewBox', `0 0 ${width} 84`);
  svg.setAttribute('width', width);
  PLAYER_NAMES.forEach((name, q) => {
    svg.append(svgEl('line', { x1: 66, y1: WIRE_Y[q], x2: width - 4, y2: WIRE_Y[q], class: 'c-wire' }));
    svg.append(svgEl('text', { x: 2, y: WIRE_Y[q] + 4, class: 'c-label' }, `q${q} ${name}`));
  });
  cols.forEach((col, i) => {
    const cx = LEFT + i * COL_W + COL_W / 2;
    if (col.kind === 'gate') drawBox(svg, cx, WIRE_Y[col.qubit], col.label, 'c-gate');
    else if (col.kind === 'm') drawBox(svg, cx, WIRE_Y[col.qubit], `M${col.outcome}`, 'c-meas');
    else {
      svg.append(svgEl('line', { x1: cx, y1: WIRE_Y[col.control], x2: cx, y2: WIRE_Y[col.target], class: 'c-link' }));
      svg.append(svgEl('circle', { cx, cy: WIRE_Y[col.control], r: 5, class: 'c-dot' }));
      svg.append(svgEl('circle', { cx, cy: WIRE_Y[col.target], r: 11, class: 'c-xor' }));
      svg.append(svgEl('line', { x1: cx - 11, y1: WIRE_Y[col.target], x2: cx + 11, y2: WIRE_Y[col.target], class: 'c-xor-line' }));
      svg.append(svgEl('line', { x1: cx, y1: WIRE_Y[col.target] - 11, x2: cx, y2: WIRE_Y[col.target] + 11, class: 'c-xor-line' }));
    }
  });
}

/**
 * @param {HTMLElement} rootEl panel container (#debugger)
 * @param {HTMLElement} liveEl aria-live region (#a11y-live)
 */
export function createDebugger(rootEl, liveEl) {
  const title = htmlEl('h2', 'dbg-title', 'Quantum debugger');
  const ket = htmlEl('p', 'dbg-ket');
  ket.setAttribute('aria-label', 'Quantum state');
  const bars = htmlEl('ul', 'dbg-bars');
  bars.setAttribute('aria-label', 'Outcome probabilities');
  const barRows = PROB_ORDER.map((key) => {
    const row = htmlEl('li', 'dbg-bar');
    const label = htmlEl('span', 'dbg-bar-label', `|${key}⟩`);
    const track = htmlEl('span', 'dbg-bar-track');
    const fill = htmlEl('span', 'dbg-bar-fill');
    track.append(fill);
    const pct = htmlEl('span', 'dbg-bar-pct', '0.0%');
    row.append(label, track, pct);
    bars.append(row);
    return { fill, pct };
  });
  const circuitTitle = htmlEl('h3', 'dbg-sub', 'Circuit');
  const svg = svgEl('svg', { class: 'dbg-circuit', role: 'img', 'aria-label': 'Circuit diagram' });
  const stats = htmlEl('dl', 'dbg-stats');
  const stat = (name) => {
    const dt = htmlEl('dt', null, name);
    const dd = htmlEl('dd', null, '-');
    stats.append(dt, dd);
    return dd;
  };
  const gatesLeft = stat('Gates left');
  const bellEl = stat('Bell state');
  const entangledEl = stat('Entangled');
  const msg = htmlEl('p', 'dbg-msg');

  rootEl.replaceChildren(title, ket, bars, circuitTitle, svg, stats, msg);
  drawCircuit(svg, []);

  let lastLive = null;

  return {
    update(snap, { lastMeasure = null, error = null, note = null } = {}) {
      if (snap) {
        ket.textContent = snap.ket;
        barData(snap.probs).forEach((b, i) => {
          barRows[i].fill.style.width = `${(b.p * 100).toFixed(1)}%`;
          barRows[i].pct.textContent = b.pct;
        });
        const cols = circuitColumns(snap.history);
        drawCircuit(svg, cols);
        svg.setAttribute('aria-label', cols.length
          ? `Circuit: ${cols.map((c) => c.label + (c.kind === 'm' ? c.outcome : '')).join(', ')}`
          : 'Circuit: empty');
        gatesLeft.textContent = String(snap.gates_left);
        bellEl.textContent = snap.bell_label ?? 'none';
        entangledEl.textContent = snap.entangled ? 'yes' : 'no';
      }
      msg.textContent = error ? `Error: ${error}` : (note ?? '');
      msg.classList.toggle('is-error', !!error);
      const text = [liveText(snap, lastMeasure), note, error ? `Error: ${error}` : null].filter(Boolean).join(' ');
      if (text !== lastLive) {
        lastLive = text;
        liveEl.textContent = text;
      }
    },
  };
}

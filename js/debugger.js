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

const MEASURE_NAMES = new Set(['m', 'measure']);
const NON_CIRCUIT_ACTIONS = new Set(['send_bit', 'receive_bit', 'identity']);

function toColumns(entries, extra = {}) {
  const cols = [];
  for (const entry of entries ?? []) {
    if (!Array.isArray(entry) || entry.length === 0) continue;
    const [name, a, b] = entry;
    const key = String(name).toLowerCase();
    if (NON_CIRCUIT_ACTIONS.has(key)) continue; // classical protocol history is not a quantum gate
    if (key === 'run' || key === 'run_circuit') cols.push({ kind: 'run', label: 'RUN', ...extra });
    else if (key === 'cx') cols.push({ kind: 'cx', label: 'CX', control: a, target: b, ...extra });
    else if (MEASURE_NAMES.has(key)) cols.push({ kind: 'm', label: 'M', qubit: a, outcome: b, ...extra });
    else cols.push({ kind: 'gate', label: String(name).toUpperCase().slice(0, 3), qubit: a, ...extra });
  }
  return cols;
}

/**
 * One circuit column per entry: ["h",0] | ["cx",c,t] | ["m",q,outcome] | ["run"].
 * The stage's initial circuit comes first, flagged `prep: true` (drawn dimmed: it was prepared, not played).
 * Tolerant: "m"/"M"/"measure" are the same, a missing outcome keeps the label "M", and unknown
 * gate names get an uppercase label cut to 3 characters.
 */
export function circuitColumns(history, initialCircuit) {
  return [...toColumns(initialCircuit, { prep: true }), ...toColumns(history)];
}

const GATE_LABEL = (c) => (c.kind === 'm' ? `M${c.outcome ?? ''}` : c.label);
const colText = (c) => (c.kind === 'run' ? 'RUN barrier' : c.prep ? `prepared ${GATE_LABEL(c)}` : GATE_LABEL(c));

/** "backend" / "local" / "mixed": where the measurement odds for the current state come from. */
export function samplingLabel(snapSource, boot) {
  const src = snapSource ?? boot?.source;
  if (src === 'backend') return 'backend';
  if (src === 'mixed') return 'mixed';
  if (snapSource && boot?.source === 'mixed') return 'local (other states: backend)';
  return 'local';
}

const CIRCUIT_STATUS = {
  building: 'building', validated: 'validated ✓', measuring: 'measuring', complete: 'complete ✓', failed: 'failed',
};
const lockText = (unlocked) => (unlocked ? 'unlocked' : 'locked');

/**
 * Status rows under the circuit. Circuit / Measurement / Exits exist only for stages with a validated
 * preparation (snap.circuit_validation, snap.measurement_enabled, snap.exits_unlocked).
 */
export function statusRows(snap, boot) {
  if (!snap) return [];
  const rows = [];
  const validation = snap.circuit_validation;
  if (validation?.required) {
    rows.push({ name: 'Circuit', value: CIRCUIT_STATUS[validation.status] ?? validation.status ?? '-' });
  }
  if (typeof snap.measurement_enabled === 'boolean') {
    rows.push({ name: 'Measurement', value: lockText(snap.measurement_enabled) });
  }
  if (typeof snap.exits_unlocked === 'boolean') rows.push({ name: 'Exits', value: lockText(snap.exits_unlocked) });
  rows.push({ name: 'Objective', value: snap.objective?.status ?? '-' });
  rows.push({ name: 'Stage', value: `${(snap.stage_index ?? 0) + 1} / ${snap.stage_count ?? 1}` });
  rows.push({ name: 'Sampling', value: samplingLabel(snap.source, boot) });
  return rows;
}

const stateName = (snap) => snap.bell_label ?? String(snap.ket).replace(/^1(?=\|)/, ''); // engine prints a lone basis state as "1|00⟩"
const correlation = (label) => {
  if (label?.startsWith('Phi')) return 'results now always the same';
  if (label?.startsWith('Psi')) return 'results now always opposite';
  return null;
};
const EPS = 1e-6;
const sameMarginals = (a, b) => !!a && !!b && a.length === b.length
  && a.every((row, i) => row.every((v, j) => Math.abs(v - b[i][j]) < EPS));

/**
 * One English sentence about what a successful action did to the shared state.
 * action: { gate, qubit, target?, actor? } | { type: 'run' } | { type: 'measure', qubit, outcome }.
 * This is the answer to "the X gate seems to do nothing": X on Phi+ keeps every qubit 50/50, so the
 * map does not change, but the state does (Phi+ -> Psi+) and now the player is told.
 */
export function describeChange(prev, next, action = {}) {
  if (!prev || !next) return '';
  const q = action.qubit;
  if (action.type === 'run') return `Circuit validated: ${stateName(next)} ✓`;
  if (action.type === 'measure') return `${PLAYER_NAMES[q] ?? `q${q}`} measured q${q}: ${action.outcome}`;
  const gate = String(action.gate ?? '').toLowerCase();
  const actor = action.actor === 'alice' ? 'Alice' : action.actor === 'bob' ? 'Bob' : PLAYER_NAMES[q] ?? 'Someone';
  const head = gate === 'cx' ? 'CNOT applied' : `${actor} applied ${gate.toUpperCase()} to q${q}`;
  if (prev.ket === next.ket && prev.bell_label === next.bell_label) return `${head}: state unchanged (${stateName(next)})`;
  const notes = [];
  if (!prev.entangled && next.entangled) notes.push('entangled');
  const meaning = correlation(next.bell_label);
  if (meaning) notes.push(meaning);
  let text = `${head}: ${stateName(prev)} → ${stateName(next)}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  if (sameMarginals(prev.marginals, next.marginals) && next.marginals.some((row) => Math.abs(row[0] - 0.5) < EPS)) {
    text += '. Each qubit is still 50/50, so the doors keep their state';
  }
  return text;
}

/** Probability-bar keys whose value changed between two snapshots. */
export function changedBars(prev, next) {
  if (!prev || !next) return [];
  return PROB_ORDER.filter((key) => Math.abs((prev.probs?.[key] ?? 0) - (next.probs?.[key] ?? 0)) > EPS);
}

const HINTS = {
  CIRCUIT_NOT_VALIDATED: 'Build H then CX, then press Space to run.',
  CIRCUIT_INCOMPLETE: 'Build H then CX, then press Space to run.',
  INVALID_CIRCUIT: "Circuit isn't Phi+ yet — press R to reset.",
  CIRCUIT_LOCKED: 'Circuit already validated — measure now.',
  VALIDATION_NOT_REQUIRED: 'This stage has no run step.',
  STAGE_FINISHED: 'Stage finished — head to the exits.',
  INVALID_ACTOR: "That terminal isn't yours.",
  GATE_NOT_ALLOWED: "That terminal isn't yours.",
};

/**
 * Short player-facing hint for an engine error code; unknown codes keep the engine message.
 * `snap` (optional) refines STAGE_FINISHED: a failed stage must be retried, not exited.
 */
export function hintFor(code, message, snap = null) {
  if (code === 'STAGE_FINISHED' && snap?.objective?.status === 'failed') return 'Stage failed — press R to retry.';
  return HINTS[code] ?? message;
}

/**
 * Decides when the aria-live region should be (re)written. Identical text is announced once per user
 * action (the same action refreshes several times); `newAction()` forgets it so a repeated error
 * triggered by a new action is announced again.
 */
export function createLiveAnnouncer() {
  let last = null;
  return {
    next(text) {
      if (text === last) return null;
      last = text;
      return text;
    },
    newAction() { last = null; },
  };
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
const HIGHLIGHT_MS = 800;

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
  svg.setAttribute('width', width); // natural size; CSS may scale it up to the panel height, the wrapper scrolls sideways
  svg.setAttribute('height', 84);
  PLAYER_NAMES.forEach((name, q) => {
    svg.append(svgEl('line', { x1: 66, y1: WIRE_Y[q], x2: width - 4, y2: WIRE_Y[q], class: 'c-wire' }));
    svg.append(svgEl('text', { x: 2, y: WIRE_Y[q] + 4, class: 'c-label' }, `q${q} ${name}`));
  });
  cols.forEach((col, i) => {
    const cx = LEFT + i * COL_W + COL_W / 2;
    if (col.kind === 'run') { // full-height dashed barrier: nothing before it can change after it
      svg.append(svgEl('line', { x1: cx, y1: 14, x2: cx, y2: 82, class: 'c-run' }));
      svg.append(svgEl('text', { x: cx, y: 9, 'text-anchor': 'middle', class: 'c-run-text' }, 'RUN'));
      return;
    }
    const wires = col.kind === 'cx' ? [col.control, col.target] : [col.qubit];
    if (wires.some((w) => WIRE_Y[w] === undefined)) return; // malformed qubit index: skip, never NaN
    const g = svgEl('g', { class: col.prep ? 'c-col c-prep' : 'c-col' });
    if (col.kind === 'gate') drawBox(g, cx, WIRE_Y[col.qubit], col.label, 'c-gate');
    else if (col.kind === 'm') drawBox(g, cx, WIRE_Y[col.qubit], `M${col.outcome ?? ''}`, 'c-meas');
    else {
      g.append(svgEl('line', { x1: cx, y1: WIRE_Y[col.control], x2: cx, y2: WIRE_Y[col.target], class: 'c-link' }));
      g.append(svgEl('circle', { cx, cy: WIRE_Y[col.control], r: 5, class: 'c-dot' }));
      g.append(svgEl('circle', { cx, cy: WIRE_Y[col.target], r: 11, class: 'c-xor' }));
      g.append(svgEl('line', { x1: cx - 11, y1: WIRE_Y[col.target], x2: cx + 11, y2: WIRE_Y[col.target], class: 'c-xor-line' }));
      g.append(svgEl('line', { x1: cx, y1: WIRE_Y[col.target] - 11, x2: cx, y2: WIRE_Y[col.target] + 11, class: 'c-xor-line' }));
    }
    svg.append(g);
  });
}

/**
 * One debugger, two containers: the state panel (ket, bars, status, note) and the circuit panel.
 * @param {{ state: HTMLElement, circuit: HTMLElement }} roots #debugger-state and #debugger-circuit
 * @param {HTMLElement} liveEl aria-live region (#a11y-live)
 */
export function createDebugger({ state: stateEl, circuit: circuitEl }, liveEl) {
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
    return { row, fill, pct };
  });
  const circuitTitle = htmlEl('h2', 'dbg-title', 'Circuit');
  const svg = svgEl('svg', { class: 'dbg-circuit', role: 'img', 'aria-label': 'Circuit diagram' });
  const circuitWrap = htmlEl('div', 'dbg-circuit-wrap');
  circuitWrap.tabIndex = 0; // keyboard-scrollable when the circuit outgrows the panel
  circuitWrap.setAttribute('role', 'group');
  circuitWrap.setAttribute('aria-label', 'Circuit diagram (scrollable)');
  circuitWrap.append(svg);
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
  const statusEls = {};
  for (const name of ['Circuit', 'Measurement', 'Exits', 'Objective', 'Stage', 'Sampling']) {
    const dt = htmlEl('dt', null, name);
    const dd = htmlEl('dd', null, '-');
    stats.append(dt, dd);
    statusEls[name] = { dt, dd };
  }
  const msg = htmlEl('p', 'dbg-msg');

  stateEl.replaceChildren(title, ket, bars, stats, msg);
  circuitEl.replaceChildren(circuitTitle, circuitWrap);
  drawCircuit(svg, []);

  const announcer = createLiveAnnouncer();
  let highlightTimer = null;
  let liveTimer = null;

  function announce(text) {
    clearTimeout(liveTimer);
    if (liveEl.textContent === text) { // same text again: clear first so screen readers re-read it
      liveEl.textContent = '';
      liveTimer = setTimeout(() => { liveEl.textContent = text; }, 50);
    } else liveEl.textContent = text;
  }

  return {
    /** Call at the start of every user action so a repeated identical message is announced again. */
    newAction() { announcer.newAction(); },
    update(snap, { lastMeasure = null, error = null, note = null, prev = null, sampling = null } = {}) {
      if (snap) {
        ket.textContent = snap.ket;
        barData(snap.probs).forEach((b, i) => {
          barRows[i].fill.style.width = `${(b.p * 100).toFixed(1)}%`;
          barRows[i].pct.textContent = b.pct;
        });
        const cols = circuitColumns(snap.history, snap.initial_circuit);
        drawCircuit(svg, cols);
        svg.setAttribute('aria-label', cols.length ? `Circuit: ${cols.map(colText).join(', ')}` : 'Circuit: empty');
        gatesLeft.textContent = String(snap.gates_left);
        bellEl.textContent = snap.bell_label ?? 'none';
        entangledEl.textContent = snap.entangled ? 'yes' : 'no';
        const rows = Object.fromEntries(statusRows(snap, sampling).map((r) => [r.name, r.value]));
        for (const [name, { dt, dd }] of Object.entries(statusEls)) {
          dt.hidden = dd.hidden = !(name in rows);
          dd.textContent = rows[name] ?? '-';
        }
        const changed = changedBars(prev, snap);
        if (changed.length) { // highlight what the last action changed; static class, no animation
          clearTimeout(highlightTimer);
          PROB_ORDER.forEach((key, i) => barRows[i].row.classList.toggle('is-changed', changed.includes(key)));
          highlightTimer = setTimeout(() => barRows.forEach((r) => r.row.classList.remove('is-changed')), HIGHLIGHT_MS);
        }
      }
      msg.textContent = error ? `Error: ${error}` : (note ?? '');
      msg.classList.toggle('is-error', !!error);
      const text = [liveText(snap, lastMeasure), note, error ? `Error: ${error}` : null].filter(Boolean).join(' ');
      const toAnnounce = announcer.next(text);
      if (toAnnounce !== null) announce(toAnnounce);
    },
  };
}

// DEV ONLY: tiny 2-qubit statevector mock of quantum/engine.py (docs/03-spec-motor-cuantico.md).
// Not shipped to Qollab (excluded by scripts/pack-qollab.sh). Every export mimics a Pyodide
// function: { callPromising: async (...args) => JSON string }.
//
// Convention: amplitude index = q0*2 + q1 (q0 = Alice = left bit, q1 = Bob = right bit).

const EPS = 1e-9;
const SQ = Math.SQRT1_2;
const LABELS = ['00', '01', '10', '11'];
const MASK = [2, 1]; // bit mask of qubit k inside the amplitude index

// Module-level session state.
const levelCache = new Map();
let rng = Math.random;
let level = null;
let amps = null;     // [[re, im] x 4]
let history = [];
let measured = [null, null];
let gatesUsed = 0;

// ---------- test-only hooks (not part of the engine contract) ----------
/** TEST ONLY: replace the RNG used by measure(). Pass nothing to restore Math.random. */
export function __setRng(fn) { rng = fn ?? Math.random; }
/** TEST ONLY: register a level object so load_level(id) works without fetch. */
export function __loadLevelObject(obj) { levelCache.set(obj.id, { ...obj, num_qubits: 2 }); }

// ---------- statevector maths ----------
function basis00() { return [[1, 0], [0, 0], [0, 0], [0, 0]]; }

// Apply a 2x2 complex matrix [[a,b],[c,d]] (each entry [re,im]) to qubit k.
function apply1(m, k) {
  const mask = MASK[k];
  const next = amps.map((a) => [...a]);
  for (let i = 0; i < 4; i++) {
    if (i & mask) continue;
    const j = i | mask;
    const [a0, a1] = [amps[i], amps[j]];
    next[i] = add(mul(m[0][0], a0), mul(m[0][1], a1));
    next[j] = add(mul(m[1][0], a0), mul(m[1][1], a1));
  }
  amps = next;
}
const mul = ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br];
const add = ([ar, ai], [br, bi]) => [ar + br, ai + bi];

const R = (x) => [x, 0];
const MATS = {
  h: [[R(SQ), R(SQ)], [R(SQ), R(-SQ)]],
  x: [[R(0), R(1)], [R(1), R(0)]],
  z: [[R(1), R(0)], [R(0), R(-1)]],
};

function applyCx(control, target) {
  const cm = MASK[control];
  const tm = MASK[target];
  const next = amps.map((a) => [...a]);
  for (let i = 0; i < 4; i++) if (i & cm) next[i] = amps[i ^ tm];
  amps = next;
}

function applyRaw(gate, q, t) {
  if (gate === 'cx') applyCx(q, t); else apply1(MATS[gate], q);
}

const prob = (a) => a[0] * a[0] + a[1] * a[1];

// ---------- snapshot ----------
const r3 = (x) => Math.round(x * 1000) / 1000;
const clean = (x) => (Object.is(x, -0) ? 0 : x);

// Format one complex coefficient. Returns { neg, text } (text without sign; '' means 1).
function coef([re, im]) {
  const r = r3(re), i = r3(im);
  if (Math.abs(i) < 1e-9) return { neg: r < 0, text: Math.abs(r) === 1 ? '' : String(Math.abs(r)) };
  if (Math.abs(r) < 1e-9) return { neg: i < 0, text: (Math.abs(i) === 1 ? '' : String(Math.abs(i))) + 'i' };
  return { neg: false, text: `(${r}${i < 0 ? '-' : '+'}${Math.abs(i)}i)` };
}

function ketString() {
  let out = '';
  amps.forEach((a, idx) => {
    if (prob(a) < EPS) return;
    const { neg, text } = coef(a);
    const term = `${text}|${LABELS[idx]}⟩`;
    if (!out) out = (neg ? '-' : '') + term;
    else out += (neg ? ' - ' : ' + ') + term;
  });
  return out;
}

// Stable key: remove global phase (first non-zero amplitude real positive), round, join.
function stateKey() {
  const first = amps.find((a) => prob(a) > EPS) ?? [1, 0];
  const mag = Math.hypot(first[0], first[1]);
  const ph = [first[0] / mag, -first[1] / mag]; // conj of unit phase
  return amps
    .map((a) => {
      const [re, im] = mul(a, ph);
      return `${clean(Math.round(re * 1e6) / 1e6) + 0},${clean(Math.round(im * 1e6) / 1e6) + 0}`;
    })
    .join(';');
}

// |<bell|psi>|^2 >= 1 - 1e-6 means "equal modulo global phase" (tolerance 1e-6).
function bellLabel() {
  const bells = {
    'Phi+': [SQ, 0, 0, SQ],
    'Phi-': [SQ, 0, 0, -SQ],
    'Psi+': [0, SQ, SQ, 0],
    'Psi-': [0, SQ, -SQ, 0],
  };
  for (const [name, v] of Object.entries(bells)) {
    let re = 0, im = 0;
    amps.forEach((a, i) => { re += v[i] * a[0]; im += v[i] * a[1]; });
    if (Math.sqrt(re * re + im * im) > 1 - 1e-6) return name;
  }
  return null;
}

// Purity tr(rho0^2) of the reduced state of q0; < 1 means entangled.
function isEntangled() {
  let purity = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      // rho0[i][j] = sum_k psi[i,k] * conj(psi[j,k])
      let re = 0, im = 0;
      for (let k = 0; k < 2; k++) {
        const a = amps[i * 2 + k], b = amps[j * 2 + k];
        re += a[0] * b[0] + a[1] * b[1];
        im += a[1] * b[0] - a[0] * b[1];
      }
      purity += re * re + im * im;
    }
  }
  return purity < 1 - EPS;
}

function snap() {
  const p = amps.map(prob);
  const probs = {};
  LABELS.forEach((l, i) => { probs[l] = p[i]; });
  const marginals = [
    [p[0] + p[1], p[2] + p[3]],
    [p[0] + p[2], p[1] + p[3]],
  ];
  const objects = {};
  for (const [name, def] of Object.entries(level.objects ?? {})) {
    const p1 = marginals[def.qubit][1];
    objects[name] = p1 < EPS ? '0' : p1 > 1 - EPS ? '1' : 'super';
  }
  return {
    num_qubits: 2,
    ket: ketString(),
    amplitudes: amps.map(([re, im]) => [clean(re), clean(im)]),
    probs,
    marginals,
    measured: [...measured],
    entangled: isEntangled(),
    bell_label: bellLabel(),
    history: history.map((h) => [...h]),
    gates_left: level.max_gates - gatesUsed,
    state_key: stateKey(),
    objects,
  };
}

// ---------- session ----------
function prepare() {
  amps = basis00();
  history = [];
  measured = [null, null];
  gatesUsed = 0;
  for (const step of level.initial_circuit ?? []) {
    const [g, q, t] = step;
    applyRaw(g, q, t);
    history.push([...step]);
  }
}

const err = (message) => ({ error: message });

async function fetchLevel(id) {
  if (levelCache.has(id)) return levelCache.get(id);
  const res = await fetch(new URL('../levels/' + id + '.json', import.meta.url));
  if (!res.ok) throw new Error(`level "${id}" not found (HTTP ${res.status})`);
  const obj = { ...(await res.json()), num_qubits: 2 };
  levelCache.set(id, obj);
  return obj;
}

// Wrap a handler: returns { callPromising } producing a JSON string; thrown errors -> {"error"}.
const wrap = (fn) => ({
  callPromising: async (...args) => {
    try { return JSON.stringify(await fn(...args)); }
    catch (e) { return JSON.stringify(err(String(e?.message ?? e))); }
  },
});

export const load_level = wrap(async (id) => fetchLevel(id));

export const new_session = wrap(async (id) => {
  const lv = levelCache.get(id);
  if (!lv) return err(`level "${id}" not loaded (call load_level first)`);
  level = lv;
  prepare();
  return snap();
});

export const reset_level = wrap(async () => {
  if (!level) return err('no active session');
  prepare();
  return snap();
});

export const snapshot = wrap(async () => (level ? snap() : err('no active session')));

export const apply_gate = wrap(async (gate, qubit, target = -1) => {
  if (!level) return err('no active session');
  if (!['h', 'x', 'z', 'cx'].includes(gate)) return err(`unknown gate "${gate}"`);
  const gs = level.gate_set ?? {};
  if (gate === 'cx') {
    if (qubit !== 0 || target !== 1) return err('cx requires control 0 and target 1');
    if (!(gs.shared ?? []).includes('cx')) return err('cx not in gate set');
  } else {
    if (qubit !== 0 && qubit !== 1) return err(`invalid qubit ${qubit}`);
    const owner = qubit === 0 ? 'alice' : 'bob';
    if (!(gs[owner] ?? []).includes(gate)) return err(`gate "${gate}" not allowed for ${owner}`);
  }
  if (gatesUsed >= level.max_gates) return err('gate budget exhausted');
  const involved = gate === 'cx' ? [0, 1] : [qubit];
  for (const q of involved) if (measured[q] !== null) return err(`qubit ${q} already measured`);
  applyRaw(gate, qubit, target);
  gatesUsed += 1;
  history.push(gate === 'cx' ? ['cx', qubit, target] : [gate, qubit]);
  return snap();
});

export const measure = wrap(async (qubit) => {
  if (!level) return err('no active session');
  if (qubit !== 0 && qubit !== 1) return err(`invalid qubit ${qubit}`);
  if (measured[qubit] !== null) return err(`qubit ${qubit} already measured`);
  const mask = MASK[qubit];
  const p1 = amps.reduce((s, a, i) => s + (i & mask ? prob(a) : 0), 0);
  const outcome = p1 < EPS ? 0 : p1 > 1 - EPS ? 1 : rng() < p1 ? 1 : 0;
  // Project and renormalise.
  const norm = Math.sqrt(outcome ? p1 : 1 - p1);
  amps = amps.map((a, i) => (((i & mask) ? 1 : 0) === outcome ? [a[0] / norm, a[1] / norm] : [0, 0]));
  measured[qubit] = outcome;
  history.push(['m', qubit, outcome]);
  return { qubit, outcome, snapshot: snap() };
});

export const precompute = wrap(async () => ({ states: 0, circuits: 0, source: 'mock', backend: 'mock' }));

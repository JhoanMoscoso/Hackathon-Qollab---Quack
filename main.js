// Bootstrap only: wires engine -> state machine -> input -> entities -> render/debugger.
// IDENTICAL in dev and on Qollab ('quantum.engine' is the Python module there, an import map
// to js/mock_engine.js in dev/index.html). Engine calls happen on events only, never per frame.
import * as engine from 'quantum.engine';
import { createStateMachine, STATES } from './js/state.js';
import { parseLevel } from './js/grid.js';
import { createWorld, resetWorld, stepPlayer, interact, consumeTerminal, checkWin, hazardCheck } from './js/entities.js';
import { createInput } from './js/input.js';
import { createRenderer } from './js/render.js';
import { createDebugger } from './js/debugger.js';
import { loadSprites } from './js/sprite_loader.js';

const LEVEL_ID = 'test';
const DEATH_MS = 1000;
const $ = (id) => document.getElementById(id);
const NOTES = {
  wrong_owner: 'This terminal belongs to the other player.',
  terminal_used: 'This terminal is used up.',
  cnot_needs_both: 'CNOT needs Alice on the control and Bob on the target.',
  superposition: 'Blocked: that door is in superposition.',
  closed: 'Blocked: that door is closed.',
};

const canvas = $('canvas');
const dbg = createDebugger($('debugger'), $('a11y-live'));
const reduceBox = $('reduce-motion');
reduceBox.checked = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const renderer = createRenderer(canvas, { reduceMotion: reduceBox.checked });

let level = null, grid = null, world = null, snap = null, lastMeasure = null;
let input = null, mode = '1p', overlay = null, busy = false;
let lastError = null;   // last engine error, shown in the debugger until the next successful call or move
let epoch = 0;          // bumped on every state change and level reset; async results from an older epoch are dropped
let deathTimer = null;
let pending = [];       // non-move intents that arrived while an engine call was in flight
const PENDING_CAP = 4;

// ---------- engine ----------
/** Returns the parsed result, or null on error (then `lastError` is set). Never touches game state itself. */
async function call(name, ...args) {
  try {
    const out = JSON.parse(await engine[name].callPromising(...args));
    if (out?.error) throw new Error(out.error);
    lastError = null;
    return out;
  } catch (e) {
    lastError = String(e?.message ?? e);
    refresh();
    return null;
  }
}
const refresh = (note = null) => dbg.update(snap, { lastMeasure, note, error: lastError });

function showMenuError(msg) {
  const el = $('menu-error');
  el.textContent = msg ? `Error: ${msg}` : '';
  el.hidden = !msg;
}

// ---------- screens / state ----------
const SCREENS = { loading: 'loading', menu: 'menu', level: 'game', dead: 'game', win: 'game' };
const focusTarget = () => (SCREENS[sm.state] === 'game' ? canvas : $(sm.state === 'menu' ? 'menu-title' : 'loading'));

const sm = createStateMachine({
  initial: STATES.LOADING,
  onEnter(next) {
    epoch++;
    pending = [];
    if (next !== 'dead') { clearTimeout(deathTimer); deathTimer = null; }
    for (const id of new Set(Object.values(SCREENS))) $(id).hidden = id !== SCREENS[next];
    overlay = next === 'dead' || next === 'win' ? next : null;
    if (next === 'menu') { input?.dispose(); input = null; }
    if (next === 'level') showMenuError(null);
    if ($('click-to-play').hidden) focusTarget().focus();
  },
});

function newInput() {
  input?.dispose(); // fresh queue, held keys and active player
  input = createInput(window, { mode });
}

async function startGame(chosen) {
  if (busy) return;
  busy = true;
  showMenuError(null);
  try {
    mode = chosen;
    const ep = epoch;
    const s = await call('new_session', LEVEL_ID);
    if (ep !== epoch) return;
    if (!s) { showMenuError(lastError); return; } // stay in the menu, visibly
    snap = s; lastMeasure = null;
    world = createWorld(grid);
    newInput();
    sm.setState(STATES.LEVEL);
    refresh('Level started.');
  } finally { busy = false; }
}

/** @returns {Promise<'ok'|'error'|'stale'>} */
async function resetLevel(note) {
  const ep = ++epoch;
  pending = [];
  const s = await call('reset_level');
  if (ep !== epoch) return 'stale';
  if (!s) return 'error';
  snap = s; lastMeasure = null;
  resetWorld(world);
  newInput();
  refresh(note);
  return 'ok';
}

async function restartLevel() {
  busy = true;
  try { await resetLevel('Level restarted.'); } finally { busy = false; }
}

function die() {
  sm.setState(STATES.DEAD);
  refresh('Wavefunction collapsed. Restarting the level.');
  deathTimer = setTimeout(async () => {
    deathTimer = null;
    if (sm.state !== 'dead') return;
    busy = true;
    let result;
    try { result = await resetLevel('Level restarted.'); } finally { busy = false; }
    if (sm.state !== 'dead' || result === 'stale') return;
    if (result === 'ok') sm.setState(STATES.LEVEL);
    else { // reset failed: do not hang on the death overlay, report it in the menu
      const msg = lastError;
      sm.setState(STATES.MENU);
      showMenuError(msg);
    }
  }, DEATH_MS);
}

// ---------- gameplay ----------
async function runIntent(intent, ep) {
  lastError = null; // a new action clears the previous engine error
  if (intent.type === 'switch') return refresh(`Controlling ${input.active === 'alice' ? 'Alice' : 'Bob'}.`);
  const events = intent.type === 'move'
    ? stepPlayer(world, intent.player, intent.dx, intent.dy, snap)
    : interact(world, intent.player, snap);
  let note = null;
  for (const ev of events) {
    if (ev.type === 'death') return die();
    if (ev.type === 'blocked') note = NOTES[ev.reason] ?? null;
    else if (ev.type === 'info') note = NOTES[ev.reason];
    else if (ev.type === 'measure') {
      const r = await call('measure', ev.qubit);
      if (ep !== epoch) return; // Esc / restart while the call was in flight: drop the result
      if (r) { snap = r.snapshot; lastMeasure = { qubit: r.qubit, outcome: r.outcome }; }
    } else if (ev.type === 'gate') {
      const s = await call('apply_gate', ev.gate, ev.qubit);
      if (ep !== epoch) return;
      if (s) { snap = s; consumeTerminal(ev.terminal); }
    } else if (ev.type === 'cnot') {
      const s = await call('apply_gate', 'cx', ev.control, ev.target);
      if (ep !== epoch) return;
      if (s) snap = s;
    }
  }
  if (events.length) refresh(note);
  if (hazardCheck(world, snap).length) return die();
  if (checkWin(world, snap, level.win)) {
    sm.setState(STATES.WIN);
    refresh('Level complete. Press Enter to return to the menu.');
  }
}

async function runIntents(intents) {
  busy = true;
  const ep = epoch;
  try {
    for (const intent of intents) {
      if (sm.state !== 'level' || ep !== epoch) break;
      await runIntent(intent, ep);
    }
  } finally { busy = false; }
}

function frame(t) {
  requestAnimationFrame(frame);
  if (sm.state === 'level' && input) {
    const intents = input.poll();
    if (busy) { // keep a few interact/switch intents for later; moves are dropped (held keys repeat anyway)
      for (const i of intents) if (i.type !== 'move' && pending.length < PENDING_CAP) pending.push(i);
    } else if (pending.length || intents.length) {
      const run = [...pending, ...intents];
      pending = [];
      runIntents(run);
    }
  }
  if (world && snap && SCREENS[sm.state] === 'game') {
    renderer.draw(world, snap, { mode, active: input?.active ?? 'alice', overlay }, t);
  }
}

// ---------- UI wiring ----------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const s = sm.state;
  // Esc works even while an engine call is in flight: the epoch guard drops its late result.
  if (e.code === 'Escape' && (s === 'level' || s === 'dead' || s === 'win')) sm.setState(STATES.MENU);
  else if (busy) return;
  else if (s === 'level' && e.code === 'KeyR') restartLevel();
  else if (s === 'win' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); sm.setState(STATES.MENU); }
});
$('start-1p').addEventListener('click', () => startGame('1p'));
$('start-2p').addEventListener('click', () => startGame('2p'));
reduceBox.addEventListener('change', () => renderer.setReduceMotion(reduceBox.checked));
$('click-to-play').addEventListener('click', (e) => {
  e.currentTarget.hidden = true;
  focusTarget().focus();
});

(async () => {
  requestAnimationFrame(frame);
  // Sprites decode in parallel with the engine; loadSprites never rejects, so a failure only means procedural art.
  [level] = await Promise.all([call('load_level', LEVEL_ID), loadSprites()]);
  if (!level) { $('load-status').textContent = `Error: ${lastError}`; return; }
  try { grid = parseLevel(level); } catch (e) { $('load-status').textContent = `Error: ${e.message}`; return; }
  sm.setState(STATES.MENU);
})();

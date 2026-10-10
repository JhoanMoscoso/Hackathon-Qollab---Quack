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

// ---------- engine ----------
async function call(name, ...args) {
  try {
    const out = JSON.parse(await engine[name].callPromising(...args));
    if (out?.error) throw new Error(out.error);
    return out;
  } catch (e) {
    const msg = String(e?.message ?? e);
    $('load-status').textContent = `Error: ${msg}`;
    dbg.update(snap, { lastMeasure, error: msg });
    return null;
  }
}
const refresh = (note = null) => dbg.update(snap, { lastMeasure, note });

// ---------- screens / state ----------
const SCREENS = { loading: 'loading', menu: 'menu', level: 'game', dead: 'game', win: 'game' };
const focusTarget = () => (SCREENS[sm.state] === 'game' ? canvas : $(sm.state === 'menu' ? 'menu-title' : 'loading'));

const sm = createStateMachine({
  initial: STATES.LOADING,
  onEnter(next) {
    for (const id of new Set(Object.values(SCREENS))) $(id).hidden = id !== SCREENS[next];
    overlay = next === 'dead' || next === 'win' ? next : null;
    if (next === 'menu') { input?.dispose(); input = null; }
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
  mode = chosen;
  const s = await call('new_session', LEVEL_ID);
  busy = false;
  if (!s) return;
  snap = s; lastMeasure = null;
  world = createWorld(grid);
  newInput();
  sm.setState(STATES.LEVEL);
  refresh('Level started.');
}

async function resetLevel(note) {
  const s = await call('reset_level');
  if (!s) return false;
  snap = s; lastMeasure = null;
  resetWorld(world);
  newInput();
  refresh(note);
  return true;
}

function die() {
  sm.setState(STATES.DEAD);
  refresh('Wavefunction collapsed. Restarting the level.');
  setTimeout(async () => {
    if (sm.state !== 'dead') return;
    busy = true;
    const ok = await resetLevel('Level restarted.');
    busy = false;
    if (ok && sm.state === 'dead') sm.setState(STATES.LEVEL);
  }, DEATH_MS);
}

// ---------- gameplay ----------
async function runIntent(intent) {
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
      if (r) { snap = r.snapshot; lastMeasure = { qubit: r.qubit, outcome: r.outcome }; }
    } else if (ev.type === 'gate') {
      const s = await call('apply_gate', ev.gate, ev.qubit);
      if (s) { snap = s; consumeTerminal(ev.terminal); }
    } else if (ev.type === 'cnot') {
      const s = await call('apply_gate', 'cx', ev.control, ev.target);
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
  try {
    for (const intent of intents) {
      if (sm.state !== 'level') break;
      await runIntent(intent);
    }
  } finally { busy = false; }
}

function frame(t) {
  requestAnimationFrame(frame);
  if (sm.state === 'level' && input) {
    const intents = input.poll();
    if (!busy && intents.length) runIntents(intents); // intents arriving while busy are dropped
  }
  if (world && snap && SCREENS[sm.state] === 'game') {
    renderer.draw(world, snap, { mode, active: input?.active ?? 'alice', overlay }, t);
  }
}

// ---------- UI wiring ----------
window.addEventListener('keydown', (e) => {
  if (e.repeat || busy) return;
  const s = sm.state;
  if (e.code === 'Escape' && (s === 'level' || s === 'dead' || s === 'win')) sm.setState(STATES.MENU);
  else if (s === 'level' && e.code === 'KeyR') resetLevel('Level restarted.');
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
  level = await call('load_level', LEVEL_ID);
  if (!level) return;
  try { grid = parseLevel(level); } catch (e) { $('load-status').textContent = `Error: ${e.message}`; return; }
  sm.setState(STATES.MENU);
})();

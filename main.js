// Bootstrap only: wires engine -> state machine -> input -> entities -> render/debugger.
// IDENTICAL in dev and on Qollab ('quantum.engine' is the Python module there, an import map
// to dev/engine_bridge.js in dev/index.html). Engine calls happen on events only, never per frame.
import * as engine from 'quantum.engine';
import { createStateMachine, STATES } from './js/state.js';
import { parseLevel } from './js/grid.js';
import { stageView } from './js/level_adapter.js';
import {
  createWorld, resetWorld, stepPlayer, interact, consumeTerminal, syncTerminalUses, stageComplete, objectiveFailed, hazardCheck,
  sensorsUnderPlayers,
} from './js/entities.js';
import { createInput } from './js/input.js';
import { createRenderer } from './js/render.js';
import { fitCanvas, debounce } from './js/layout.js';
import { createDebugger, describeChange, hintFor } from './js/debugger.js';
import { loadSprites } from './js/sprite_loader.js';
import { withTimeout } from './js/async_util.js';

/* global backend -- Qollab provides the quantum backend as a global; dev/index.html defines a stub. */
const DEFAULT_LEVEL = 'level1';
const DEATH_MS = 1000;
const RETRY_MS = 1000; // how long a failed retry_stage result stays visible before the stage resets
const PRECOMPUTE_SHOTS = 200;
const PRECOMPUTE_TIMEOUT_MS = 45_000; // how long boot waits for the one backend submission before opening the menu
const SLOW_BACKEND_NOTE = 'Quantum backend is slow — using local sampling until it finishes.';
const $ = (id) => document.getElementById(id);
const FEED_FORWARD_HINTS = {
  prepare_bob: 'Bob: apply X to q1, then measure it.',
  measure_bob: 'Bob: measure q1 on the sensor.',
  send_bit: 'Bob: send the measured bit to Alice (B).',
  receive_bit: 'Alice: receive Bob’s classical bit (V).',
  correct_alice: 'Alice: apply X only for bit 0; use Keep (I) only for bit 1 (I).',
  measure_alice: 'Alice: measure q0 on the sensor.',
  complete: 'Both qubits are measured. Reach the open exits.',
};
const NOTES = {
  wrong_owner: 'This terminal belongs to the other player.',
  terminal_used: 'This terminal is used up.',
  cnot_needs_both: 'CNOT needs Alice on the control and Bob on the target.',
  superposition: 'Blocked: that door is in superposition.',
  closed: 'Blocked: that door is closed.',
  measurement_locked: 'Sensors are locked. Build H then CX, then press Space to run.',
};

const canvas = $('canvas');
const dbg = createDebugger({ state: $('debugger-state'), circuit: $('debugger-circuit') }, $('a11y-live'));
const reduceBox = $('reduce-motion');
reduceBox.checked = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const renderer = createRenderer(canvas, { reduceMotion: reduceBox.checked });

// ---------- canvas fit ----------
// The board cell (CSS decides its size) holds the canvas, which CSS cannot size to "largest 5:3 that fits" alone.
// The CSS size follows the cell at once; the backing store (an integer multiple of 640x384, matched to
// size x devicePixelRatio) is debounced because resizing a canvas clears it. render.draw() keeps logical coords.
const board = canvas.parentElement;
function fitCanvasToBoard(applyScale) {
  const w = board.clientWidth, h = board.clientHeight;
  if (!w || !h) return; // game screen hidden
  const fitted = fitCanvas({ availW: w, availH: h, dpr: globalThis.devicePixelRatio || 1 });
  canvas.style.width = `${fitted.cssW}px`;
  canvas.style.height = `${fitted.cssH}px`;
  if (applyScale) renderer.setScale(fitted.scale);
}
const refitDebounced = debounce(() => fitCanvasToBoard(true), 100);
const onBoardResize = () => { fitCanvasToBoard(false); refitDebounced(); };
window.addEventListener('resize', onBoardResize);
if (typeof ResizeObserver === 'function') new ResizeObserver(onBoardResize).observe(board);

let level = null, grid = null, world = null, snap = null, lastMeasure = null;
let input = null, mode = '1p', overlay = null, busy = false;
let lastError = null;   // last engine error (as a short hint), shown in the debugger until the next successful call or move
let overlayMessage;     // optional second line of the dead/win overlay
const levelCache = new Map(); // level id -> parsed engine level (load_level runs once per id)
let bootSampling = null;      // summary of the one boot-time precompute, shown by the debugger
let precomputeStarted = false;
let epoch = 0;          // bumped on every state change and level reset; async results from an older epoch are dropped
let deathTimer = null;
let pending = [];       // non-move intents that arrived while an engine call was in flight
const PENDING_CAP = 4;

// ---------- engine ----------
/** Returns the parsed result, or null on error (then `lastError` is set). Never touches game state itself. */
async function call(name, ...args) {
  try {
    const out = JSON.parse(await engine[name].callPromising(...args));
    if (out?.error) throw Object.assign(new Error(out.error), { code: out.code });
    lastError = null;
    return out;
  } catch (e) {
    lastError = hintFor(e?.code, String(e?.message ?? e), snap);
    refresh();
    return null;
  }
}
/** `prev` = the snapshot before the action that produced `snap`: the debugger highlights the bars that changed. */
function refreshProtocolConsole() {
  const protocol = snap?.feed_forward;
  const consoleEl = $('classical-console');
  consoleEl.hidden = !protocol;
  if (protocol) {
    $('protocol-hint').textContent = FEED_FORWARD_HINTS[protocol.phase] ?? 'Follow the Bell Block protocol.';
    const value = snap.classical_channel?.received ? String(snap.classical_channel.value) : 'hidden until Alice receives the bit';
    $('classical-value').lastElementChild.textContent = value;
    $('send-bit').disabled = busy || protocol.phase !== 'send_bit';
    $('receive-bit').disabled = busy || protocol.phase !== 'receive_bit';
    $('keep-identity').disabled = busy || protocol.phase !== 'correct_alice' || protocol.required_correction !== 'i';
  }
}

const refresh = (note = null, prev = null) => {
  if (world && snap) syncTerminalUses(world, snap); // engine is the source of truth for terminal uses
  refreshProtocolConsole();
  dbg.update(snap, { lastMeasure, note, error: lastError, prev, sampling: bootSampling });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadLevelCached(id) {
  if (!levelCache.has(id)) {
    const l = await call('load_level', id);
    if (l) levelCache.set(id, l);
  }
  return levelCache.get(id) ?? null;
}

/** One backend submission per page load (never per level). Failure is non-fatal: sampling stays local. */
async function precomputeOnce() {
  if (precomputeStarted) return;
  precomputeStarted = true;
  if (typeof backend === 'undefined' || !backend) return;
  const out = await call('precompute', backend, PRECOMPUTE_SHOTS);
  const failure = lastError;
  lastError = null;
  bootSampling = out
    ? { source: out.source, backend: out.backend, submitted_states: out.submitted_states, reason: out.reason }
    : { source: 'statevector_fallback', backend: null, submitted_states: 0, reason: failure };
}

/** Flat stage view -> grid -> world for the snapshot's current stage. */
function buildWorld() {
  grid = parseLevel(stageView(level, snap.stage_index ?? 0));
  world = createWorld(grid);
}

function showMenuNote(msg) {
  const el = $('menu-note');
  el.textContent = msg ?? '';
  el.hidden = !msg;
}

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
    if (SCREENS[next] === 'game') fitCanvasToBoard(true);
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
    const id = document.querySelector('input[name="level"]:checked')?.value ?? DEFAULT_LEVEL;
    const lvl = await loadLevelCached(id);
    if (ep !== epoch) return;
    if (!lvl) { showMenuError(lastError); return; }
    const s = await call('new_session', id);
    if (ep !== epoch) return;
    if (!s) { showMenuError(lastError); return; } // stay in the menu, visibly
    try {
      level = lvl; snap = s;
      buildWorld();
    } catch (e) { showMenuError(e.message); return; }
    lastMeasure = null;
    overlayMessage = undefined;
    newInput();
    sm.setState(STATES.LEVEL);
    refresh(`${lvl.title ?? id} started.`);
  } finally { busy = false; refreshProtocolConsole(); }
}

/**
 * Restart the current stage (the stage index is kept) through the given engine reset call.
 * @returns {Promise<'ok'|'error'|'stale'>}
 */
async function resetStage(note) {
  const ep = ++epoch;
  pending = [];
  const s = await call('reset_stage');
  if (ep !== epoch) return 'stale';
  if (!s) return 'error';
  snap = s; lastMeasure = null;
  resetWorld(world);
  newInput();
  refresh(note);
  return 'ok';
}

async function restartStage() {
  busy = true;
  try { await resetStage('Stage reset.'); } finally { busy = false; refreshProtocolConsole(); }
}

function die() {
  overlayMessage = 'Restarting stage...';
  sm.setState(STATES.DEAD);
  refresh('Wavefunction collapsed. Restarting the stage.');
  deathTimer = setTimeout(async () => {
    deathTimer = null;
    if (sm.state !== 'dead') return;
    busy = true;
    let result;
    try { result = await resetStage('Stage restarted.'); } finally { busy = false; refreshProtocolConsole(); }
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
/** retry_stage failure (e.g. L1 results differ): keep the result visible briefly, then reset the stage. */
async function handleFailure(ep) {
  if (snap.objective?.failure_policy === 'death') return die();
  refresh('Results differ. Resetting the stage…');
  await sleep(RETRY_MS);
  if (ep !== epoch || sm.state !== 'level') return;
  await resetStage('Results differ. Stage reset.');
}

/** Both players on their exits with a ready objective: next stage, or the win screen on the last one. */
async function handleComplete(ep) {
  const done = snap.stage_index ?? 0;
  if (done < (snap.stage_count ?? 1) - 1) {
    const s = await call('advance_stage');
    if (ep !== epoch || !s) return;
    epoch++; pending = []; // the old world is gone: drop everything still in flight
    snap = s; lastMeasure = null;
    try { buildWorld(); } catch (e) { sm.setState(STATES.MENU); showMenuError(e.message); return; }
    newInput();
    refresh(`Stage ${done + 1} complete. Stage ${done + 2}: ${level.stages?.[snap.stage_index]?.title ?? ''}`);
    return;
  }
  overlayMessage = undefined;
  sm.setState(STATES.WIN);
  refresh('Level complete. Press Enter to return to the menu.');
}

async function runIntent(intent, ep) {
  lastError = null; // a new action clears the previous engine error
  dbg.newAction();  // ...and lets an identical message be announced again
  if (intent.type === 'switch') return refresh(`Controlling ${input.active === 'alice' ? 'Alice' : 'Bob'}.`);
  let events;
  if (intent.type === 'protocol') {
    const fn = { send_bit: 'send_bit', receive_bit: 'receive_bit', identity: 'confirm_identity' }[intent.action];
    const args = intent.action === 'send_bit' ? ['bob'] : intent.action === 'receive_bit' ? ['alice'] : ['alice'];
    const prev = snap;
    const result = await call(fn, ...args);
    if (ep !== epoch || !result) return;
    snap = result.snapshot ?? result;
    refresh(intent.action === 'send_bit' ? 'Bob sent the classical bit.' : intent.action === 'receive_bit' ? 'Alice received the classical bit.' : 'Alice kept the identity correction.', prev);
    events = sensorsUnderPlayers(world, snap);
  } else
  if (intent.type === 'run') { // RUN CIRCUIT: the engine validates the prepared state; errors show in the debugger
    const prev = snap;
    const s = await call('run_circuit');
    if (ep !== epoch || !s) return;
    snap = s;
    const validated = s.circuit_validation?.validated === true;
    refresh(validated ? `${describeChange(prev, s, { type: 'run' })}. Both measure now.` : null, prev);
    // Sensors only fire when stepped on, so players already standing on one are measured now.
    events = validated ? sensorsUnderPlayers(world, snap) : [];
    if (!events.length) return;
  } else {
    events = intent.type === 'move'
      ? stepPlayer(world, intent.player, intent.dx, intent.dy, snap)
      : interact(world, intent.player, snap);
  }
  let note = null;
  let before = null; // snapshot before the first state change of this intent (for the bar highlight)
  for (const ev of events) {
    if (ev.type === 'death') return die();
    if (ev.type === 'blocked') note = NOTES[ev.reason] ?? null;
    else if (ev.type === 'info') note = ev.reason === 'measurement_locked' && snap.feed_forward
      ? (FEED_FORWARD_HINTS[snap.feed_forward.phase] ?? FEED_FORWARD_HINTS.prepare_bob)
      : NOTES[ev.reason];
    else if (ev.type === 'measure') {
      const prev = snap;
      const r = await call('measure', ev.qubit);
      if (ep !== epoch) return; // Esc / restart while the call was in flight: drop the result
      if (r) {
        snap = r.snapshot; lastMeasure = { qubit: r.qubit, outcome: r.outcome };
        note = describeChange(prev, snap, { type: 'measure', qubit: r.qubit, outcome: r.outcome });
        before ??= prev;
      }
    } else if (ev.type === 'gate' || ev.type === 'cnot') {
      const prev = snap;
      const s = await call('apply_gate', ev.gate, ev.qubit, ev.target, ev.terminalId, ev.actor);
      if (ep !== epoch) return;
      if (s) {
        snap = s; consumeTerminal(ev.terminal);
        note = describeChange(prev, s, { gate: ev.gate, qubit: ev.qubit, actor: ev.actor });
        before ??= prev;
        for (const sensorEvent of sensorsUnderPlayers(world, snap)) {
          if (!events.some((queued) => queued.type === 'measure' && queued.qubit === sensorEvent.qubit)) events.push(sensorEvent);
        }
      }
    }
  }
  if (events.length) refresh(note, before);
  if (objectiveFailed(snap)) return handleFailure(ep);
  if (hazardCheck(world, snap).length) return die();
  if (stageComplete(world, snap)) return handleComplete(ep);
}

function queueProtocol(action) {
  if (sm.state !== 'level' || !snap?.feed_forward || pending.length >= PENDING_CAP) return;
  const intent = { type: 'protocol', action };
  if (busy) pending.push(intent);
  else runIntents([intent]);
}

async function runIntents(intents) {
  busy = true;
  refreshProtocolConsole();
  const ep = epoch;
  try {
    for (const intent of intents) {
      if (sm.state !== 'level' || ep !== epoch) break;
      await runIntent(intent, ep);
    }
  } finally { busy = false; refreshProtocolConsole(); }
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
    renderer.draw(world, snap, { mode, active: input?.active ?? 'alice', overlay, message: overlayMessage }, t);
  }
}

// ---------- UI wiring ----------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const s = sm.state;
  // Esc works even while an engine call is in flight: the epoch guard drops its late result.
  if (e.code === 'Escape' && (s === 'level' || s === 'dead' || s === 'win')) sm.setState(STATES.MENU);
  else if (s === 'level' && snap?.feed_forward && ['KeyB', 'KeyV', 'KeyI'].includes(e.code)) {
    e.preventDefault();
    queueProtocol({ KeyB: 'send_bit', KeyV: 'receive_bit', KeyI: 'identity' }[e.code]);
  }
  else if (busy) return;
  else if (s === 'level' && e.code === 'KeyR') restartStage();
  else if (s === 'win' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); sm.setState(STATES.MENU); }
});
$('start-1p').addEventListener('click', () => startGame('1p'));
$('start-2p').addEventListener('click', () => startGame('2p'));
$('send-bit').addEventListener('click', () => queueProtocol('send_bit'));
$('receive-bit').addEventListener('click', () => queueProtocol('receive_bit'));
$('keep-identity').addEventListener('click', () => queueProtocol('identity'));
reduceBox.addEventListener('change', () => renderer.setReduceMotion(reduceBox.checked));
$('click-to-play').addEventListener('click', (e) => {
  e.currentTarget.hidden = true;
  focusTarget().focus();
});

(async () => {
  requestAnimationFrame(frame);
  // Sprites decode in parallel with the engine; loadSprites never rejects, so a failure only means procedural art.
  // Loading level1 doubles as the engine health check.
  const [first] = await Promise.all([loadLevelCached(DEFAULT_LEVEL), loadSprites()]);
  if (!first) { $('load-status').textContent = `Error: ${lastError}`; return; }
  // The only backend submission of the page load. It is never cancelled or restarted: after the
  // timeout the menu opens and the task keeps running; sampling stays local until it finishes.
  const precompute = precomputeOnce();
  if ((await withTimeout(precompute, PRECOMPUTE_TIMEOUT_MS)).timedOut) {
    showMenuNote(SLOW_BACKEND_NOTE);
    precompute.then(() => showMenuNote(null));
  }
  sm.setState(STATES.MENU);
})();

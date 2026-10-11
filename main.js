// Bootstrap only: wires engine -> state machine -> input -> entities -> render/debugger.
// IDENTICAL in dev and on Qollab ('quantum.engine' is the Python module there, an import map
// to dev/engine_bridge.js in dev/index.html). Engine calls happen on events only, never per frame.
import * as engine from 'quantum.engine';
import { createStateMachine, STATES } from './js/state.js';
import { parseLevel, CELL } from './js/grid.js';
import { stageView } from './js/level_adapter.js';
import {
  createWorld, resetWorld, stepPlayer, interact, consumeTerminal, syncTerminalUses, stageComplete, objectiveFailed, hazardCheck,
  sensorsUnderPlayers,
} from './js/entities.js';
import { createInput } from './js/input.js';
import { createRenderer } from './js/render.js';
import { fitCanvas, debounce } from './js/layout.js';
import { createDebugger, describeChange, hintFor, FEED_FORWARD_HINTS } from './js/debugger.js';
import { renderTitle } from './js/title.js';
import { createTransitionView } from './js/transition.js';
import { renderGateGuide } from './js/gate_guide.js';
import { loadSprites } from './js/sprite_loader.js';
import { withTimeout } from './js/async_util.js';
import { createAudio, trackForLevel, gateSfx } from './js/audio.js';

/* global backend -- Qollab provides the quantum backend as a global; dev/index.html defines a stub. */
const DEFAULT_LEVEL = 'level1';
const CAMPAIGN = ['level1', 'level2', 'level3'];
const TRANSITION_MS = 2200;
const ARRIVAL = {
  level1: ['Calibration Chamber', 'The register awaits calibration.'],
  level2: ['Bell Block', 'A classical bit connects the two rooms.'],
  level3: ['The Quantum Core', 'A phase-bound register awaits stabilization.'],
};
const DEATH_MS = 1000;
const RETRY_MS = 1000; // how long a failed retry_stage result stays visible before the stage resets
const PRECOMPUTE_SHOTS = 200;
const PRECOMPUTE_TIMEOUT_MS = 45_000; // how long boot waits for the one backend submission before opening the menu
const SLOW_BACKEND_NOTE = 'Quantum backend is slow — using local sampling until it finishes.';
const $ = (id) => document.getElementById(id);
const NOTES = {
  wrong_owner: 'This terminal belongs to the other player.',
  terminal_used: 'This terminal is used up.',
  cnot_needs_both: 'CNOT needs Alice on the control and Bob on the target.',
  superposition: 'Blocked: that door is in superposition.',
  closed: 'Blocked: that door is closed.',
  measurement_locked: 'Sensors are locked until the target preparation is validated.',
};

const canvas = $('canvas');
// Music data comes from the engine on demand (first time a track is needed). Deliberately NOT through call():
// an audio failure is only logged and must never show up as a game/debugger error.
const audio = createAudio({
  fetchTrack: async (track) => JSON.parse(await engine.load_audio.callPromising(track)),
});
const dbg = createDebugger({ state: $('debugger-body'), circuit: $('debugger-circuit') }, $('a11y-live'));
const reduceBox = $('reduce-motion');
reduceBox.checked = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
document.body.classList.toggle('reduce-motion', reduceBox.checked); // CSS stops the title animation with it
const renderer = createRenderer(canvas, { reduceMotion: reduceBox.checked });
const transitionView = createTransitionView($('level-transition'));

// ---------- canvas fit ----------
// The board cell (CSS decides its size) holds the canvas, which CSS cannot size to "largest box of the map's aspect
// ratio that fits" alone. Maps have any size up to 20x12 cells, so the logical canvas (grid.width x grid.height
// cells of 32 px) comes from the current grid; --board-w/--board-h feed the narrow layout's aspect-ratio.
// The CSS size follows the cell at once; the backing store (an integer multiple of the logical size, matched to
// size x devicePixelRatio) is debounced because resizing a canvas clears it. render.draw() keeps logical coords.
const board = canvas.parentElement;
function fitCanvasToBoard(applyScale) {
  const logicalW = (grid?.width ?? 20) * CELL, logicalH = (grid?.height ?? 12) * CELL;
  board.style.setProperty('--board-w', logicalW);
  board.style.setProperty('--board-h', logicalH);
  const w = board.clientWidth, h = board.clientHeight;
  if (!w || !h) return; // game screen hidden
  const fitted = fitCanvas({ availW: w, availH: h, dpr: globalThis.devicePixelRatio || 1, logicalW, logicalH });
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
let precomputeStarted = false;
let epoch = 0;          // bumped on every state change and level reset; async results from an older epoch are dropped
let deathTimer = null;
let pending = [];       // non-move intents that arrived while an engine call was in flight
let sceneTransition = null;
let engineQueue = Promise.resolve();
const PENDING_CAP = 4;

// ---------- engine ----------
/** Returns the parsed result, or null on error (then `lastError` is set). Never touches game state itself. */
async function call(name, ...args) {
  const requestedEpoch = epoch;
  const invoke = async () => {
    try {
      const out = JSON.parse(await engine[name].callPromising(...args));
      if (out?.error) throw Object.assign(new Error(out.error), { code: out.code });
      if (requestedEpoch === epoch) lastError = null;
      return out;
    } catch (e) {
      if (requestedEpoch === epoch) {
        lastError = hintFor(e?.code, String(e?.message ?? e), snap);
        refresh();
      }
      return null;
    }
  };
  // Session-changing calls remain ordered even if Esc cancels their old UI.
  // The long initial backend job is independent, so local fallback can still start after its timeout.
  if (name === 'precompute') return invoke();
  const queued = engineQueue.then(invoke);
  engineQueue = queued.then(() => undefined, () => undefined);
  return queued;
}
/** `prev` = the snapshot before the action that produced `snap`: the debugger highlights the bars that changed. */
function refreshProtocolConsole() {
  const blocked = busy || sm.state !== STATES.LEVEL;
  $('reset-btn').disabled = blocked;
  const protocol = snap?.feed_forward;
  const consoleEl = $('classical-console');
  consoleEl.hidden = !protocol;
  if (protocol) {
    $('protocol-hint').textContent = FEED_FORWARD_HINTS[protocol.phase] ?? 'Follow the Bell Block protocol.';
    const value = snap.classical_channel?.received ? String(snap.classical_channel.value) : 'hidden until Alice receives the bit';
    $('classical-value').lastElementChild.textContent = value;
    $('send-bit').disabled = blocked || protocol.phase !== 'send_bit';
    $('receive-bit').disabled = blocked || protocol.phase !== 'receive_bit';
    $('keep-identity').disabled = blocked || protocol.phase !== 'correct_alice' || protocol.required_correction !== 'i';
  }
}

/** Raw level stage of the current snapshot (goal text, gate guide). */
const currentStage = () => level?.stages?.[snap?.stage_index ?? 0] ?? null;

const HUD_HINT_BASE = 'Move: WASD / Arrows · E / Enter: use terminal · Space: run circuit · Tab: switch (1P) · R: reset stage · M: mute · Esc: menu';
const HUD_HINT_EXTRA = { level2: ' · B: send bit · V: receive bit · I: keep (identity)' };
const setHudHint = (levelId) => { $('hud-hint').textContent = HUD_HINT_BASE + (HUD_HINT_EXTRA[levelId] ?? ''); };

const refresh = (note = null, prev = null) => {
  if (world && snap) syncTerminalUses(world, snap); // engine is the source of truth for terminal uses
  refreshProtocolConsole();
  dbg.update(snap, { lastMeasure, note, error: lastError, prev, stage: currentStage() });
  const hints = currentStage()?.hints ?? [];
  const hintList = $('stage-hint-list');
  const hintStage = `${level?.id}:${snap?.stage_index ?? 0}`;
  if (hintList.dataset.stage !== hintStage) {
    hintList.replaceChildren(...hints.map((text) => {
      const item = document.createElement('li'); item.textContent = text; return item;
    }));
    hintList.dataset.stage = hintStage;
    $('stage-hints').open = false;
  }
  $('stage-hints').hidden = hints.length === 0;
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
  await call('precompute', backend, PRECOMPUTE_SHOTS);
  lastError = null; // a failed submission is non-fatal: sampling stays local and nothing is shown
}

/** Flat stage view -> grid -> world for the snapshot's current stage. */
function buildWorld() {
  grid = parseLevel(stageView(level, snap.stage_index ?? 0));
  world = createWorld(grid);
  fitCanvasToBoard(true); // the next stage may have another map size
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
const SCREENS = { loading: 'loading', menu: 'menu', level: 'game', dead: 'game', win: 'game', transition: 'game', finale: 'finale' };
const focusTarget = () => (SCREENS[sm.state] === 'game' ? canvas
  : $(sm.state === 'menu' ? 'menu-title' : sm.state === 'finale' ? 'finale-title' : 'loading'));

const sm = createStateMachine({
  initial: STATES.LOADING,
  onEnter(next) {
    epoch++;
    pending = [];
    if (next !== 'dead') { clearTimeout(deathTimer); deathTimer = null; }
    for (const id of new Set(Object.values(SCREENS))) $(id).hidden = id !== SCREENS[next];
    overlay = next === 'dead' || next === 'win' ? next : null;
    if (next !== STATES.TRANSITION && sceneTransition) {
      const cancelled = sceneTransition;
      sceneTransition = null;
      transitionView.hide(); canvas.style.opacity = '1';
      cancelled.resolve();
    }
    if (next === STATES.TRANSITION || next === STATES.FINALE) { input?.dispose(); input = null; }
    if (next === 'menu') { input?.dispose(); input = null; audio.playMusic('menu'); }
    if (next === STATES.FINALE) audio.playMusic('menu');
    if (next === 'level') showMenuError(null);
    if (SCREENS[next] === 'game') fitCanvasToBoard(true);
    focusTarget().focus();
    refreshProtocolConsole();
  },
});

function newInput() {
  input?.dispose(); // fresh queue, held keys and active player
  input = createInput(window, { mode });
}

async function startGame(chosen, requestedLevel = null) {
  if (busy) return;
  busy = true;
  showMenuError(null);
  try {
    mode = chosen;
    const ep = epoch;
    const id = requestedLevel ?? document.querySelector('input[name="level"]:checked')?.value ?? DEFAULT_LEVEL;
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
    setHudHint(id);
    renderGateGuide($('gate-guide'), currentStage());
    audio.playMusic(trackForLevel(id));
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
  audio.play('death');
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

/** The only completion entry: a real quantum objective AND both spatial exits. */
async function handleComplete(ep) {
  if (sm.state !== STATES.LEVEL || ep !== epoch || sceneTransition) return;
  const done = snap.stage_index ?? 0;
  const nextStage = done + 1 < (snap.stage_count ?? 1);
  const campaignIndex = CAMPAIGN.indexOf(level.id);
  const ending = !nextStage && campaignIndex === CAMPAIGN.length - 1;
  const nextId = nextStage ? level.id : CAMPAIGN[campaignIndex + 1];
  if (campaignIndex < 0 || (!ending && !nextId)) {
    sm.setState(STATES.MENU); showMenuError('Unknown campaign destination.'); return;
  }
  overlayMessage = undefined;
  audio.play('win');
  sm.setState(STATES.TRANSITION);
  let resolve;
  const completed = new Promise((doneTransition) => { resolve = doneTransition; });
  const destination = nextStage ? level.stages?.[done + 1]?.title : ARRIVAL[nextId]?.[0];
  const scene = {
    epoch, startedAt: performance.now(), duration: reduceBox.checked ? 160 : TRANSITION_MS,
    ending, nextStage, nextId, ready: ending, swapped: false, resolve,
  };
  sceneTransition = scene;
  transitionView.show({ title: ending ? 'Quack' : destination,
    message: ending ? 'The Quantum Core is stable. Both paths are complete.' : ARRIVAL[nextId]?.[1], ending });
  $('transition-title').classList.toggle('quack-title', ending);
  if (ending) renderTitle($('transition-title'));
  $('transition-title').tabIndex = -1;
  $('transition-title').focus();
  $('a11y-live').textContent = ending ? 'Quantum Core complete. Closing the campaign.' : `Level complete. Entering ${destination}.`;
  if (!ending) prepareArrival(scene);
  await completed; // the frame loop owns timing; no timer or new backend job
}

async function prepareArrival(scene) {
  const active = () => sceneTransition === scene && scene.epoch === epoch && sm.state === STATES.TRANSITION;
  try {
    const nextLevel = scene.nextStage ? level : await loadLevelCached(scene.nextId);
    if (!active()) return;
    if (!nextLevel) throw new Error(lastError ?? 'Next level could not be loaded.');
    const nextSnapshot = await call(scene.nextStage ? 'advance_stage' : 'new_session', ...(scene.nextStage ? [] : [scene.nextId]));
    if (!active()) return;
    if (!nextSnapshot) throw new Error(lastError ?? 'Next register could not be prepared.');
    scene.next = { level: nextLevel, snap: nextSnapshot };
    scene.ready = true;
  } catch (error) {
    if (!active()) return;
    sm.setState(STATES.MENU); showMenuError(error.message);
  }
}

function updateTransition(t) {
  const scene = sceneTransition;
  if (!scene || scene.epoch !== epoch || sm.state !== STATES.TRANSITION) return;
  const reduced = reduceBox.checked;
  const duration = reduced ? 160 : scene.duration;
  const progress = Math.min(1, Math.max(0, (t - scene.startedAt) / duration));
  if (!scene.ending && scene.ready && !scene.swapped && (progress >= 0.7 || reduced)) {
    try {
      level = scene.next.level; snap = scene.next.snap;
      lastMeasure = null; lastError = null;
      buildWorld(); scene.swapped = true;
      setHudHint(level.id);
      renderGateGuide($('gate-guide'), currentStage());
      audio.playMusic(trackForLevel(level.id));
      refresh();
    } catch (error) { sm.setState(STATES.MENU); showMenuError(error.message); return; }
  }
  const displayProgress = scene.ready ? progress : Math.min(progress, 0.7);
  const { mapOpacity } = transitionView.update(displayProgress, t, reduced);
  canvas.style.opacity = String(scene.swapped ? (reduced ? 1 : Math.max(0, (progress - 0.7) / 0.3)) : mapOpacity);
  if (progress < 1 || !scene.ready) return;
  sceneTransition = null;
  transitionView.hide(); canvas.style.opacity = '1';
  if (scene.ending) {
    sm.setState(STATES.FINALE); // no level4 and no restart of level3
  } else {
    newInput();
    sm.setState(STATES.LEVEL);
    refresh(`${level.title} — register ready.`);
  }
  scene.resolve();
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
  } else if (intent.type === 'run') { // RUN CIRCUIT: the engine validates the prepared state; errors show in the debugger
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
    if (ev.type === 'move') { if (!events.some((e) => e.type === 'death')) audio.play('step', { key: ev.player }); }
    else if (ev.type === 'blocked') note = NOTES[ev.reason] ?? null;
    else if (ev.type === 'info') note = ev.reason === 'measurement_locked' && snap.feed_forward
      ? (FEED_FORWARD_HINTS[snap.feed_forward.phase] ?? FEED_FORWARD_HINTS.prepare_bob)
      : NOTES[ev.reason];
    else if (ev.type === 'measure') {
      const prev = snap;
      audio.play('measure');
      const r = await call('measure', ev.qubit);
      if (ep !== epoch) return; // Esc / restart while the call was in flight: drop the result
      if (r) {
        audio.play(`collapse${r.outcome ? 1 : 0}`, { delay: 0.12 });
        snap = r.snapshot; lastMeasure = { qubit: r.qubit, outcome: r.outcome };
        note = describeChange(prev, snap, { type: 'measure', qubit: r.qubit, outcome: r.outcome });
        before ??= prev;
      }
    } else if (ev.type === 'gate' || ev.type === 'cnot') {
      const prev = snap;
      const s = await call('apply_gate', ev.gate, ev.qubit, ev.target, ev.terminalId, ev.actor);
      if (ep !== epoch) return;
      if (s) {
        audio.play(gateSfx(ev.gate));
        snap = s;
        if (ev.terminal) consumeTerminal(ev.terminal);
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
  updateTransition(t);
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
  if (e.code === 'Escape' && ['level', 'dead', 'win', 'transition', 'finale'].includes(s)) sm.setState(STATES.MENU);
  else if (e.code === 'KeyM' && s !== 'menu' && s !== 'loading') toggleSound();
  else if (s === 'level' && snap?.feed_forward && ['KeyB', 'KeyV', 'KeyI'].includes(e.code)) {
    e.preventDefault();
    queueProtocol({ KeyB: 'send_bit', KeyV: 'receive_bit', KeyI: 'identity' }[e.code]);
  }
  else if (busy) return;
  else if (s === 'level' && e.code === 'KeyR') restartStage();
  else if (s === 'win' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); sm.setState(STATES.MENU); }
});
// Browsers only allow audio after a user gesture: the first click or key press unlocks the AudioContext.
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => audio.unlock(), { capture: true });
const soundBox = $('sound');
const applySound = () => audio.setMuted(!soundBox.checked);
function toggleSound() { // M key (in a level): works while the menu checkbox is hidden, and keeps both in sync
  soundBox.checked = !soundBox.checked;
  applySound();
  $('a11y-live').textContent = soundBox.checked ? 'Sound on.' : 'Sound off.';
}
soundBox.addEventListener('change', applySound);
$('start-1p').addEventListener('click', () => { audio.play('click'); startGame('1p'); });
$('start-2p').addEventListener('click', () => { audio.play('click'); startGame('2p'); });
for (const radio of document.querySelectorAll('input[name="level"]')) radio.addEventListener('change', () => audio.play('click'));

$('send-bit').addEventListener('click', () => queueProtocol('send_bit'));
$('receive-bit').addEventListener('click', () => queueProtocol('receive_bit'));
$('keep-identity').addEventListener('click', () => queueProtocol('identity'));
$('final-menu').addEventListener('click', () => {
  if (sm.state === STATES.FINALE) sm.setState(STATES.MENU);
});
$('play-again').addEventListener('click', () => {
  if (sm.state !== STATES.FINALE || busy) return;
  document.querySelector('input[name="level"][value="level1"]').checked = true;
  sm.setState(STATES.MENU);
  startGame(mode, DEFAULT_LEVEL);
});
reduceBox.addEventListener('change', () => {
  renderer.setReduceMotion(reduceBox.checked);
  document.body.classList.toggle('reduce-motion', reduceBox.checked);
});
$('reset-btn').addEventListener('click', () => {
  canvas.focus(); // Space (run circuit) on a focused button would press it again
  if (sm.state === 'level' && !busy) restartStage();
});

renderTitle($('loading-title'));
renderTitle($('menu-title'));
renderTitle($('finale-title')); // exact same SVG builder and CSS treatment, not a copy of the logo

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

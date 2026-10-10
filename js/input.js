// Keyboard input: pure key mapping + a pollable intent queue with throttled repeat.
// Uses KeyboardEvent.code values. No DOM access besides the target passed in.

const DIRS = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};
const WASD = { KeyW: DIRS.up, KeyS: DIRS.down, KeyA: DIRS.left, KeyD: DIRS.right };
const ARROWS = {
  ArrowUp: DIRS.up, ArrowDown: DIRS.down, ArrowLeft: DIRS.left, ArrowRight: DIRS.right,
};

const move = (player, [dx, dy]) => ({ player, type: 'move', dx, dy });

/**
 * Pure mapping from a key code to an intent, or null if the key is not handled.
 * @param {string} code KeyboardEvent.code
 * @param {'1p'|'2p'} mode
 * @param {'alice'|'bob'} active active player (1P only)
 */
export function keyToIntent(code, mode, active) {
  if (mode === '2p') {
    if (code in WASD) return move('alice', WASD[code]);
    if (code === 'KeyE') return { player: 'alice', type: 'interact' };
    if (code in ARROWS) return move('bob', ARROWS[code]);
    if (code === 'Enter') return { player: 'bob', type: 'interact' };
    return null;
  }
  if (code in WASD) return move(active, WASD[code]);
  if (code in ARROWS) return move(active, ARROWS[code]); // convenience in 1P
  if (code === 'KeyE' || code === 'Enter') return { player: active, type: 'interact' };
  if (code === 'Tab') return { type: 'switch' };
  return null;
}

// Keys whose default browser action (scroll, focus change) must be suppressed.
const PREVENT = new Set(['Tab', 'Space', ...Object.keys(ARROWS)]);

/**
 * @param {{ addEventListener: Function, removeEventListener: Function }} target usually window
 * @param {{ mode?: '1p'|'2p', repeatMs?: number, now?: () => number }} [opts]
 */
export function createInput(target, { mode = '1p', repeatMs = 150, now = () => performance.now() } = {}) {
  let currentMode = mode;
  let active = 'alice';
  let queue = [];
  const held = new Map(); // code -> time of next repeat

  function onKeyDown(e) {
    const intent = keyToIntent(e.code, currentMode, active);
    if (intent || PREVENT.has(e.code)) e.preventDefault();
    if (!intent || e.repeat) return; // repeats are generated in poll()
    if (intent.type === 'switch') active = active === 'alice' ? 'bob' : 'alice';
    queue.push(intent);
    if (intent.type === 'move' && !held.has(e.code)) held.set(e.code, now() + repeatMs);
  }
  function onKeyUp(e) { held.delete(e.code); }
  function onBlur() { held.clear(); }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    get mode() { return currentMode; },
    get active() { return active; },
    setMode(m) { currentMode = m; held.clear(); queue = []; },
    /** Drain queued intents, plus a repeated move for each held movement key that is due. */
    poll() {
      const out = queue;
      queue = [];
      const t = now();
      for (const [code, due] of held) {
        if (t < due) continue;
        const intent = keyToIntent(code, currentMode, active); // re-resolve: Tab may have switched player
        if (intent?.type === 'move') out.push(intent);
        held.set(code, t + repeatMs);
      }
      return out;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      held.clear();
      queue = [];
    },
  };
}

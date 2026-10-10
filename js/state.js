// Game state machine. Pure, no DOM.
// States: loading -> menu -> level -> (dead | win) -> ...

export const STATES = Object.freeze({
  LOADING: 'loading',
  MENU: 'menu',
  LEVEL: 'level',
  DEAD: 'dead',
  WIN: 'win',
});

// Explicit transition table: from -> allowed targets.
const TRANSITIONS = {
  loading: ['menu'],
  menu: ['level'],
  level: ['dead', 'win', 'menu'],
  dead: ['level', 'menu'],
  win: ['menu', 'level'],
};

/**
 * @param {{ initial?: string, onEnter?: (next: string, prev: string, payload?: any) => void }} [opts]
 */
export function createStateMachine({ initial = 'loading', onEnter } = {}) {
  if (!(initial in TRANSITIONS)) throw new Error(`Unknown initial state "${initial}"`);
  let current = initial;

  const can = (next) => TRANSITIONS[current].includes(next);

  return {
    get state() { return current; },
    can,
    setState(next, payload) {
      if (!(next in TRANSITIONS)) throw new Error(`Unknown state "${next}" (from "${current}")`);
      if (!can(next)) throw new Error(`Illegal transition: "${current}" -> "${next}"`);
      const prev = current;
      current = next;
      if (onEnter) onEnter(next, prev, payload);
    },
  };
}

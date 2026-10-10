// Theme tile picking (pure, no DOM): which named tile of the lab/prison art each cell, door, sensor, exit and
// terminal shows, and the prop registry helpers. The renderer maps names to pixels (tileRect / propRect).
// Sprite data comes from the generated js/sprites.js (THEMES); nothing here draws or calls the engine.
import { THEMES as DATA } from './sprites.js';
import { isWall } from './grid.js';

export const FLOOR_TILES = ['floor_a', 'floor_b', 'floor_worn', 'floor_crack'];
export const WALL_FACES = ['wall_face_a', 'wall_face_b', 'wall_face_c', 'wall_face_pipe', 'wall_face_sign', 'wall_face_window'];

export const SUPER_FPS = 4;  // superposition door flicker
export const ANIM_FPS = 2;   // exit glow, animated props

export const themeData = (name) => DATA[name] ?? DATA.lab;

/** Deterministic unsigned 32-bit hash of a cell (+ salt): the same map always gets the same dressing. */
export function hash2(x, y, salt = 0) {
  let h = (Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Floor under (x, y): a shadow strip right below a wall, else mostly floor_a/floor_b with rare wear and cracks. */
export function floorTile(x, y, grid) {
  if (isWall(grid, x, y - 1)) return 'floor_shadow';
  const r = hash2(x, y) % 100;
  if (r < 3) return 'floor_crack';
  if (r < 9) return 'floor_worn';
  return r % 2 ? 'floor_a' : 'floor_b';
}

/**
 * Tile of a wall cell: the divider column alternates divider / divider_face, a wall with something walkable below
 * shows a wall face (mostly plain, sometimes vent / pipe / sign / window), any other wall is the flat `wall_top`
 * (no such cell exists in the art: the renderer fills it with the theme's wall_top_color).
 */
export function wallTile(x, y, grid) {
  if (grid.divider.includes(x)) return y % 2 === 0 ? 'divider' : 'divider_face';
  if (isWall(grid, x, y + 1)) return 'wall_top';
  const r = hash2(x, y, 7) % 100;
  if (r < 8) return 'wall_face_c';
  if (r < 14) return 'wall_face_pipe';
  if (r < 17) return 'wall_face_sign';
  if (r < 21) return 'wall_face_window';
  return r % 2 ? 'wall_face_a' : 'wall_face_b';
}

const frameOf = (t, fps) => Math.floor((t * fps) / 1000) % 2;

/**
 * Art of a blocking door. Engine-driven doors (L1 validated exits) are a padlocked hatch or an open doorway.
 * Legacy qubit doors show the value glyph: circle = 0, bar = 1, stripes = superposition (flickering a/b unless
 * reduceMotion). A lethal door that would kill (closed) uses the hazard door; its other states keep their glyph.
 */
export function doorTile(door, snap, t, reduceMotion) {
  if (door.engineDriven(snap)) return door.isOpen(snap) ? 'door_open' : 'door_locked';
  const state = door.state(snap);
  if (state === 'super') return reduceMotion || frameOf(t, SUPER_FPS) === 0 ? 'door_super_a' : 'door_super_b';
  if (door.lethal && !door.isOpen(snap)) return 'door_lethal';
  return state === '0' ? 'door_0' : 'door_1';
}

/** Measured value wins; locked sensors (engine said measurement is not enabled yet) look locked; else idle. */
export function sensorTile(sensor, snap) {
  const value = snap?.measured?.[sensor.qubit];
  if (value != null) return `sensor_${value}`;
  return snap?.measurement_enabled === false ? 'sensor_disabled' : 'sensor_idle';
}

/** Closed hatch until the objective is ready (or the engine unlocked the exits), then the glow alternates a/b. */
export function exitTile(exit, snap, t, reduceMotion) {
  const open = snap?.exits_unlocked === true || snap?.objective?.status === 'ready';
  if (!open) return 'exit_closed';
  return reduceMotion || frameOf(t, ANIM_FPS) === 0 ? 'exit_open_a' : 'exit_open_b';
}

/** Gate console: H / X / Z glyph screen, Bob's own CX is the orange owner console, a used-up one is dark. */
export function terminalTile(term) {
  if (term.usesLeft <= 0) return 'term_off';
  return term.gate === 'cx' ? 'term_cx_owner' : `term_${term.gate}`;
}

/** Co-op CX: `role` is 'control' (Alice's cell) or 'target' (Bob's cell). */
export function cnotTile(cnot, role) {
  return cnot.usesLeft <= 0 ? 'term_off' : `term_cx_${role}`;
}

/** Frame to draw for a prop: animated pairs alternate at 2 fps, frame `name` itself under reduced motion. */
export function propFrame(themeName, name, t, reduceMotion) {
  const partner = themeData(themeName).props[name]?.anim;
  return partner && !reduceMotion && frameOf(t, ANIM_FPS) === 1 ? partner : name;
}

/** Explicit `solid` on the decoration wins; otherwise the registry default; unknown sprites are walk-over. */
export function isSolidDecoration(themeName, deco) {
  return deco.solid ?? themeData(themeName).props[deco.sprite]?.solid ?? false;
}

/** floor_* props are decals painted right after the floor, under every other decoration. */
export const isFloorDecal = (name) => String(name).startsWith('floor_');

/** { x, y, w, h } in the theme's tiles sheet (32 px cells), or null. */
export function tileRect(themeName, name) {
  const cell = themeData(themeName).tiles[name];
  return cell ? { x: cell[0] * 32, y: cell[1] * 32, w: 32, h: 32 } : null;
}

/** { sheet: 'tiles' | 'props', x, y, w, h, footprint, ... } of a prop in the theme registry, or null. */
export const propRect = (themeName, name) => themeData(themeName).props[name] ?? null;

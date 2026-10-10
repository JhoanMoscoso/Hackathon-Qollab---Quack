// Versioned sprite registry (v1): which atlas cells the game uses. Pure data + helpers, no DOM.
// Atlas: assets/spritesheet.png, 256x192, 16x16 cells, (col,row) zero-based. Cells below were chosen
// after visual review of Fernanda's sheet (docs/07-guia-integracion-assets.md); change them here only.
// Characters live in separate strips (assets/characters/*_walk_4dir.png): 128x64 = 8 frames x 4 rows.

export const TILE = 16;
export const SHEET_W = 256;
export const SHEET_H = 192;
export const STRIP_FRAMES = 8;

const CELLS = {
  floor: [0, 11],
  wall: [1, 4],
  wall_center: [2, 4], // glass: the quantum divider
  door_0: [1, 2],      // green
  door_1: [2, 2],      // red
  door_super: [3, 2],  // violet
  sensor_idle: [0, 3],
  sensor_0: [1, 3],
  sensor_1: [2, 3],
  terminal_h: [0, 8],
  terminal_x: [1, 8],
  terminal_z: [2, 8],
  cnot_control: [3, 8],
  cnot_target: [5, 8],
  exit: [4, 11],
};

/** name -> { x, y, w, h } in atlas pixels. */
export const ATLAS = Object.fromEntries(
  Object.entries(CELLS).map(([name, [col, row]]) => [name, { x: col * TILE, y: row * TILE, w: TILE, h: TILE }]),
);

/** Row of the character strips for each facing (verified visually). */
export const DIRS = Object.freeze({ down: 0, left: 1, right: 2, up: 3 });

/** Source rect inside a character strip. `dir` is a DIRS key; `frameIndex` 0..7. */
export function characterFrame(dir, frameIndex) {
  const row = DIRS[dir];
  if (row === undefined) throw new RangeError(`unknown direction: ${dir}`);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= STRIP_FRAMES) {
    throw new RangeError(`frame out of range: ${frameIndex}`);
  }
  return { x: frameIndex * TILE, y: row * TILE, w: TILE, h: TILE };
}

/** Facing for a movement delta (dominant axis wins; ties go horizontal). null when there is no movement. */
export function dirFromDelta(dx, dy) {
  if (!dx && !dy) return null;
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'down' : 'up';
  return dx > 0 ? 'right' : 'left';
}

export const WALK_FPS = 8;

/** Walk cycle alternates strip frames 0 and 1 at WALK_FPS while walking; idle and reduced motion use frame 0. */
export function walkFrameIndex(t, walking, reduceMotion) {
  if (!walking || reduceMotion) return 0;
  return Math.floor((t * WALK_FPS) / 1000) % 2;
}

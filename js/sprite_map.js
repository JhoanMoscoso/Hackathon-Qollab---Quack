// Character strips and prop placement helpers. Pure data + helpers, no DOM.
// Characters live in separate strips (assets/characters/*_walk_4dir.png): 128x64 = 8 frames x 4 rows of 16 px.
// The themed tile and prop art is described by js/theme.js (registries in assets/themes/*.json).

export const TILE = 16;
export const STRIP_FRAMES = 8;

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

// ---- decorations (theme props, drawn 1:1 from the 32 px-per-cell prop sheets) ----

/**
 * Screen [x, y] (integers) of a decoration sprite: bottom-centre aligned inside its footprint.
 * @param {[number, number]} cell top-left tile [x, y]
 * @param {[number, number]} footprint [w, h] in tiles
 * @param {{ w: number, h: number }} frame sprite size in px (drawn 1:1)
 */
export function decorSpritePos([cx, cy], [fw, fh], { w, h }) {
  const px = 32;
  return [cx * px + Math.floor((fw * px - w) / 2), cy * px + fh * px - h];
}

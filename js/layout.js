// Pure layout helpers (unit-tested). The DOM wiring lives in main.js.

export const LOGICAL_W = 640; // default logical size = a 20x12 map
export const LOGICAL_H = 384;
export const MAX_SCALE = 8; // bounds the canvas backing store (640x384 * 8 = 5120x3072)

const pos = (n, fallback) => (Number.isFinite(n) && n > 0 ? n : fallback);

/**
 * Largest canvas of the level's aspect ratio that fits an available box, plus the integer backing-store scale.
 * cssW/cssH are whole CSS pixels (never larger than the box); scale = round(cssW * dpr / logicalW), at least 1,
 * so the renderer can keep drawing in logical (grid.width*32 x grid.height*32) coordinates with
 * setTransform(scale, 0, 0, scale, 0, 0). logicalW/logicalH default to the 640x384 of a 20x12 map.
 */
export function fitCanvas({ availW, availH, dpr = 1, logicalW = LOGICAL_W, logicalH = LOGICAL_H }) {
  const w = pos(availW, logicalW);
  const h = pos(availH, logicalH);
  let cssW = Math.floor(Math.min(w, (h * logicalW) / logicalH));
  cssW = Math.max(cssW, 1);
  const cssH = Math.max(Math.floor((cssW * logicalH) / logicalW), 1);
  const scale = Math.min(MAX_SCALE, Math.max(1, Math.round((cssW * pos(dpr, 1)) / logicalW)));
  return { cssW, cssH, scale };
}

/** Trailing-edge debounce: only the last call within `ms` runs. */
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

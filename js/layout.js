// Pure layout helpers (unit-tested). The DOM wiring lives in main.js.

export const LOGICAL_W = 640;
export const LOGICAL_H = 384;
export const MAX_SCALE = 8; // bounds the canvas backing store (640x384 * 8 = 5120x3072)

const pos = (n, fallback) => (Number.isFinite(n) && n > 0 ? n : fallback);

/**
 * Largest 5:3 canvas that fits an available box, plus the integer backing-store scale.
 * cssW/cssH are whole CSS pixels (never larger than the box); scale = round(cssW * dpr / 640), at least 1,
 * so the renderer can keep drawing in logical 640x384 coordinates with setTransform(scale, 0, 0, scale, 0, 0).
 */
export function fitCanvas({ availW, availH, dpr = 1 }) {
  const w = pos(availW, LOGICAL_W);
  const h = pos(availH, LOGICAL_H);
  let cssW = Math.floor(Math.min(w, (h * LOGICAL_W) / LOGICAL_H));
  cssW = Math.max(cssW, 1);
  const cssH = Math.max(Math.floor((cssW * LOGICAL_H) / LOGICAL_W), 1);
  const scale = Math.min(MAX_SCALE, Math.max(1, Math.round((cssW * pos(dpr, 1)) / LOGICAL_W)));
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

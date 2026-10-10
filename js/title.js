// "Quack" pixel-art title. titleLayout() is pure (a 5x7 bitmap font, one rect per lit pixel); renderTitle()
// is the only part that touches the DOM. Styling and animation (float, glitching Q) live in main.css.

const ROWS = 7;
const GLYPH_W = 5;
const GAP = 1; // blank pixel columns between letters
const SVG_NS = 'http://www.w3.org/2000/svg';

export const GLYPHS = {
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
};

/**
 * Pixel layout of a word: { width, height, letters: [{ char, rects: [{ x, y }] }] } in pixel units.
 * Unknown characters are skipped (they only advance the cursor).
 */
export function titleLayout(word) {
  const letters = [];
  let x = 0;
  for (const char of String(word).toUpperCase()) {
    const rows = GLYPHS[char];
    const rects = [];
    rows?.forEach((row, y) => [...row].forEach((c, dx) => { if (c === '#') rects.push({ x: x + dx, y }); }));
    letters.push({ char, rects });
    x += GLYPH_W + GAP;
  }
  return { width: Math.max(0, x - GAP), height: ROWS, letters };
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function pixelGroup(rects, className) {
  const g = svgEl('g', { class: className });
  for (const { x, y } of rects) g.append(svgEl('rect', { x, y, width: 1, height: 1 }));
  return g;
}

/**
 * Replaces the children of `el` (a heading) with the inline SVG title. The SVG is one image for assistive
 * technology (role="img", aria-label = the word). The first letter is its own group `.q` (purple, glitching)
 * with two offset ghost copies behind it; everything else is static.
 */
export function renderTitle(el, word = 'Quack') {
  const { width, height, letters } = titleLayout(word);
  const svg = svgEl('svg', {
    class: 'quack-svg', viewBox: `-1 -1 ${width + 2} ${height + 2}`, role: 'img', 'aria-label': word,
    'shape-rendering': 'crispEdges', focusable: 'false',
  });
  letters.forEach(({ rects }, i) => {
    if (i === 0) {
      svg.append(pixelGroup(rects, 'q-ghost q-ghost-a'), pixelGroup(rects, 'q-ghost q-ghost-b'), pixelGroup(rects, 'q'));
    } else svg.append(pixelGroup(rects, 'letter'));
  });
  el.replaceChildren(svg);
  return svg;
}

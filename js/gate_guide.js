// Gate guide: one card per gate of the current stage (name, tiny example, one-line description, sprite).
// gateCards() is pure; renderGateGuide() is the only part that touches the DOM. The sprites come from the
// "core" theme sheets (the circuit-board art); with no sprites loaded a plain letter plate is drawn instead.
import { tileRect, propRect } from './theme.js';

/** `sprite`: { tile } = a tile of the core tiles sheet, { prop } = a prop of the core props sheet. */
export const GATE_GUIDE = {
  h: {
    name: 'H · Hadamard', short: 'H', sprite: { tile: 'term_h' },
    example: 'H|0⟩ = |+⟩ = (|0⟩+|1⟩)/√2', description: 'Mixes 0 and 1 amplitudes: a basis change.',
  },
  x: {
    name: 'X · NOT', short: 'X', sprite: { tile: 'term_x' },
    example: 'X|0⟩ = |1⟩', description: 'Flips 0 and 1.',
  },
  z: {
    name: 'Z · Phase', short: 'Z', sprite: { tile: 'term_z' },
    example: 'Z|+⟩ = |−⟩', description: 'Flips the sign of |1⟩: a phase change only.',
  },
  cx: {
    name: 'CX · CNOT', short: 'CX', sprite: { prop: 'qubit_chip_a' },
    example: 'CX|10⟩ = |11⟩, CX|+0⟩ = Φ⁺', description: 'Flips the target for control 1; can create or remove entanglement.',
  },
  i: {
    name: 'I · Keep', short: 'I', sprite: { tile: 'term_cx_owner' },
    example: 'I|ψ⟩ = |ψ⟩', description: 'Does nothing: keeps the state as it is.',
  },
};

const ORDER = ['h', 'x', 'z', 'cx', 'i'];

/** Cards for a stage: every gate in its gate_set (alice, bob, shared), plus I (Keep) when it has a feed_forward. */
export function gateCards(stage) {
  const wanted = new Set();
  for (const list of Object.values(stage?.gate_set ?? {})) for (const g of list ?? []) wanted.add(String(g).toLowerCase());
  if (stage?.feed_forward) wanted.add('i');
  return ORDER.filter((g) => wanted.has(g)).map((g) => ({ gate: g, ...GATE_GUIDE[g] }));
}

const ICON = 64;

/** Draws one gate's art into a 64 px canvas context (crisp, centred); letter plate when the sprites are missing. */
export function drawGateIcon(ctx, card) {
  ctx.clearRect(0, 0, ICON, ICON);
  ctx.imageSmoothingEnabled = false;
  const sheet = globalThis.SPRITES?.themes?.core;
  const { tile, prop } = card.sprite;
  if (sheet && tile) {
    const r = tileRect('core', tile);
    if (r && sheet.tilesImage) { ctx.drawImage(sheet.tilesImage, r.x, r.y, r.w, r.h, 0, 0, ICON, ICON); return true; }
  } else if (sheet && prop) {
    const p = propRect('core', prop);
    const image = p && (p.sheet === 'tiles' ? sheet.tilesImage : sheet.propsImage);
    if (image) {
      const scale = Math.min(ICON / p.w, ICON / p.h, 2);
      const w = p.w * scale, h = p.h * scale;
      ctx.drawImage(image, p.x, p.y, p.w, p.h, (ICON - w) / 2, (ICON - h) / 2, w, h);
      return true;
    }
  }
  ctx.fillStyle = '#232B3A';
  ctx.fillRect(0, 0, ICON, ICON);
  ctx.strokeStyle = '#E8ECF2';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, ICON - 4, ICON - 4);
  ctx.fillStyle = '#E8ECF2';
  ctx.font = 'bold 22px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(card.short, ICON / 2, ICON / 2);
  return false;
}

/**
 * Fills `el` (#gate-guide) with the cards of `stage`. The section is focusable and holds a horizontally
 * scrolling strip of cards: the arrow keys scroll it by one card (and do not reach the game's movement keys).
 */
export function renderGateGuide(el, stage) {
  const cards = gateCards(stage);
  const heading = document.createElement('h2');
  heading.className = 'dbg-title gg-title';
  heading.textContent = 'Gate guide';
  const list = document.createElement('ul');
  list.className = 'gg-list';
  for (const card of cards) {
    const item = document.createElement('li');
    item.className = 'gg-card';
    const canvas = document.createElement('canvas');
    canvas.width = ICON; canvas.height = ICON;
    canvas.className = 'gg-icon';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext?.('2d');
    if (ctx) drawGateIcon(ctx, card);
    const text = document.createElement('div');
    text.className = 'gg-text';
    const name = document.createElement('strong');
    name.textContent = card.name;
    const example = document.createElement('code');
    example.textContent = card.example;
    const description = document.createElement('span');
    description.textContent = card.description;
    text.append(name, example, description);
    item.append(canvas, text);
    list.append(item);
  }
  el.replaceChildren(heading, list);
  el.onkeydown = (e) => {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation(); // the arrow keys move Bob; inside the guide they only scroll it
    const step = list.firstElementChild?.getBoundingClientRect().width || 200;
    list.scrollBy({ left: e.code === 'ArrowRight' ? step : -step, behavior: 'auto' });
  };
}

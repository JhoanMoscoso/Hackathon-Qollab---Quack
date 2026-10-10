// Canvas 2D renderer. Draws pixel-art sprites when globalThis.SPRITES is set (js/sprite_loader.js),
// and falls back to procedural shapes everywhere when it is not.
// Pure drawing: no engine calls, no DOM access besides the canvas passed in.
// State is never encoded by color or sprite alone: 0 = "0" badge, 1 = "1" badge, super = animated
// diagonal stripes + "?" badge; exits and players carry an A/B letter.

import { CELL, COLS, ROWS, WALL_COLS } from './grid.js';
import { characterFrame, dirFromDelta, walkFrameIndex } from './sprite_map.js';

export const WIDTH = COLS * CELL;  // 640
export const HEIGHT = ROWS * CELL; // 384

export const COLORS = {
  alice: '#4ADBE6',
  bob: '#F5A742',
  zero: '#5BBF6A',
  one: '#D64550',
  superpos: '#A66CFF',
  floor: '#141922',
  floorAlt: '#171D28',
  grid: '#1E2532',
  wall: '#2C3648',
  wallEdge: '#3F4C63',
  centerWall: '#40305E',
  centerEdge: '#8B6FD0',
  text: '#E8ECF2',
  hazard: '#F2D13B',
  overlay: 'rgba(8, 10, 14, 0.82)',
};

export const ON_ONE = '#000000'; // glyph color on COLORS.one, contrast 4.83:1
const FONT = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const playerColor = (id) => (id === 'alice' ? COLORS.alice : COLORS.bob);
const px = (cell) => cell * CELL;

export const OPEN_DOOR_ALPHA = 0.35; // passable door: sprite is ghosted, its badge stays at full alpha
export const WALK_MS = 250;          // how long a player keeps the walk cycle after changing cell
const INK = '#0E1116';

/**
 * Sprite hook. Returns true if a sprite was drawn; false means "no spritesheet / unknown name",
 * so the caller falls back to its procedural shape. Shape (set by sprite_loader.js):
 * globalThis.SPRITES = { image, frames: { name: { x, y, w, h } }, characters: { alice: img, bob: img } }
 * Always drawn CELL x CELL (2x the 16 px art) at integer positions.
 */
export function drawSprite(ctx, name, x, y) {
  const sheet = globalThis.SPRITES;
  const frame = sheet?.frames?.[name];
  if (!sheet?.image || !frame) return false;
  ctx.drawImage(sheet.image, frame.x, frame.y, frame.w, frame.h, x, y, CELL, CELL);
  return true;
}

const hasSprite = (name) => !!(globalThis.SPRITES?.image && globalThis.SPRITES.frames?.[name]);

/** Character strip frame, or false when there is no strip for this player (procedural fallback). */
function drawCharacter(ctx, id, dir, frameIndex, x, y) {
  const strip = globalThis.SPRITES?.characters?.[id];
  if (!strip) return false;
  const f = characterFrame(dir, frameIndex);
  ctx.drawImage(strip, f.x, f.y, f.w, f.h, x, y, CELL, CELL);
  return true;
}

function text(ctx, str, x, y, { size = 12, color = COLORS.text, align = 'center', bold = true } = {}) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function line(ctx, x1, y1, x2, y2, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function circle(ctx, cx, cy, r, { fill, stroke, width = 2 } = {}) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

/** "Used up / already measured" badge: a check mark on a light disc, always drawn at full alpha. */
function drawDoneBadge(ctx, x, y) {
  const cx = x + CELL - 9;
  const cy = y + 9;
  circle(ctx, cx, cy, 6, { fill: COLORS.text });
  ctx.save();
  ctx.strokeStyle = '#0E1116';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy);
  ctx.lineTo(cx - 1, cy + 3);
  ctx.lineTo(cx + 3, cy - 3);
  ctx.stroke();
  ctx.restore();
}

/** Small filled square with one glyph, always drawn at full alpha. corner: tl | tr | bl | br. */
function drawBadge(ctx, x, y, corner, glyph, fill, ink = INK) {
  const size = 14;
  const bx = corner.endsWith('r') ? x + CELL - size - 1 : x + 1;
  const by = corner.startsWith('b') ? y + CELL - size - 1 : y + 1;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = fill;
  ctx.fillRect(bx, by, size, size);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, size - 1, size - 1);
  ctx.restore();
  text(ctx, glyph, bx + size / 2, by + size / 2 + 1, { size: 11, color: ink });
}

// ---------- layers ----------
function drawFloor(ctx) {
  if (hasSprite('floor')) {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawSprite(ctx, 'floor', px(x), px(y));
    return;
  }
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = (x + y) % 2 ? COLORS.floor : COLORS.floorAlt;
      ctx.fillRect(px(x), px(y), CELL, CELL);
    }
  }
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= COLS; x++) { ctx.moveTo(px(x) + 0.5, 0); ctx.lineTo(px(x) + 0.5, HEIGHT); }
  for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, px(y) + 0.5); ctx.lineTo(WIDTH, px(y) + 0.5); }
  ctx.stroke();
}

function drawWalls(ctx, grid) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid.tiles[y][x] !== '#') continue;
      const center = WALL_COLS.includes(x);
      if (drawSprite(ctx, center ? 'wall_center' : 'wall', px(x), px(y))) continue;
      ctx.fillStyle = center ? COLORS.centerWall : COLORS.wall;
      ctx.fillRect(px(x), px(y), CELL, CELL);
      ctx.strokeStyle = center ? COLORS.centerEdge : COLORS.wallEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(px(x) + 1, px(y) + 1, CELL - 2, CELL - 2);
      if (center) { // brick lines make the quantum divider visibly different from room walls
        line(ctx, px(x) + 2, px(y) + CELL / 2, px(x) + CELL - 2, px(y) + CELL / 2, COLORS.centerEdge, 1);
        const bx = px(x) + (x === WALL_COLS[0] ? CELL / 3 : (2 * CELL) / 3);
        line(ctx, bx, px(y) + 2, bx, px(y) + CELL / 2, COLORS.centerEdge, 1);
        line(ctx, bx, px(y) + CELL / 2, bx, px(y) + CELL - 2, COLORS.centerEdge, 1);
      }
    }
  }
}

function drawStripes(ctx, x, y, color, shift) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, CELL, CELL);
  ctx.clip();
  ctx.fillStyle = '#1B1430';
  ctx.fillRect(x, y, CELL, CELL);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = -CELL; i < CELL * 2; i += 8) {
    ctx.moveTo(x + i + shift, y + CELL);
    ctx.lineTo(x + i + shift + CELL, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Translucent diagonal stripes over the (stripe-less) super sprite. */
function drawStripeOverlay(ctx, x, y, shift) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, CELL, CELL);
  ctx.clip();
  ctx.strokeStyle = 'rgba(27, 20, 48, 0.75)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = -CELL; i < CELL * 2; i += 8) {
    ctx.moveTo(x + i + shift, y + CELL);
    ctx.lineTo(x + i + shift + CELL, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDoorSprite(ctx, door, snap, state, x, y, t, reduceMotion) {
  ctx.save();
  if (door.isOpen(snap)) ctx.globalAlpha = OPEN_DOOR_ALPHA; // passable: ghost over the floor
  drawSprite(ctx, `door_${state}`, x, y);
  ctx.restore();
  if (state === 'super') {
    drawStripeOverlay(ctx, x, y, reduceMotion ? 0 : (Math.floor(t / 250) % 4) * 2); // 4 fps
    drawBadge(ctx, x, y, 'tr', '?', COLORS.superpos);
  } else {
    drawBadge(ctx, x, y, 'tr', state, state === '0' ? COLORS.zero : COLORS.one);
  }
}

function drawDoor(ctx, door, snap, t, reduceMotion) {
  const x = px(door.x);
  const y = px(door.y);
  const state = snap.objects?.[door.name];
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  if (hasSprite(`door_${state}`)) drawDoorSprite(ctx, door, snap, state, x, y, t, reduceMotion);
  else {
    if (state === '0') {
      ctx.strokeStyle = COLORS.zero;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
      text(ctx, '0', cx, cy, { size: 12, color: COLORS.zero });
    } else if (state === '1') {
      ctx.fillStyle = COLORS.one;
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      // Pure black on #D64550 = 4.83:1 (white would be 4.35:1, below the 4.5:1 text minimum).
      line(ctx, x + 8, y + 8, x + CELL - 8, y + CELL - 8, ON_ONE, 3);
      line(ctx, x + CELL - 8, y + 8, x + 8, y + CELL - 8, ON_ONE, 3);
      text(ctx, '1', x + CELL - 7, y + 8, { size: 10, color: ON_ONE });
    } else {
      const shift = reduceMotion ? 0 : (Math.floor(t / 250) % 4) * 2; // 4 fps
      drawStripes(ctx, x, y, COLORS.superpos, shift);
      text(ctx, '?', cx, cy, { size: 14, color: '#FFFFFF' });
    }
  }
  if (door.lethal) { // hazard border: dashed yellow, readable without color too
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS.hazard;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
    ctx.restore();
  }
}

function drawSensor(ctx, sensor, snap) {
  const x = px(sensor.x);
  const y = px(sensor.y);
  const cx = x + CELL / 2;
  const cy = y + CELL / 2 - 3;
  const value = snap.measured?.[sensor.qubit];
  const done = value != null;
  if (hasSprite('sensor_idle')) {
    drawSprite(ctx, done ? `sensor_${value}` : 'sensor_idle', x, y);
    ctx.save(); // label plate keeps Q0/Q1 readable on top of the art
    ctx.fillStyle = 'rgba(14, 17, 22, 0.8)';
    ctx.fillRect(x + 5, y + CELL - 13, CELL - 10, 12);
    ctx.restore();
    text(ctx, `Q${sensor.qubit}`, cx, y + CELL - 7, { size: 9 });
    if (done) drawDoneBadge(ctx, x, y);
    return;
  }
  ctx.save();
  if (done) ctx.globalAlpha = 0.4; // dim the base shape only
  circle(ctx, cx, cy, 11, { stroke: COLORS.text, width: 2 });
  circle(ctx, cx, cy, 5, { fill: COLORS.text });
  circle(ctx, cx, cy, 2, { fill: INK });
  ctx.restore();
  text(ctx, `Q${sensor.qubit}`, cx, y + CELL - 5, { size: 9 }); // label stays at full alpha
  if (done) drawDoneBadge(ctx, x, y);
}

function drawTerminal(ctx, term) {
  const x = px(term.x);
  const y = px(term.y);
  const color = playerColor(term.owner);
  const used = term.usesLeft <= 0;
  ctx.save();
  if (used) ctx.globalAlpha = 0.4; // dim the base shape only
  const drawn = drawSprite(ctx, `terminal_${term.gate}`, x, y);
  if (!drawn) {
    ctx.fillStyle = INK;
    ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
  }
  ctx.restore();
  if (!drawn) text(ctx, term.gate.toUpperCase(), x + CELL / 2, y + CELL / 2, { size: 16, color }); // full alpha
  if (used) drawDoneBadge(ctx, x, y);
}

function drawCnot(ctx, cnot) {
  const [cxCell, cyCell] = cnot.control;
  const [txCell, tyCell] = cnot.target;
  const cx = px(cxCell) + CELL / 2;
  const cy = px(cyCell) + CELL / 2;
  const tx = px(txCell) + CELL / 2;
  const ty = px(tyCell) + CELL / 2;
  line(ctx, cx, cy, tx, ty, COLORS.centerEdge, 4); // cable
  if (!drawSprite(ctx, 'cnot_control', px(cxCell), px(cyCell))) {
    circle(ctx, cx, cy, 7, { fill: COLORS.alice });
    circle(ctx, cx, cy, 10, { stroke: COLORS.text, width: 1 });
  }
  if (!drawSprite(ctx, 'cnot_target', px(txCell), px(tyCell))) {
    circle(ctx, tx, ty, 10, { fill: '#0E1116', stroke: COLORS.bob, width: 2 });
    line(ctx, tx - 10, ty, tx + 10, ty, COLORS.bob, 2);
    line(ctx, tx, ty - 10, tx, ty + 10, COLORS.bob, 2);
  }
}

function drawExit(ctx, exit) {
  const x = px(exit.x);
  const y = px(exit.y);
  const color = playerColor(exit.player);
  const letter = exit.player === 'alice' ? 'A' : 'B';
  if (drawSprite(ctx, 'exit', x, y)) { // identity by border + letter, not only by color
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
    drawBadge(ctx, x, y, 'br', letter, color);
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
  ctx.fillStyle = color;
  ctx.beginPath(); // down arrow
  ctx.moveTo(x + 9, y + 11);
  ctx.lineTo(x + CELL - 9, y + 11);
  ctx.lineTo(x + CELL / 2, y + CELL - 8);
  ctx.closePath();
  ctx.fill();
}

/** motion = { dir, until }: facing and the time until which the walk cycle runs. */
function drawPlayer(ctx, player, view, motion, t, reduceMotion) {
  const x = px(player.x);
  const y = px(player.y);
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  const color = playerColor(player.id);
  const letter = player.id === 'alice' ? 'A' : 'B';
  if (view.mode === '1p' && view.active === player.id) { // active marker, shape not color
    ctx.save();
    ctx.setLineDash([3, 3]);
    circle(ctx, cx, cy, 15, { stroke: COLORS.text, width: 2 });
    ctx.restore();
  }
  const frameIndex = walkFrameIndex(t, t < motion.until, reduceMotion);
  if (drawCharacter(ctx, player.id, motion.dir, frameIndex, x, y)) {
    drawBadge(ctx, x, y, 'tl', letter, color); // both chicks look alike: the letter tells them apart
    return;
  }
  if (player.id === 'alice') circle(ctx, cx, cy, 11, { fill: color });
  else {
    ctx.fillStyle = color;
    ctx.fillRect(cx - 10, cy - 10, 20, 20);
  }
  text(ctx, letter, cx, cy + 1, { size: 14, color: INK });
}

function drawOverlay(ctx, view) {
  if (!view.overlay) return;
  ctx.fillStyle = COLORS.overlay;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const dead = view.overlay === 'dead';
  text(ctx, dead ? 'Wavefunction collapsed' : 'Level complete', WIDTH / 2, HEIGHT / 2 - 14,
    { size: 28, color: dead ? '#FF8A93' : '#8BE69A' });
  const msg = view.message ?? (dead ? 'Restarting level...' : 'Press Enter to return to menu');
  text(ctx, msg, WIDTH / 2, HEIGHT / 2 + 22, { size: 16, bold: false });
}

/**
 * @param {HTMLCanvasElement} canvas 640x384
 * @param {{ reduceMotion?: boolean }} [opts]
 */
export function createRenderer(canvas, { reduceMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  let reduce = reduceMotion;
  ctx.imageSmoothingEnabled = false;
  // Per-player facing and walk timer, derived from cell changes between draws (renderer-local, no game state).
  const motion = {
    alice: { x: null, y: null, dir: 'down', until: 0 },
    bob: { x: null, y: null, dir: 'down', until: 0 },
  };
  const track = (player, t) => {
    const m = motion[player.id];
    if (m.x !== null && (m.x !== player.x || m.y !== player.y)) {
      const dx = player.x - m.x;
      const dy = player.y - m.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) { // a real step; resets/teleports do not animate
        m.dir = dirFromDelta(dx, dy);
        m.until = t + WALK_MS;
      }
    }
    m.x = player.x;
    m.y = player.y;
    return m;
  };

  return {
    setReduceMotion(b) { reduce = !!b; },
    /**
     * @param world entities.createWorld() result
     * @param snap engine snapshot
     * @param {{ mode: string, active: string, overlay: null|'dead'|'win', message?: string }} view
     * @param {number} t time in ms (requestAnimationFrame timestamp)
     */
    draw(world, snap, view, t = 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      drawFloor(ctx);
      drawWalls(ctx, world.grid);
      if (snap) {
        for (const door of world.doors) drawDoor(ctx, door, snap, t, reduce);
        for (const sensor of world.sensors) drawSensor(ctx, sensor, snap);
      }
      for (const term of world.terminals) drawTerminal(ctx, term);
      if (world.cnot) drawCnot(ctx, world.cnot);
      for (const exit of world.exits) drawExit(ctx, exit);
      for (const id of ['alice', 'bob']) {
        const player = world.players[id];
        drawPlayer(ctx, player, view, track(player, t), t, reduce);
      }
      drawOverlay(ctx, view);
    },
  };
}

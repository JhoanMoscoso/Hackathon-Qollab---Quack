// Canvas 2D renderer. Draws the themed pixel-art tiles and props (lab / prison, see js/theme.js) when
// globalThis.SPRITES has the level's theme (js/sprite_loader.js), and falls back to procedural shapes everywhere
// when it does not. Pure drawing: no engine calls, no DOM access besides the canvas passed in.
// State is never encoded by color or sprite alone: doors carry a 0 / 1 / ? badge (their art adds circle / bar /
// stripes), engine locks are padlocks, sensors carry Q0/Q1 labels and a check mark once measured, exits and
// players carry an A/B letter. The logical canvas is grid.width x grid.height cells of CELL px, whatever the map.

import { CELL } from './grid.js';
import { characterFrame, dirFromDelta, walkFrameIndex, decorSpritePos } from './sprite_map.js';
import {
  floorTile, wallTile, doorTile, sensorTile, exitTile, terminalTile, cnotTile, propFrame, isFloorDecal,
} from './theme.js';

/** Logical canvas size of a grid in px. */
export const logicalSize = (grid) => ({ w: grid.width * CELL, h: grid.height * CELL });

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

/** The loaded art of the grid's theme ({ tilesImage, propsImage, tiles, props, wallTopColor }), or null. */
const themeSheet = (grid) => {
  const sheet = globalThis.SPRITES?.themes?.[grid.theme];
  return sheet?.tilesImage ? sheet : null;
};

/** Draws one 32x32 tile of the theme's tiles sheet. False when the sheet has no such tile (caller falls back). */
function drawTile(ctx, sheet, name, x, y) {
  const cell = sheet?.tiles?.[name];
  if (!cell) return false;
  ctx.drawImage(sheet.tilesImage, cell[0] * CELL, cell[1] * CELL, CELL, CELL, x, y, CELL, CELL);
  return true;
}

/** Draws a prop (1:1) bottom-centre aligned in its footprint. False for unknown names. */
function drawProp(ctx, sheet, name, cell, footprint) {
  const p = sheet?.props?.[name];
  const image = p && (p.sheet === 'tiles' ? sheet.tilesImage : sheet.propsImage);
  if (!image) return false;
  const [x, y] = decorSpritePos(cell, footprint, p);
  ctx.drawImage(image, p.x, p.y, p.w, p.h, x, y, p.w, p.h);
  return true;
}

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
function drawFloor(ctx, grid, sheet) {
  const { w, h } = logicalSize(grid);
  if (sheet) {
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) drawTile(ctx, sheet, floorTile(x, y, grid), px(x), px(y));
    }
    return;
  }
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      ctx.fillStyle = (x + y) % 2 ? COLORS.floor : COLORS.floorAlt;
      ctx.fillRect(px(x), px(y), CELL, CELL);
    }
  }
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= grid.width; x++) { ctx.moveTo(px(x) + 0.5, 0); ctx.lineTo(px(x) + 0.5, h); }
  for (let y = 0; y <= grid.height; y++) { ctx.moveTo(0, px(y) + 0.5); ctx.lineTo(w, px(y) + 0.5); }
  ctx.stroke();
}

function drawWalls(ctx, grid, sheet) {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.tiles[y][x] !== '#') continue;
      const center = grid.divider.includes(x);
      if (sheet) {
        const name = wallTile(x, y, grid);
        // No plain wall-top cell exists in the art: a wall seen from above is a flat fill of the cap colour.
        if (name === 'wall_top' || !drawTile(ctx, sheet, name, px(x), px(y))) {
          ctx.fillStyle = sheet.wallTopColor ?? COLORS.wall;
          ctx.fillRect(px(x), px(y), CELL, CELL);
        }
        continue;
      }
      ctx.fillStyle = center ? COLORS.centerWall : COLORS.wall;
      ctx.fillRect(px(x), px(y), CELL, CELL);
      ctx.strokeStyle = center ? COLORS.centerEdge : COLORS.wallEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(px(x) + 1, px(y) + 1, CELL - 2, CELL - 2);
      if (center) { // brick lines make the quantum divider visibly different from room walls
        line(ctx, px(x) + 2, px(y) + CELL / 2, px(x) + CELL - 2, px(y) + CELL / 2, COLORS.centerEdge, 1);
        const bx = px(x) + (grid.divider.length === 2 && x === grid.divider[0] ? CELL / 3 : grid.divider.length === 2 ? (2 * CELL) / 3 : CELL / 2);
        line(ctx, bx, px(y) + 2, bx, px(y) + CELL / 2, COLORS.centerEdge, 1);
        line(ctx, bx, px(y) + CELL / 2, bx, px(y) + CELL - 2, COLORS.centerEdge, 1);
      }
    }
  }
}

/**
 * Themed decorations (visual; solid ones also block movement, see entities.js). Two passes keep the layer order:
 * floor decals (floor_* names) right after floor and walls, then every other prop sorted back to front (by the
 * bottom edge of its footprint), always below consoles, doors, sensors and players. Nothing is drawn when the
 * theme art is absent or a sprite name is unknown. Animated pairs (fridge, fans, alarm) follow propFrame.
 */
function drawDecorations(ctx, grid, sheet, floorDecals, t, reduceMotion) {
  if (!sheet || !grid.decorations?.length) return;
  const list = grid.decorations.filter((d) => isFloorDecal(d.sprite) === floorDecals);
  if (!floorDecals) list.sort((a, b) => a.cell[1] + a.footprint[1] - (b.cell[1] + b.footprint[1]) || a.cell[0] - b.cell[0]);
  for (const d of list) drawProp(ctx, sheet, propFrame(grid.theme, d.sprite, t, reduceMotion), d.cell, d.footprint);
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

/** Padlock glyph centered on (cx, cy): joint locks are shut ("1") until the stage objective is met. */
function drawLock(ctx, cx, cy, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy - 2, 5, Math.PI, 0); // shackle
  ctx.stroke();
  ctx.fillRect(cx - 7, cy - 2, 14, 10); // body
  ctx.restore();
}

/**
 * Non-blocking door: a small floor indicator (thin frame, no hazard border) that only mirrors the
 * snapshot state. State still reads without color: "0" / "1" / "?" glyphs.
 */
function drawIndicator(ctx, door, state, x, y) {
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  const inset = 8;
  const size = CELL - inset * 2;
  ctx.save();
  if (state === '0') {
    ctx.strokeStyle = COLORS.zero;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, size - 1, size - 1);
    ctx.restore();
    text(ctx, '0', cx, cy, { size: 11, color: COLORS.zero });
  } else if (state === '1') {
    ctx.fillStyle = COLORS.one;
    ctx.fillRect(x + inset, y + inset, size, size);
    ctx.restore();
    text(ctx, '1', cx, cy, { size: 11, color: ON_ONE });
  } else {
    ctx.fillStyle = '#1B1430';
    ctx.fillRect(x + inset, y + inset, size, size);
    ctx.strokeStyle = COLORS.superpos;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, size - 1, size - 1);
    ctx.restore();
    text(ctx, '?', cx, cy, { size: 11, color: '#FFFFFF' });
  }
}

function drawDoor(ctx, door, snap, sheet, t, reduceMotion) {
  const x = px(door.x);
  const y = px(door.y);
  const state = door.visualState(snap); // engine-driven doors (door_states) map to the "0" open / "1" closed art
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  if (door.blocking === false) return drawIndicator(ctx, door, state, x, y);
  // Bound to the stage objective / the validated circuit, not to the qubit value: shown as a padlock while locked.
  const engine = door.engineDriven(snap);
  const joint = door.qubit === undefined || engine;
  const tileName = sheet && doorTile(door, snap, t, reduceMotion);
  if (sheet && sheet.tiles[tileName]) {
    ctx.save();
    if (!engine && door.isOpen(snap)) ctx.globalAlpha = OPEN_DOOR_ALPHA; // passable: ghost over the floor
    drawTile(ctx, sheet, tileName, x, y);
    ctx.restore();
    // Engine doors say it with a padlock / open doorway; qubit doors keep a text badge next to the glyph art.
    if (!engine) drawBadge(ctx, x, y, 'tr', state === 'super' ? '?' : state, state === 'super' ? COLORS.superpos : state === '0' ? COLORS.zero : COLORS.one);
  } else {
    if (state === '0') {
      ctx.strokeStyle = COLORS.zero;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
      text(ctx, '0', cx, cy, { size: 12, color: COLORS.zero });
    } else if (state === '1') {
      ctx.fillStyle = COLORS.one;
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      // Pure black on #D64550 = 4.83:1 (white would be 4.35:1, below the 4.5:1 text minimum).
      if (joint) drawLock(ctx, cx, cy + 1, ON_ONE);
      else {
        line(ctx, x + 8, y + 8, x + CELL - 8, y + CELL - 8, ON_ONE, 3);
        line(ctx, x + CELL - 8, y + 8, x + 8, y + CELL - 8, ON_ONE, 3);
      }
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

function drawSensor(ctx, sensor, snap, sheet) {
  const x = px(sensor.x);
  const y = px(sensor.y);
  const cx = x + CELL / 2;
  const cy = y + CELL / 2 - 3;
  const value = snap.measured?.[sensor.qubit];
  const done = value != null;
  if (sheet && drawTile(ctx, sheet, sensorTile(sensor, snap), x, y)) {
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

function drawTerminal(ctx, term, sheet) {
  const x = px(term.x);
  const y = px(term.y);
  const color = playerColor(term.owner);
  const used = term.usesLeft <= 0;
  if (sheet && drawTile(ctx, sheet, terminalTile(term), x, y)) { // used-up consoles are the dark term_off art
    if (used) drawDoneBadge(ctx, x, y);
    return;
  }
  ctx.save();
  if (used) ctx.globalAlpha = 0.4; // dim the base shape only
  ctx.fillStyle = INK;
  ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
  ctx.restore();
  text(ctx, term.gate.toUpperCase(), x + CELL / 2, y + CELL / 2, { size: 16, color }); // full alpha
  if (used) drawDoneBadge(ctx, x, y);
}

function drawCnot(ctx, cnot, sheet) {
  const [cxCell, cyCell] = cnot.control;
  const [txCell, tyCell] = cnot.target;
  const cx = px(cxCell) + CELL / 2;
  const cy = px(cyCell) + CELL / 2;
  const tx = px(txCell) + CELL / 2;
  const ty = px(tyCell) + CELL / 2;
  // The cable only makes sense between neighbouring cells (the wall niche); far apart, each cell carries a CX label.
  const adjacent = Math.abs(cxCell - txCell) + Math.abs(cyCell - tyCell) === 1;
  if (adjacent) line(ctx, cx, cy, tx, ty, COLORS.centerEdge, 4); // cable
  if (!(sheet && drawTile(ctx, sheet, cnotTile(cnot, 'control'), px(cxCell), px(cyCell)))) {
    circle(ctx, cx, cy, 7, { fill: COLORS.alice });
    circle(ctx, cx, cy, 10, { stroke: COLORS.text, width: 1 });
  }
  if (!(sheet && drawTile(ctx, sheet, cnotTile(cnot, 'target'), px(txCell), px(tyCell)))) {
    circle(ctx, tx, ty, 10, { fill: '#0E1116', stroke: COLORS.bob, width: 2 });
    line(ctx, tx - 10, ty, tx + 10, ty, COLORS.bob, 2);
    line(ctx, tx, ty - 10, tx, ty + 10, COLORS.bob, 2);
  }
  if (!adjacent) {
    text(ctx, 'CX', cx, px(cyCell) + CELL - 4, { size: 8 });
    text(ctx, 'CX', tx, px(tyCell) + CELL - 4, { size: 8 });
  }
}

function drawExit(ctx, exit, snap, sheet, t, reduceMotion) {
  const x = px(exit.x);
  const y = px(exit.y);
  const color = playerColor(exit.player);
  const letter = exit.player === 'alice' ? 'A' : 'B';
  if (sheet && drawTile(ctx, sheet, exitTile(exit, snap, t, reduceMotion), x, y)) { // identity by border + letter, not only by color
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

function drawOverlay(ctx, view, { w, h }) {
  if (!view.overlay) return;
  ctx.fillStyle = COLORS.overlay;
  ctx.fillRect(0, 0, w, h);
  const dead = view.overlay === 'dead';
  text(ctx, dead ? 'Wavefunction collapsed' : 'Level complete', w / 2, h / 2 - 14,
    { size: 28, color: dead ? '#FF8A93' : '#8BE69A' });
  const msg = view.message ?? (dead ? 'Restarting level...' : 'Press Enter to return to menu');
  text(ctx, msg, w / 2, h / 2 + 22, { size: 16, bold: false });
}

/**
 * @param {HTMLCanvasElement} canvas its logical size follows the grid of the world being drawn (cells x 32 px)
 * @param {{ reduceMotion?: boolean }} [opts]
 */
export function createRenderer(canvas, { reduceMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  let reduce = reduceMotion;
  let scale = 1; // backing-store pixels per logical pixel; draw() applies it with setTransform
  let size = { w: 640, h: 384 }; // logical size of the last drawn grid (a 20x12 map until the first draw)
  ctx.imageSmoothingEnabled = false;
  const resize = () => {
    canvas.width = size.w * scale;
    canvas.height = size.h * scale;
    ctx.imageSmoothingEnabled = false; // a resize resets the context state
  };
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
    /** Integer backing-store scale (see layout.fitCanvas). Resizing clears the canvas; the next draw() repaints it. */
    setScale(n) {
      const next = Math.round(n);
      if (!(next >= 1) || next === scale) return;
      scale = next;
      resize();
    },
    /**
     * @param world entities.createWorld() result
     * @param snap engine snapshot
     * @param {{ mode: string, active: string, overlay: null|'dead'|'win', message?: string }} view
     * @param {number} t time in ms (requestAnimationFrame timestamp)
     */
    draw(world, snap, view, t = 0) {
      const { grid } = world;
      const next = logicalSize(grid);
      if (next.w !== size.w || next.h !== size.h) { size = next; resize(); } // a level with another map size
      const sheet = themeSheet(grid);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(scale, 0, 0, scale, 0, 0); // draw in logical units whatever the backing size
      ctx.clearRect(0, 0, size.w, size.h);
      drawFloor(ctx, grid, sheet);
      drawWalls(ctx, grid, sheet);
      drawDecorations(ctx, grid, sheet, true, t, reduce);  // floor decals: mats, grates, cables, light pools
      drawDecorations(ctx, grid, sheet, false, t, reduce); // furniture, wall mounts
      if (snap) {
        for (const door of world.doors) drawDoor(ctx, door, snap, sheet, t, reduce);
        for (const sensor of world.sensors) drawSensor(ctx, sensor, snap, sheet);
      }
      for (const term of world.terminals) drawTerminal(ctx, term, sheet);
      if (world.cnot) drawCnot(ctx, world.cnot, sheet);
      for (const exit of world.exits) drawExit(ctx, exit, snap, sheet, t, reduce);
      for (const id of ['alice', 'bob']) {
        const player = world.players[id];
        drawPlayer(ctx, player, view, track(player, t), t, reduce);
      }
      drawOverlay(ctx, view, size);
    },
  };
}

// Pure adapter: engine level JSON (schema v2, `stages[]`, cells as [row, col]) -> the flat
// stage view that grid.parseLevel() reads (cells as [x, y] = [col, row]). No DOM, no engine calls.

const toXY = ([row, col]) => [col, row];

function convertTerminal(t) {
  const out = { ...t };
  if (Array.isArray(t.cell)) out.cell = toXY(t.cell);
  if (Array.isArray(t.target_cell)) out.target_cell = toXY(t.target_cell);
  return out;
}

// Decorations are visual-only: sprite name, top-left cell and footprint [w, h] in tiles.
const convertDecoration = (d) => ({ ...d, cell: toXY(d.cell) });

/**
 * @param {object} level parsed levels/levelN.json (v2), or a legacy flat level (returned as is)
 * @param {number} stageIndex index into level.stages (snapshot.stage_index)
 */
export function stageView(level, stageIndex) {
  if (!level || typeof level !== 'object') throw new Error(`stageView: level must be an object, got ${level}`);
  if (!Array.isArray(level.stages)) return level; // legacy flat format
  const id = level.id ?? '?';
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= level.stages.length) {
    throw new Error(`Level "${id}": stage index ${String(stageIndex)} is out of range (0..${level.stages.length - 1})`);
  }
  const stage = level.stages[stageIndex];
  return {
    id,
    stageId: stage.id,
    title: stage.title ?? level.title,
    map: stage.map,
    legend: stage.legend ?? {},
    objects: stage.objects ?? {},
    terminals: (stage.terminals ?? []).map(convertTerminal),
    decorations: (stage.decorations ?? []).map(convertDecoration),
    win: stage.win,
    failure_policy: stage.failure_policy,
    narration: stage.narration ?? {},
    initial_circuit: stage.initial_circuit ?? [],
    gate_set: stage.gate_set,
    max_gates: stage.max_gates,
  };
}

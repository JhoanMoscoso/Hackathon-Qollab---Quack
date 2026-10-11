const COLORS = ['#4adbe6', '#a66cff', '#5bbf6a', '#f5a742'];

/** Frame-driven, pixel-aligned transition overlay. The caller owns timing and animation frames. */
export function createTransitionView(root) {
  const title = root.querySelector('#transition-title');
  const message = root.querySelector('#transition-message');
  const canvas = root.querySelector('#transition-effect');
  const context = canvas?.getContext('2d');
  let intro = '';

  function show({ title: nextTitle, message: nextMessage, ending = false }) {
    root.hidden = false;
    title.textContent = nextTitle ?? '';
    intro = nextMessage ?? '';
    message.textContent = intro;
    root.style.opacity = '1';
    title.style.opacity = '0';
    root.dataset.phase = '';
    root.dataset.ending = String(Boolean(ending));
  }

  function update(progress, now, reduceMotion) {
    const value = Math.max(0, Math.min(1, Number(progress) || 0));
    const mapOpacity = reduceMotion ? 0 : 1 - Math.min(1, Math.max(0, (value - 0.15) / 0.45));
    const phaseName = reduceMotion ? 'arrival' : value < 0.25 ? 'success' : value < 0.7 ? 'energy' : 'arrival';
    if (root.dataset.phase !== phaseName) {
      root.dataset.phase = phaseName;
      message.textContent = phaseName === 'success' ? 'REGISTER STABLE'
        : phaseName === 'energy' ? 'Resolving the interference…' : intro;
    }
    title.style.opacity = reduceMotion ? '1' : String(Math.min(1, Math.max(0, (value - 0.6) / 0.15)));
    root.style.opacity = !reduceMotion && root.dataset.ending !== 'true' && value > 0.88
      ? String(Math.max(0, (1 - value) / 0.12)) : '1';
    if (!context || reduceMotion) {
      if (context) context.clearRect(0, 0, canvas.width, canvas.height);
      return { mapOpacity };
    }

    const bounds = canvas.getBoundingClientRect();
    if (bounds.width && bounds.height) {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(bounds.width * dpr));
      const height = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const phase = value < 0.25 ? 0 : value < 0.7 ? 1 : 2;
    const phaseProgress = phase === 0 ? value / 0.25 : phase === 1 ? (value - 0.25) / 0.45 : (value - 0.7) / 0.3;
    const tick = Math.floor((Number(now) || 0) / 90);
    const unit = Math.max(2, Math.floor(width / 80));
    const rows = Math.max(1, Math.floor(height / unit));

    // Compact blocks gather, travel as a stepped wave, then resolve into a quiet title frame.
    for (let column = 0; column < 32; column += 1) {
      const wave = phase === 0
        ? Math.abs(column - 15.5) / 15.5 <= phaseProgress
        : phase === 1
          ? (column / 31) <= phaseProgress
          : (column / 31) >= phaseProgress;
      if (!wave) continue;
      const x = Math.floor(column * width / 32 / unit) * unit;
      const row = (column * 7 + tick + phase * 3) % rows;
      const color = COLORS[(column + Math.floor(tick / 2)) % COLORS.length];
      context.fillStyle = color;
      context.fillRect(x, row * unit, unit * (1 + (column % 3 === 0 ? 1 : 0)), unit);
      if (phase === 1 && column % 4 === tick % 4) {
        context.fillRect(x, Math.max(0, row - 2) * unit, unit, unit);
        context.fillRect(x, Math.min(rows - 1, row + 2) * unit, unit, unit);
      }
    }
    return { mapOpacity };
  }

  function hide() {
    root.hidden = true;
    if (context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { show, update, hide };
}

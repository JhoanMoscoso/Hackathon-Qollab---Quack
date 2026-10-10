// Pure diagnostic runner: own Python module calls always go through callPromising.
export async function callEngine(engine, name, args = [], now = () => performance.now()) {
  const start = now();
  const raw = await engine[name].callPromising(...args);
  const result = JSON.parse(raw);
  if (result?.error) throw new Error(`${result.code ?? name}: ${result.error}`);
  return { result, ms: now() - start };
}

export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return { samples: sorted.length, p50_ms: percentile(0.5), p95_ms: percentile(0.95), max_ms: sorted.at(-1) };
}

export async function runProbe(engine, backend, now = () => performance.now()) {
  const call = async (name, ...args) => (await callEngine(engine, name, args, now)).result;
  await call('load_level', 'level2');
  await call('new_session', 'level2');
  const precompute = await callEngine(engine, 'precompute', [backend, 200], now);
  const initial = await call('snapshot');

  await call('apply_gate', 'x', 1);
  const alice = await call('measure', 0);
  const bob = await call('measure', 1);
  if (alice.outcome === bob.outcome || !bob.snapshot.objective.quantum_ready) {
    throw new Error('L2 opposites did not satisfy its ideal objective');
  }

  const times = { apply_gate: [], measure: [], snapshot: [] };
  for (let iteration = 0; iteration < 23; iteration++) {
    await call('reset_stage');
    for (const [name, args] of [['apply_gate', ['x', 1]], ['measure', [0]], ['snapshot', []]]) {
      const { ms } = await callEngine(engine, name, args, now);
      if (iteration >= 3) times[name].push(ms);
    }
  }
  const timings = Object.fromEntries(Object.entries(times).map(([name, values]) => [name, summarize(values)]));
  return {
    environment: 'Qollab JS → Python → JSON (no render; precompute excluded)',
    precompute_ms: precompute.ms,
    precompute: precompute.result,
    initial_bell_counts: initial.sampling.counts,
    initial_source: initial.source,
    measurements: { alice: alice.outcome, bob: bob.outcome,
      alice_source: alice.snapshot.last_measurement.source, bob_source: bob.snapshot.last_measurement.source },
    warmups: 3, samples_per_operation: 20, timings,
    target_20ms_met: timings.apply_gate.p95_ms < 20 && timings.measure.p95_ms < 20,
  };
}

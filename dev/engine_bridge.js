// Dev-only stand-in for the Qollab `quantum.engine` module: every call is a
// POST to dev/engine_server.py, which runs the real Python/Qiskit engine.
// Each export mirrors Pyodide's `{ callPromising }` shape and resolves to the
// engine's JSON string (including error payloads on 4xx/5xx).

async function post(name, args) {
  try {
    const response = await globalThis.fetch(`/engine/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
    });
    return await response.text();
  } catch (error) {
    return JSON.stringify({ error: `Engine bridge failed: ${error?.message ?? error}`, code: 'BRIDGE_ERROR' });
  }
}

const make = (name, mapArgs = (args) => args) => ({ callPromising: async (...args) => post(name, mapArgs(args)) });

export const load_level = make('load_level');
export const new_session = make('new_session');
// window.backend is not serialisable: the server always substitutes None.
export const precompute = make('precompute', (args) => [null, ...args.slice(1)]);
export const apply_gate = make('apply_gate');
export const measure = make('measure');
export const reset_level = make('reset_level');
export const reset_stage = make('reset_stage');
export const advance_stage = make('advance_stage');
export const snapshot = make('snapshot');
export const load_audio = make('load_audio');
export const run_circuit = make('run_circuit');

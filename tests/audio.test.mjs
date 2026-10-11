// Tests for js/audio.js: pure SFX plan / helpers, plus createAudio against a fake Web Audio. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sfxPlan, trackForLevel, gateSfx, base64ToArrayBuffer, createAudio, DEFAULTS } from '../js/audio.js';
import { SFX_DATA } from '../js/sfx_data.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// ---------- sfxPlan ----------
test('wave_type 0..3 -> sine, triangle, square, noise', () => {
  assert.equal(sfxPlan({ wave_type: 0 }).wave, 'sine');
  assert.equal(sfxPlan({ wave_type: 1 }).wave, 'triangle');
  assert.equal(sfxPlan({ wave_type: 2 }).wave, 'square');
  const noise = sfxPlan({ wave_type: 3 });
  assert.equal(noise.wave, 'noise');
  assert.equal(sfxPlan({}).wave, 'sine'); // default
  assert.equal(sfxPlan({ wave_type: 9 }).wave, 'sine'); // unknown -> default
});

test('p_base_freq x 1000 is Hz (0.44 -> 440, 0.52 -> 520, 0.65 -> 650, 0.32 -> 320)', () => {
  close(sfxPlan(SFX_DATA.gate_H).startHz, 440);
  close(sfxPlan(SFX_DATA.gate_X).startHz, 520);
  close(sfxPlan(SFX_DATA.gate_Z).startHz, 650);
  close(sfxPlan(SFX_DATA.gate_CX).startHz, 320);
});

test('start frequency is clamped to a sane audible range', () => {
  assert.equal(sfxPlan({ p_base_freq: 0 }).startHz, 40);
  assert.equal(sfxPlan({ p_base_freq: 50 }).startHz, 12000);
});

test('p_freq_ramp is relative: end = start x (1 + ramp), clamped', () => {
  const up = sfxPlan({ p_base_freq: 0.44, p_freq_ramp: 0.2 });
  close(up.endHz, 440 * 1.2);
  const down = sfxPlan({ p_base_freq: 0.5, p_freq_ramp: -0.4 });
  close(down.endHz, 300);
  assert.equal(sfxPlan({ p_base_freq: 0.5 }).endHz, 500); // no ramp: constant
  assert.equal(sfxPlan({ p_base_freq: 0.5, p_freq_ramp: -5 }).endHz, 40); // never below the floor
  assert.equal(sfxPlan({ p_base_freq: 0.9, p_freq_ramp: 20 }).endHz, 12000);
});

test('envelope times are seconds; duration is attack + sustain + decay', () => {
  const p = sfxPlan({ p_env_attack: 0.01, p_env_sustain: 0.05, p_env_decay: 0.12 });
  assert.equal(p.attack, 0.01);
  assert.equal(p.sustain, 0.05);
  assert.equal(p.decay, 0.12);
  close(p.duration, 0.18);
  assert.ok(sfxPlan({}).duration >= 0.01); // never zero-length
});

test('p_lpf_freq maps 0..1 to 200 Hz..12 kHz (log scale); absent -> no filter', () => {
  assert.equal(sfxPlan({}).filter, null);
  close(sfxPlan({ p_lpf_freq: 0 }).filter.startHz, 200);
  close(sfxPlan({ p_lpf_freq: 1 }).filter.startHz, 12000);
  const mid = sfxPlan({ p_lpf_freq: 0.5 }).filter.startHz;
  close(mid, Math.sqrt(200 * 12000), 1e-6);
});

test('p_lpf_ramp is relative to the cutoff and clamped', () => {
  const f = sfxPlan({ p_lpf_freq: 0.8, p_lpf_ramp: -0.6 }).filter;
  close(f.endHz, f.startHz * 0.4);
  const flat = sfxPlan({ p_lpf_freq: 0.3 }).filter;
  assert.equal(flat.endHz, flat.startHz);
  assert.equal(sfxPlan({ p_lpf_freq: 0.1, p_lpf_ramp: -5 }).filter.endHz, 200);
  assert.equal(sfxPlan({ p_lpf_freq: 0.9, p_lpf_ramp: 5 }).filter.endHz, 12000);
});

test('arpeggio: jump after p_arp_speed seconds by freq x (1 + p_arp_mod); absent otherwise', () => {
  assert.equal(sfxPlan({ p_base_freq: 0.5 }).arp, null);
  const w = sfxPlan(SFX_DATA.win);
  assert.equal(w.arp.atSec, 0.08);
  assert.equal(w.arp.ratio, 1.5);
  assert.equal(sfxPlan({ p_arp_speed: 0.1 }).arp, null); // no mod -> nothing to jump
  assert.equal(sfxPlan({ p_arp_mod: 0.5 }).arp, null);   // no speed -> never
});

test('sound_vol is the gain, clamped to 0..1', () => {
  assert.equal(sfxPlan({ sound_vol: 0.35 }).gain, 0.35);
  assert.equal(sfxPlan({ sound_vol: 7 }).gain, 1);
  assert.equal(sfxPlan({ sound_vol: -1 }).gain, 0);
});

test('non-numeric params fall back to defaults instead of producing NaN', () => {
  const p = sfxPlan({ p_base_freq: 'x', p_env_sustain: NaN, sound_vol: undefined, p_freq_ramp: null });
  for (const v of [p.startHz, p.endHz, p.duration, p.gain]) assert.ok(Number.isFinite(v));
});

test('every bundled SFX yields a finite plan', () => {
  for (const [name, params] of Object.entries(SFX_DATA)) {
    const p = sfxPlan(params);
    for (const v of [p.startHz, p.endHz, p.duration, p.gain, p.attack, p.sustain, p.decay]) assert.ok(Number.isFinite(v), name);
    assert.ok(p.duration > 0 && p.duration < 1, name);
  }
});

// ---------- small pure helpers ----------
test('trackForLevel: level1 -> level1; level2 and level3 -> level2; unknown -> null', () => {
  assert.equal(trackForLevel('level1'), 'level1');
  assert.equal(trackForLevel('level2'), 'level2');
  assert.equal(trackForLevel('level3'), 'level2');
  assert.equal(trackForLevel('nope'), null);
  assert.equal(trackForLevel(undefined), null);
});

test('gateSfx maps engine gate names to SFX names', () => {
  assert.equal(gateSfx('h'), 'gate_H');
  assert.equal(gateSfx('x'), 'gate_X');
  assert.equal(gateSfx('z'), 'gate_Z');
  assert.equal(gateSfx('cx'), 'gate_CX');
  assert.equal(gateSfx('cnot'), 'gate_CX');
  assert.equal(gateSfx('zzz'), null);
  assert.equal(gateSfx(undefined), null);
});

test('base64ToArrayBuffer decodes bytes', () => {
  const buf = base64ToArrayBuffer(Buffer.from('OggS-test').toString('base64'));
  assert.deepEqual([...new Uint8Array(buf)], [...Buffer.from('OggS-test')]);
});

// ---------- fake Web Audio ----------
class Param {
  constructor(value = 0) { this.value = value; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); return this; }
  setTargetAtTime(v, t, k) { this.calls.push(['target', v, t, k]); this.value = v; return this; }
  cancelScheduledValues(t) { this.calls.push(['cancel', t]); return this; }
}
class Node {
  constructor(kind, ctx) { this.kind = kind; this.ctx = ctx; this.connections = []; ctx.nodes.push(this); }
  connect(n) { this.connections.push(n); return n; }
  disconnect() { this.connections = []; }
}
function makeFakeCtor({ state = 'suspended', decodeFails = false } = {}) {
  const instances = [];
  class FakeContext {
    constructor() {
      this.nodes = []; this.state = state; this.currentTime = 10; this.sampleRate = 48000;
      this.destination = new Node('destination', this); this.resumeCalls = 0; this.decoded = 0;
      instances.push(this);
    }
    resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
    createGain() { const n = new Node('gain', this); n.gain = new Param(1); return n; }
    createOscillator() {
      const n = new Node('osc', this); n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0);
      n.start = (t) => { n.startedAt = t; }; n.stop = (t) => { n.stoppedAt = t; }; return n;
    }
    createBufferSource() {
      const n = new Node('bufsrc', this); n.buffer = null; n.loop = false; n.playbackRate = new Param(1); n.detune = new Param(0);
      n.start = (t) => { n.startedAt = t; }; n.stop = (t) => { n.stoppedAt = t; }; return n;
    }
    createBiquadFilter() { const n = new Node('filter', this); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); return n; }
    createBuffer(ch, len, rate) { return { channels: ch, length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) }; }
    decodeAudioData(ab) {
      this.decoded++;
      return decodeFails ? Promise.reject(new Error('bad data')) : Promise.resolve({ decodedFrom: ab.byteLength, duration: 90 });
    }
  }
  FakeContext.instances = instances;
  return FakeContext;
}
const payloadFor = () => ({ mime: 'audio/ogg', encoding: 'base64', data: Buffer.from('OggS-test').toString('base64') });
const tick = () => new Promise((r) => setTimeout(r, 0));
const kinds = (ctx, kind) => ctx.nodes.filter((n) => n.kind === kind);

function setup(opts = {}) {
  const Ctor = makeFakeCtor(opts);
  const fetched = [];
  let clock = 1000;
  const audio = createAudio({
    AudioContextCtor: Ctor,
    fetchTrack: async (t) => { fetched.push(t); if (opts.fetchFails) throw new Error('engine says no'); return payloadFor(); },
    now: () => clock,
    log: () => {},
  });
  return { audio, Ctor, fetched, ctx: () => Ctor.instances[0], advance: (ms) => { clock += ms; } };
}

test('defaults: music 0.5, sfx 0.8, sound on', () => {
  assert.equal(DEFAULTS.musicVolume, 0.5);
  assert.equal(DEFAULTS.sfxVolume, 0.8);
  const { audio } = setup();
  assert.equal(audio.status().muted, false);
});

test('no Web Audio: everything is a harmless no-op', async () => {
  const audio = createAudio({ AudioContextCtor: undefined, fetchTrack: async () => { throw new Error('must not be called'); }, log: () => {} });
  assert.equal(audio.unlock(), false);
  assert.equal(audio.play('click'), false);
  await audio.playMusic('menu');
  audio.stopMusic(); audio.setMuted(true); audio.setMusicVolume(0.1); audio.setSfxVolume(0.1);
  assert.equal(audio.status().context, 'unavailable');
});

test('nothing is created before the first unlock; unlock creates and resumes the context once', () => {
  const { audio, Ctor, ctx } = setup();
  assert.equal(Ctor.instances.length, 0);
  assert.equal(audio.play('click'), false); // before unlock: silently ignored
  assert.equal(audio.unlock(), true);
  assert.equal(Ctor.instances.length, 1);
  assert.equal(ctx().resumeCalls, 1);
  assert.equal(audio.status().context, 'running');
  audio.unlock();
  assert.equal(Ctor.instances.length, 1);
  assert.equal(ctx().resumeCalls, 1); // already running: no resume
});

test('constructor that throws -> unlock returns false and never throws', () => {
  const audio = createAudio({ AudioContextCtor: class { constructor() { throw new Error('nope'); } }, fetchTrack: async () => payloadFor(), log: () => {} });
  assert.equal(audio.unlock(), false);
  assert.equal(audio.play('click'), false);
});

test('play(oscillator sfx) builds osc -> gain -> sfx bus with the planned envelope and sweep', () => {
  const { audio, ctx } = setup();
  audio.unlock();
  assert.equal(audio.play('gate_H'), true);
  const c = ctx();
  const osc = kinds(c, 'osc')[0];
  const plan = sfxPlan(SFX_DATA.gate_H);
  assert.equal(osc.type, 'sine');
  assert.equal(osc.startedAt, c.currentTime);
  assert.ok(osc.stoppedAt >= c.currentTime + plan.duration);
  const f = osc.frequency.calls;
  assert.deepEqual(f[0], ['set', 440, c.currentTime]);
  close(f.at(-1)[1], plan.endHz);
  const env = osc.connections[0];
  assert.equal(env.kind, 'gain');
  const peak = env.gain.calls.find((x) => x[0] === 'lin');
  close(peak[1], plan.gain);
  assert.equal(env.connections.length, 1); // goes to the SFX bus
});

test('play(noise sfx with lowpass) uses a looping noise buffer through a biquad lowpass', () => {
  const { audio, ctx } = setup();
  audio.unlock();
  audio.play('death');
  const c = ctx();
  const src = kinds(c, 'bufsrc')[0];
  assert.equal(src.loop, true);
  assert.ok(src.buffer);
  const filter = kinds(c, 'filter')[0];
  assert.equal(filter.type, 'lowpass');
  assert.equal(src.connections[0], filter);
  const plan = sfxPlan(SFX_DATA.death);
  close(filter.frequency.calls[0][1], plan.filter.startHz);
  close(filter.frequency.calls.at(-1)[1], plan.filter.endHz);
});

test('arpeggio schedules a detune jump (win: x1.5 after 80 ms)', () => {
  const { audio, ctx } = setup();
  audio.unlock();
  audio.play('win');
  const osc = kinds(ctx(), 'osc')[0];
  const jump = osc.detune.calls.find((x) => x[0] === 'set' && x[1] !== 0);
  assert.ok(jump);
  close(jump[1], 1200 * Math.log2(1.5), 1e-6);
  close(jump[2], ctx().currentTime + 0.08);
});

test('play(name, {delay}) shifts the start time', () => {
  const { audio, ctx } = setup();
  audio.unlock();
  audio.play('click', { delay: 0.12 });
  close(kinds(ctx(), 'osc')[0].startedAt, ctx().currentTime + 0.12);
});

test('unknown sfx name is a no-op that returns false', () => {
  const { audio, ctx } = setup();
  audio.unlock();
  assert.equal(audio.play('nope'), false);
  assert.equal(kinds(ctx(), 'osc').length, 0);
});

test('step is throttled per key (~120 ms), other sounds are not', () => {
  const { audio, ctx, advance } = setup();
  audio.unlock();
  assert.equal(audio.play('step', { key: 'alice' }), true);
  advance(50);
  assert.equal(audio.play('step', { key: 'alice' }), false);
  assert.equal(audio.play('step', { key: 'bob' }), true); // independent key
  advance(100);
  assert.equal(audio.play('step', { key: 'alice' }), true);
  assert.equal(audio.play('click'), true);
  assert.equal(audio.play('click'), true);
  assert.equal(kinds(ctx(), 'bufsrc').length, 3); // 3 steps (noise)
});

test('muted: sfx are skipped, master gain is 0, and unmuting restores it', () => {
  const { audio, ctx } = setup();
  audio.setMuted(true); // before unlock: remembered
  audio.unlock();
  assert.equal(audio.play('click'), false);
  const master = ctx().destination && kinds(ctx(), 'gain').find((g) => g.connections.includes(ctx().destination));
  assert.equal(master.gain.value, 0);
  audio.setMuted(false);
  assert.equal(master.gain.value, 1);
  assert.equal(audio.play('click'), true);
  assert.equal(audio.status().muted, false);
});

test('volumes: music 0.5 / sfx 0.8 by default, setters clamp to 0..1', () => {
  const { audio, ctx } = setup();
  audio.unlock();
  const [, ...rest] = kinds(ctx(), 'gain');
  const values = rest.map((g) => g.gain.value).sort();
  assert.ok(values.includes(0.5) && values.includes(0.8));
  audio.setMusicVolume(2);
  assert.equal(audio.status().musicVolume, 1);
  audio.setSfxVolume(-1);
  assert.equal(audio.status().sfxVolume, 0);
});

test('playMusic before unlock is remembered and starts at unlock; the engine is called once', async () => {
  const { audio, fetched, ctx } = setup();
  await audio.playMusic('menu');
  assert.deepEqual(fetched, []);
  assert.equal(audio.status().track, 'menu'); // wanted
  audio.unlock();
  await tick(); await tick();
  assert.deepEqual(fetched, ['menu']);
  const src = kinds(ctx(), 'bufsrc').find((s) => s.buffer?.decodedFrom);
  assert.ok(src, 'music source created');
  assert.equal(src.loop, true);
  assert.equal(src.startedAt !== undefined, true);
  assert.equal(audio.status().playing, 'menu');
});

test('same track requested again is ignored (no fetch, no new source)', async () => {
  const { audio, fetched, ctx } = setup();
  audio.unlock();
  await audio.playMusic('level1');
  const before = ctx().nodes.length;
  await audio.playMusic('level1');
  assert.deepEqual(fetched, ['level1']);
  assert.equal(ctx().nodes.length, before);
});

test('switching track crossfades: old gain ramps to 0 and stops, new gain ramps up; buffers are cached', async () => {
  const { audio, fetched, ctx } = setup();
  audio.unlock();
  await audio.playMusic('menu');
  const first = kinds(ctx(), 'bufsrc').find((s) => s.buffer?.decodedFrom);
  const firstGain = first.connections[0];
  await audio.playMusic('level1');
  assert.ok(firstGain.gain.calls.some((c) => c[0] === 'lin' && c[1] === 0), 'old track fades out');
  assert.ok(first.stoppedAt > ctx().currentTime, 'old source stops after the fade');
  const second = kinds(ctx(), 'bufsrc').filter((s) => s.buffer?.decodedFrom)[1];
  assert.ok(second.connections[0].gain.calls.some((c) => c[0] === 'lin' && c[1] === 1), 'new track fades in');
  await audio.playMusic('menu'); // back: decoded buffer reused
  assert.deepEqual(fetched, ['menu', 'level1', 'menu'].filter((t, i, a) => a.indexOf(t) === i));
  assert.equal(ctx().decoded, 2);
  assert.equal(audio.status().playing, 'menu');
});

test('stopMusic fades out and forgets the wanted track', async () => {
  const { audio, ctx } = setup();
  audio.unlock();
  await audio.playMusic('menu');
  audio.stopMusic();
  assert.equal(audio.status().track, null);
  assert.equal(audio.status().playing, null);
  const src = kinds(ctx(), 'bufsrc').find((s) => s.buffer?.decodedFrom);
  assert.ok(src.stoppedAt > ctx().currentTime);
});

test('a late result for a track that is no longer wanted is dropped', async () => {
  const { audio, ctx } = setup();
  audio.unlock();
  const slow = audio.playMusic('menu');
  const fast = audio.playMusic('level1'); // supersedes menu before it resolves
  await Promise.all([slow, fast]);
  assert.equal(audio.status().playing, 'level1');
  assert.equal(kinds(ctx(), 'bufsrc').filter((s) => s.buffer?.decodedFrom && s.startedAt !== undefined).length, 1);
});

test('fetch failure is logged, never thrown, and a retry is allowed', async () => {
  const logs = [];
  const Ctor = makeFakeCtor();
  let fail = true;
  const audio = createAudio({ AudioContextCtor: Ctor, fetchTrack: async () => { if (fail) throw new Error('boom'); return payloadFor(); }, log: (...a) => logs.push(a), now: () => 0 });
  audio.unlock();
  await audio.playMusic('menu');
  assert.equal(audio.status().playing, null);
  assert.ok(logs.length >= 1);
  fail = false;
  await audio.playMusic('menu');
  assert.equal(audio.status().playing, 'menu');
});

test('engine error payload and decode failure are handled without throwing', async () => {
  const logs = [];
  const a1 = createAudio({ AudioContextCtor: makeFakeCtor(), fetchTrack: async () => ({ error: 'no file', code: 'AUDIO_UNAVAILABLE' }), log: (...a) => logs.push(a) });
  a1.unlock();
  await a1.playMusic('menu');
  assert.equal(a1.status().playing, null);
  const a2 = createAudio({ AudioContextCtor: makeFakeCtor({ decodeFails: true }), fetchTrack: async () => payloadFor(), log: (...a) => logs.push(a) });
  a2.unlock();
  await a2.playMusic('menu');
  assert.equal(a2.status().playing, null);
  assert.ok(logs.length >= 2);
});

test('sfx never throw even if the context misbehaves', () => {
  const { audio, ctx } = setup();
  audio.unlock();
  ctx().createOscillator = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => audio.play('click'));
  assert.equal(audio.play('click'), false);
});

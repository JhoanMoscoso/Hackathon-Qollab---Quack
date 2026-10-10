// Sound: synthesized SFX (Web Audio) and crossfaded background music.
// Pure parts (sfxPlan, trackForLevel, gateSfx, base64ToArrayBuffer) are unit-tested; createAudio takes the
// AudioContext constructor and the track fetcher as parameters so tests can fake both.
// Nothing here may throw into the game loop: a missing Web Audio or any failure turns into a logged no-op.
// Music data comes from the Python engine (load_audio) on demand, never per frame; see main.js for fetchTrack.
import { SFX_DATA } from './sfx_data.js';

export const DEFAULTS = Object.freeze({ musicVolume: 0.5, sfxVolume: 0.8 });

const FADE_S = 0.5;           // music crossfade
const MIN_HZ = 40;            // pitch clamp (oscillator / noise rate)
const MAX_HZ = 12000;
const LPF_MIN_HZ = 200;       // p_lpf_freq 0 -> 200 Hz, 1 -> 12 kHz, log scale
const LPF_MAX_HZ = 12000;
const NOISE_REF_HZ = 440;     // noise "pitch": playbackRate = Hz / 440
const MIN_ATTACK_S = 0.003;   // avoids a click when the sample attack is 0
const THROTTLE_MS = Object.freeze({ step: 120 }); // key-repeat must not spam footsteps
const WAVES = ['sine', 'triangle', 'square', 'noise'];
const TRACKS = Object.freeze({ level1: 'level1', level2: 'level2', level3: 'level3' }); // one track per level
const GATE_SFX = Object.freeze({ h: 'gate_H', x: 'gate_X', z: 'gate_Z', cx: 'gate_CX', cnot: 'gate_CX' });

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Turns one sound definition from sfx_data.js into concrete playback numbers.
 * The data is sfxr-like, but the semantics are the sound designer's (Samuel), as stated in his comments:
 *   wave_type     0 sine, 1 triangle, 2 square, 3 noise (white noise whose "pitch" is its playback rate).
 *   p_base_freq   x 1000 = Hz (0.44 -> 440 Hz). Clamped to 40 Hz..12 kHz.
 *   p_freq_ramp   relative sweep over the whole sound: end = start x (1 + ramp), clamped to the same range.
 *   p_env_*       attack / sustain / decay in seconds; duration is their sum (decay ramps to silence).
 *   p_lpf_freq    0..1 lowpass cutoff, log-mapped to 200 Hz..12 kHz; absent = no filter.
 *   p_lpf_ramp    relative cutoff sweep over the sound (end = start x (1 + ramp)).
 *   p_arp_speed   seconds until the arpeggio jump; p_arp_mod = jump ratio (freq x (1 + mod)). Needs both.
 *   sound_vol     gain 0..1.
 */
export function sfxPlan(p = {}) {
  const wave = WAVES[num(p.wave_type, 0)] ?? 'sine';
  const attack = Math.max(0, num(p.p_env_attack, 0));
  const sustain = Math.max(0, num(p.p_env_sustain, 0));
  const decay = Math.max(0, num(p.p_env_decay, 0.05));
  const duration = Math.max(0.01, attack + sustain + decay);
  const startHz = clamp(num(p.p_base_freq, 0.3) * 1000, MIN_HZ, MAX_HZ);
  const endHz = clamp(startHz * (1 + num(p.p_freq_ramp, 0)), MIN_HZ, MAX_HZ);

  let filter = null;
  if (typeof p.p_lpf_freq === 'number' || typeof p.p_lpf_ramp === 'number') {
    const f = clamp(num(p.p_lpf_freq, 1), 0, 1);
    const cutoff = LPF_MIN_HZ * (LPF_MAX_HZ / LPF_MIN_HZ) ** f;
    filter = { startHz: cutoff, endHz: clamp(cutoff * (1 + num(p.p_lpf_ramp, 0)), LPF_MIN_HZ, LPF_MAX_HZ) };
  }

  const atSec = num(p.p_arp_speed, 0);
  const mod = num(p.p_arp_mod, 0);
  const arp = atSec > 0 && mod !== 0 && 1 + mod > 0 ? { atSec, ratio: 1 + mod } : null;

  return { wave, attack, sustain, decay, duration, startHz, endHz, filter, arp, gain: clamp(num(p.sound_vol, 0.5), 0, 1) };
}

/** Level id -> music track key (the engine's load_audio track names), or null if unknown. */
export const trackForLevel = (levelId) => TRACKS[levelId] ?? null;

/** Engine gate name -> SFX name, or null. */
export const gateSfx = (gate) => GATE_SFX[gate] ?? null;

export function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function decode(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject); // callback form for old browsers, promise for new
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/**
 * @param {{
 *   AudioContextCtor?: any,                       // default: window.AudioContext / webkitAudioContext
 *   fetchTrack: (track: string) => Promise<{data: string, error?: string}>, // engine load_audio payload (base64)
 *   sfxData?: object, now?: () => number, log?: (...a: any[]) => void,
 * }} opts
 */
export function createAudio({
  AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fetchTrack,
  sfxData = SFX_DATA,
  now = () => Date.now(),
  log = (...a) => console.warn('[audio]', ...a),
} = {}) {
  let ctx = null;
  let buses = null;               // { master, music, sfx } gain nodes
  let noiseBuffer = null;
  let muted = false;
  let musicVolume = DEFAULTS.musicVolume;
  let sfxVolume = DEFAULTS.sfxVolume;
  let wanted = null;              // track the game last asked for
  let current = null;             // { track, src, gain } currently audible
  let pendingTrack = null;
  let pendingPromise = null;
  let requestId = 0;
  const buffers = new Map();      // track -> Promise<AudioBuffer> (decoded once per page load)
  const lastPlayed = new Map();   // throttle key -> time

  const safe = (fn, fallback) => { try { return fn(); } catch (e) { log(String(e?.message ?? e)); return fallback; } };
  const ramp = (param, value) => safe(() => param.setTargetAtTime(value, ctx.currentTime, 0.02));

  function unlock() {
    if (!AudioContextCtor) return false;
    return safe(() => {
      if (!ctx) {
        ctx = new AudioContextCtor();
        const master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
        const music = ctx.createGain(); music.gain.value = musicVolume; music.connect(master);
        const sfx = ctx.createGain(); sfx.gain.value = sfxVolume; sfx.connect(master);
        buses = { master, music, sfx };
      }
      if (ctx.state !== 'running') Promise.resolve(ctx.resume?.()).catch((e) => log('resume failed', String(e?.message ?? e)));
      if (wanted && !current && !pendingTrack) startMusic(wanted).catch(() => {});
      return true;
    }, false);
  }

  function getNoiseBuffer() {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  /** @returns {boolean} true when the sound was scheduled */
  function play(name, { key = name, delay = 0 } = {}) {
    if (!ctx || muted) return false;
    const params = sfxData[name];
    if (!params) return false;
    const gap = THROTTLE_MS[name];
    const t0 = now();
    if (gap && t0 - (lastPlayed.get(key) ?? -Infinity) < gap) return false;
    return safe(() => {
      const plan = sfxPlan(params);
      const t = ctx.currentTime + Math.max(0, delay);
      const end = t + plan.duration;
      const isNoise = plan.wave === 'noise';
      const src = isNoise ? ctx.createBufferSource() : ctx.createOscillator();
      let pitch;
      if (isNoise) { src.buffer = getNoiseBuffer(); src.loop = true; pitch = src.playbackRate; } else { src.type = plan.wave; pitch = src.frequency; }
      const unit = isNoise ? 1 / NOISE_REF_HZ : 1;
      pitch.setValueAtTime(plan.startHz * unit, t);
      if (plan.endHz !== plan.startHz) pitch.exponentialRampToValueAtTime(plan.endHz * unit, end);
      if (plan.arp && plan.arp.atSec < plan.duration) {
        src.detune.setValueAtTime(0, t);
        src.detune.setValueAtTime(1200 * Math.log2(plan.arp.ratio), t + plan.arp.atSec); // multiplies the pitch
      }
      let head = src;
      if (plan.filter) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(plan.filter.startHz, t);
        if (plan.filter.endHz !== plan.filter.startHz) f.frequency.exponentialRampToValueAtTime(plan.filter.endHz, end);
        src.connect(f);
        head = f;
      }
      const env = ctx.createGain();
      const attackEnd = t + Math.max(plan.attack, MIN_ATTACK_S);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(plan.gain, attackEnd);
      env.gain.setValueAtTime(plan.gain, Math.max(attackEnd, t + plan.attack + plan.sustain));
      env.gain.exponentialRampToValueAtTime(0.0001, Math.max(end, attackEnd + 0.005));
      head.connect(env);
      env.connect(buses.sfx);
      src.start(t);
      src.stop(end + 0.05);
      src.onended = () => safe(() => { env.disconnect(); });
      lastPlayed.set(key, t0);
      return true;
    }, false);
  }

  function loadBuffer(track) {
    if (!buffers.has(track)) {
      const p = (async () => {
        const out = await fetchTrack(track);
        if (!out || out.error || typeof out.data !== 'string') throw new Error(out?.error ?? 'empty audio payload');
        return decode(ctx, base64ToArrayBuffer(out.data));
      })();
      buffers.set(track, p);
      p.catch(() => buffers.delete(track)); // a failure may be retried the next time the track is wanted
    }
    return buffers.get(track);
  }

  function fadeOut(entry) {
    if (!entry) return;
    safe(() => {
      const t = ctx.currentTime;
      entry.gain.gain.cancelScheduledValues(t);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, t);
      entry.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
      entry.src.stop(t + FADE_S + 0.05);
      entry.src.onended = () => safe(() => { entry.gain.disconnect(); });
    });
  }

  async function startMusic(track) {
    const id = ++requestId;
    pendingTrack = track;
    try {
      const buffer = await loadBuffer(track);
      if (id !== requestId || wanted !== track) return; // superseded while loading
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buffer; src.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + FADE_S);
      src.connect(gain); gain.connect(buses.music);
      src.start(t);
      fadeOut(current);
      current = { track, src, gain };
    } catch (e) {
      log(`music "${track}" unavailable:`, String(e?.message ?? e));
    } finally {
      if (id === requestId) pendingTrack = null;
    }
  }

  /** Ask for a background track ('menu' | 'level1' | 'level2' | 'level3'). Same track as now/loading: ignored. */
  function playMusic(track) {
    if (!track) return Promise.resolve();
    if (track === wanted && (current?.track === track || pendingTrack === track)) return pendingPromise ?? Promise.resolve();
    wanted = track;
    if (!ctx) return Promise.resolve(); // starts at unlock()
    pendingPromise = startMusic(track);
    return pendingPromise;
  }

  function stopMusic() {
    wanted = null;
    requestId++;
    pendingTrack = null;
    fadeOut(current);
    current = null;
  }

  return {
    unlock,
    play,
    playMusic,
    stopMusic,
    setMuted(value) { muted = !!value; if (ctx) ramp(buses.master.gain, muted ? 0 : 1); },
    setMusicVolume(v) { musicVolume = clamp(num(v, musicVolume), 0, 1); if (ctx) ramp(buses.music.gain, musicVolume); },
    setSfxVolume(v) { sfxVolume = clamp(num(v, sfxVolume), 0, 1); if (ctx) ramp(buses.sfx.gain, sfxVolume); },
    /** Snapshot for tests and debugging. */
    status: () => ({
      context: !AudioContextCtor ? 'unavailable' : ctx ? ctx.state : 'none',
      muted, musicVolume, sfxVolume, track: wanted, playing: current?.track ?? null,
    }),
  };
}

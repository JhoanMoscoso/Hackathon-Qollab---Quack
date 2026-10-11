// Ported from audio/sfx_data.js (Samuel, sound design) as an ES module: same values, no changes.
// The original is a classic script and is not packed for Qollab (only audio/*.ogg is); a node test keeps
// the two in sync. Parameter semantics are documented in js/audio.js (sfxPlan).
export const SFX_DATA = {
  // 1. Paso / Caminar
  step: {
    wave_type: 3,           // Ruido (Noise)
    p_env_attack: 0.0,
    p_env_sustain: 0.02,
    p_env_decay: 0.06,
    p_base_freq: 0.18,
    p_freq_ramp: -0.1,
    p_lpf_freq: 0.3,
    sound_vol: 0.25
  },

  // 2. Compuerta H (Hadamard - 440Hz ascendente)
  gate_H: {
    wave_type: 0,           // Senoidal (Sine)
    p_env_attack: 0.0,
    p_env_sustain: 0.05,
    p_env_decay: 0.12,
    p_base_freq: 0.44,
    p_freq_ramp: 0.2,
    sound_vol: 0.35
  },

  // 3. Compuerta X (Pauli-X - 523Hz)
  gate_X: {
    wave_type: 0,
    p_env_attack: 0.0,
    p_env_sustain: 0.05,
    p_env_decay: 0.12,
    p_base_freq: 0.52,
    p_freq_ramp: 0.15,
    sound_vol: 0.35
  },

  // 4. Compuerta Z (Pauli-Z - 659Hz)
  gate_Z: {
    wave_type: 0,
    p_env_attack: 0.0,
    p_env_sustain: 0.05,
    p_env_decay: 0.12,
    p_base_freq: 0.65,
    p_freq_ramp: 0.15,
    sound_vol: 0.35
  },

  // 5. Compuerta CNOT (CX - 329Hz grave)
  gate_CX: {
    wave_type: 1,           // Triangular
    p_env_attack: 0.0,
    p_env_sustain: 0.08,
    p_env_decay: 0.15,
    p_base_freq: 0.32,
    p_freq_ramp: 0.25,
    sound_vol: 0.4
  },

  // 6. Sensor de Medición
  measure: {
    wave_type: 1,
    p_env_attack: 0.0,
    p_env_sustain: 0.06,
    p_env_decay: 0.14,
    p_base_freq: 0.4,
    p_freq_ramp: 0.1,
    sound_vol: 0.35
  },

  // 7. Colapso a Estado 0 (Tono descendente grave)
  collapse0: {
    wave_type: 1,
    p_env_attack: 0.0,
    p_env_sustain: 0.04,
    p_env_decay: 0.15,
    p_base_freq: 0.35,
    p_freq_ramp: -0.35,
    sound_vol: 0.4
  },

  // 8. Colapso a Estado 1 (Tono ascendente agudo)
  collapse1: {
    wave_type: 2,           // Cuadrada (Square retro)
    p_env_attack: 0.0,
    p_env_sustain: 0.04,
    p_env_decay: 0.15,
    p_base_freq: 0.45,
    p_freq_ramp: 0.4,
    sound_vol: 0.3
  },

  // 9. Muerte / Disolución
  death: {
    wave_type: 3,
    p_env_attack: 0.0,
    p_env_sustain: 0.1,
    p_env_decay: 0.28,
    p_base_freq: 0.5,
    p_freq_ramp: -0.4,
    p_lpf_freq: 0.8,
    p_lpf_ramp: -0.6,
    sound_vol: 0.5
  },

  // 10. Victoria
  win: {
    wave_type: 0,
    p_env_attack: 0.0,
    p_env_sustain: 0.15,
    p_env_decay: 0.3,
    p_base_freq: 0.52,
    p_arp_speed: 0.08,
    p_arp_mod: 0.5,
    sound_vol: 0.4
  },

  // 11. Clic UI
  click: {
    wave_type: 0,
    p_env_attack: 0.0,
    p_env_sustain: 0.01,
    p_env_decay: 0.04,
    p_base_freq: 0.8,
    p_freq_ramp: -0.3,
    sound_vol: 0.25
  }
};

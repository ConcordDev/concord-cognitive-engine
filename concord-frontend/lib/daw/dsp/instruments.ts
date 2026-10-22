/**
 * Scheduled instruments: every note is its own voice with sample-accurate
 * start/stop on AudioContext time, so overlapping notes of the same pitch
 * work and the same code renders live and offline.
 */

import type { SynthPreset, OscillatorShape } from '../types';
import { mulberry32 } from './rng';

export interface Voice {
  stop(at?: number): void;
  /** Semitones, applied as oscillator detune. ±2 is the lane range. */
  bend?(semitones: number, at?: number): void;
  /** 0–1. Opens the filter from its base cutoff. CC 1 uses this. */
  modulate?(amount01: number, at?: number): void;
  /** 0–1. Scales the voice amp. CC 11 uses this. */
  level?(amount01: number, at?: number): void;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  const len = ctx.sampleRate; // 1 s, looped
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rnd = mulberry32(0xc0ffee);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Exponential pitch glide. The midpoint is the geometric mean. */
export function glideHz(fromHz: number, toHz: number, tSec: number, glideSec: number): number {
  if (!(toHz > 0)) return 0;
  if (!(fromHz > 0) || !(glideSec > 0) || tSec >= glideSec) return toHz;
  if (tSec <= 0) return fromHz;
  return fromHz * (toHz / fromHz) ** (tSec / glideSec);
}

function oscType(s: OscillatorShape): OscillatorType {
  if (s === 'sine' || s === 'square' || s === 'sawtooth' || s === 'triangle') return s;
  return s === 'pulse' || s === 'pwm' ? 'square' : 'sawtooth';
}

/** Play one synth note from `time` for `dur` seconds into `dest`. */
export function playSynthNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  preset: SynthPreset,
  pitch: number,
  velocity: number,
  time: number,
  dur: number,
  glideFromHz?: number,
): Voice {
  const env = preset.ampEnvelope;
  const fenv = preset.filterEnvelope;
  const vel = Math.max(0, Math.min(1, velocity / 127));
  const peak = 0.22 * (0.25 + 0.75 * vel);
  const a = Math.max(0.001, env.attack);
  const d = Math.max(0.005, env.decay);
  const s = Math.max(0, Math.min(1, env.sustain));
  const r = Math.max(0.01, env.release);
  const end = time + Math.max(0.01, dur);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + a);
  amp.gain.setTargetAtTime(peak * s, time + a, d / 3);
  amp.gain.setTargetAtTime(0, end, r / 4);

  const filter = ctx.createBiquadFilter();
  filter.type = (preset.filter.type as BiquadFilterType) || 'lowpass';
  const hz = midiToHz(pitch);
  const baseF = Math.min(20000, Math.max(30, preset.filter.frequency * Math.pow(hz / 261.63, preset.filter.keyTrack || 0)));
  const envAmt = Math.max(0, preset.filter.envelope || 0);
  const topF = Math.min(20000, baseF * (1 + envAmt * 4));
  filter.Q.value = Math.max(0.0001, preset.filter.resonance || 0.7);
  filter.frequency.setValueAtTime(baseF, time);
  if (envAmt > 0) {
    filter.frequency.linearRampToValueAtTime(topF, time + Math.max(0.001, fenv.attack));
    filter.frequency.setTargetAtTime(baseF + (topF - baseF) * fenv.sustain, time + fenv.attack, Math.max(0.005, fenv.decay) / 3);
  }
  filter.connect(amp).connect(dest);

  const stopAt = end + r * 1.5 + 0.05;
  const oscs: OscillatorNode[] = [];
  const baseDetune: number[] = [];
  const srcs: AudioScheduledSourceNode[] = [];
  const unison = Math.max(1, Math.min(4, preset.unison || 1));
  for (const o of preset.oscillators) {
    if (o.shape === 'noise') {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      n.loop = true;
      const g = ctx.createGain();
      g.gain.value = o.level * 0.5;
      n.connect(g).connect(filter);
      n.start(time);
      n.stop(stopAt);
      srcs.push(n);
      continue;
    }
    for (let u = 0; u < unison; u++) {
      const osc = ctx.createOscillator();
      osc.type = oscType(o.shape);
      const target = hz * Math.pow(2, o.octave || 0);
      const glideSec = Math.max(0, Math.min(2, preset.portamento || 0));
      const from = glideSec > 0 && glideFromHz && glideFromHz > 0 ? glideFromHz * Math.pow(2, o.octave || 0) : 0;
      if (from > 1 && Math.abs(from - target) > 0.5) {
        osc.frequency.setValueAtTime(from, time);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, target), time + glideSec);
      } else {
        osc.frequency.value = target;
      }
      const spread = unison > 1 ? ((u / (unison - 1)) * 2 - 1) * (preset.unisonDetune || 0) : 0;
      const detune = (o.detune || 0) + spread;
      osc.detune.value = detune;
      baseDetune.push(detune);
      const g = ctx.createGain();
      g.gain.value = (o.level || 0) / unison;
      osc.connect(g).connect(filter);
      osc.start(time);
      osc.stop(stopAt);
      oscs.push(osc);
      srcs.push(osc);
    }
  }
  return {
    stop(at?: number) {
      const t = Math.max(at ?? 0, (ctx as AudioContext).currentTime ?? 0);
      try {
        amp.gain.cancelScheduledValues(t);
        amp.gain.setTargetAtTime(0, t, 0.01);
        srcs.forEach((x) => { try { x.stop(t + 0.06); } catch { /* already stopped */ } });
      } catch { /* noop */ }
    },
    bend(semitones: number, at?: number) {
      const cents = Math.max(-200, Math.min(200, semitones * 100));
      const t = Math.max(0, at ?? (ctx as AudioContext).currentTime ?? 0);
      oscs.forEach((osc, i) => {
        try {
          osc.detune.cancelScheduledValues(t);
          osc.detune.setValueAtTime(osc.detune.value, t);
          osc.detune.linearRampToValueAtTime(baseDetune[i] + cents, t + 0.01);
        } catch { /* voice already stopped */ }
      });
    },
    modulate(amount01: number, at?: number) {
      const amt = Math.max(0, Math.min(1, amount01));
      const opened = Math.min(20000, baseF * (1 + amt * 6));
      const t = Math.max(0, at ?? (ctx as AudioContext).currentTime ?? 0);
      try {
        filter.frequency.cancelScheduledValues(t);
        filter.frequency.setTargetAtTime(opened, t, 0.03);
      } catch { /* voice already stopped */ }
    },
    level(amount01: number, at?: number) {
      const amt = Math.max(0, Math.min(1, amount01));
      const t = Math.max(0, at ?? (ctx as AudioContext).currentTime ?? 0);
      try {
        amp.gain.cancelScheduledValues(t);
        amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), t);
        amp.gain.linearRampToValueAtTime(Math.max(0.0001, peak * amt), t + 0.02);
      } catch { /* voice already stopped */ }
    },
  };
}

/** Synthesized drum kit: GM pitches (36 kick, 38 snare, 39 clap, 42/44 closed hat, 46 open hat, 45/50 toms, 49 crash). */
export function playDrum(ctx: BaseAudioContext, dest: AudioNode, kit: string, pitch: number, velocity: number, time: number): Voice {
  const vel = Math.max(0.05, Math.min(1, velocity / 127));
  const out = ctx.createGain();
  out.gain.value = vel;
  out.connect(dest);
  const srcs: AudioScheduledSourceNode[] = [];
  const acoustic = kit === 'drums:acoustic';

  const tone = (f0: number, f1: number, decay: number, level: number, type: OscillatorType = 'sine') => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, time);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), time + Math.min(0.5, decay * 0.6));
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    o.connect(g).connect(out);
    o.start(time);
    o.stop(time + decay + 0.05);
    srcs.push(o);
  };
  const noise = (type: BiquadFilterType, freq: number, decay: number, level: number, q = 0.8) => {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    n.connect(f).connect(g).connect(out);
    n.start(time, (pitch * 0.0137) % 0.9);
    n.stop(time + decay + 0.05);
    srcs.push(n);
  };

  switch (pitch) {
    case 35:
    case 36:
      if (acoustic) { tone(110, 50, 0.35, 0.9); noise('lowpass', 2500, 0.03, 0.3); }
      else { tone(150, 42, 0.6, 1.0); tone(1200, 200, 0.012, 0.25, 'triangle'); }
      break;
    case 38:
    case 40:
      tone(acoustic ? 190 : 220, 160, 0.12, 0.45, 'triangle');
      noise('highpass', acoustic ? 1500 : 1800, acoustic ? 0.22 : 0.18, 0.55);
      break;
    case 39:
      [0, 0.011, 0.023].forEach((dt, i) => {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 1.2;
        const g = ctx.createGain();
        const t = time + dt;
        const dec = i === 2 ? 0.16 : 0.012;
        g.gain.setValueAtTime(0.7, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        n.connect(f).connect(g).connect(out);
        n.start(t, 0.1 * i);
        n.stop(t + dec + 0.05);
        srcs.push(n);
      });
      break;
    case 42:
    case 44:
      noise('highpass', 7500, acoustic ? 0.06 : 0.045, 0.35, 0.5);
      break;
    case 46:
      noise('highpass', 7000, 0.32, 0.32, 0.5);
      break;
    case 41:
    case 43:
    case 45:
      tone(acoustic ? 120 : 140, 80, 0.35, 0.7);
      break;
    case 47:
    case 48:
    case 50:
      tone(acoustic ? 180 : 210, 120, 0.3, 0.65);
      break;
    case 49:
    case 57:
      noise('highpass', 5000, 1.4, 0.3, 0.4);
      break;
    case 51:
      noise('bandpass', 9000, 0.5, 0.2, 2);
      tone(5200, 5000, 0.4, 0.04, 'square');
      break;
    default:
      tone(midiToHz(pitch), midiToHz(pitch) * 0.9, 0.25, 0.5, 'triangle');
  }
  return {
    stop(at?: number) {
      const t = Math.max(at ?? 0, (ctx as AudioContext).currentTime ?? 0);
      srcs.forEach((s) => { try { s.stop(t + 0.02); } catch { /* noop */ } });
    },
  };
}

/** Metronome click straight to `dest` (not recorded into the mix). */
export function playClick(ctx: BaseAudioContext, dest: AudioNode, time: number, accent: boolean): void {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = accent ? 1760 : 1175;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  o.connect(g).connect(dest);
  o.start(time);
  o.stop(time + 0.07);
}

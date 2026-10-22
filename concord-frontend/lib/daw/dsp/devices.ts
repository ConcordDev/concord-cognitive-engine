/**
 * Audio devices (insert effects) for Concord Studio.
 *
 * Built only from native Web Audio nodes with deterministic parameters (seeded
 * reverb impulse), so the live graph and the OfflineAudioContext export graph
 * are constructed by the same code and sound the same. All processing is
 * 32-bit float (Web Audio's native format).
 */

import type { EffectInstance } from '../types';
import { mulberry32, hashString, dbToGain } from './rng';

export interface DeviceNode {
  input: AudioNode;
  output: AudioNode;
  dispose(): void;
}

const num = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Wet/dry wrapper for time-based effects. */
function wetDry(ctx: BaseAudioContext, wetPath: { input: AudioNode; output: AudioNode }, wet: number): DeviceNode {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wetG = ctx.createGain();
  const w = Math.max(0, Math.min(1, wet));
  dry.gain.value = 1 - w;
  wetG.gain.value = w;
  input.connect(dry).connect(output);
  input.connect(wetPath.input);
  wetPath.output.connect(wetG).connect(output);
  return { input, output, dispose: () => { try { input.disconnect(); output.disconnect(); } catch { /* noop */ } } };
}

function chain(nodes: AudioNode[]): DeviceNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return {
    input: nodes[0],
    output: nodes[nodes.length - 1],
    dispose: () => nodes.forEach((n) => { try { n.disconnect(); } catch { /* noop */ } }),
  };
}

const irCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

export function reverbImpulse(ctx: BaseAudioContext, decaySec: number, preDelay: number, seedKey: string): AudioBuffer {
  let m = irCache.get(ctx);
  if (!m) { m = new Map(); irCache.set(ctx, m); }
  const key = `${decaySec.toFixed(2)}|${preDelay.toFixed(3)}|${seedKey}`;
  const hit = m.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const pre = Math.floor(Math.max(0, preDelay) * sr);
  const len = Math.max(1, Math.floor(Math.max(0.1, Math.min(10, decaySec)) * sr) + pre);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(hashString(seedKey) + ch * 7919);
    const d = buf.getChannelData(ch);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      d[i] = (rnd() * 2 - 1) * Math.pow(1 - t, 2.5) * 0.5;
    }
  }
  m.set(key, buf);
  return buf;
}

export function createDevice(ctx: BaseAudioContext, effect: EffectInstance): DeviceNode | null {
  const p = effect.params || {};
  switch (effect.type) {
    case 'eq3':
    case 'eq8':
    case 'parametricEQ': {
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = num(p.lowFreq, 200);
      low.gain.value = num(p.lowGain, 0);
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = num(p.midFreq, 1000);
      mid.Q.value = num(p.midQ, 0.9);
      mid.gain.value = num(p.midGain, 0);
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = num(p.highFreq, 6000);
      high.gain.value = num(p.highGain, 0);
      const nodes: AudioNode[] = [];
      if (num(p.highPass, 0) > 0) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = num(p.highPass, 80);
        hp.Q.value = 0.707;
        nodes.push(hp);
      }
      nodes.push(low, mid, high);
      return chain(nodes);
    }
    case 'filter':
    case 'autoFilter': {
      const f = ctx.createBiquadFilter();
      const t = String(p.type || 'lowpass') as BiquadFilterType;
      f.type = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf', 'peaking', 'allpass'].includes(t) ? t : 'lowpass';
      f.frequency.value = num(p.frequency, 1000);
      f.Q.value = num(p.resonance, 0.707);
      return chain([f]);
    }
    case 'compressor': {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = num(p.threshold, -18);
      c.ratio.value = num(p.ratio, 3);
      c.attack.value = num(p.attack, 0.01);
      c.release.value = num(p.release, 0.2);
      c.knee.value = num(p.knee, 6);
      const makeup = ctx.createGain();
      makeup.gain.value = dbToGain(num(p.makeup, 0));
      return chain([c, makeup]);
    }
    case 'limiter': {
      // Live-safe brickwall approximation. Exports additionally run the
      // look-ahead true-peak limiter (dsp/limiter.ts) on the rendered mix.
      const pre = ctx.createGain();
      pre.gain.value = dbToGain(num(p.gain, 0));
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = num(p.ceiling, -1);
      c.ratio.value = 20;
      c.attack.value = 0.001;
      c.release.value = num(p.release, 0.1);
      c.knee.value = 0;
      return chain([pre, c]);
    }
    case 'reverb': {
      const conv = ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = reverbImpulse(ctx, num(p.decay, 2), num(p.preDelay, 0.01), effect.id || 'rv');
      return wetDry(ctx, { input: conv, output: conv }, num(effect.wet, 0.25));
    }
    case 'delay':
    case 'pingPongDelay': {
      const delay = ctx.createDelay(4);
      delay.delayTime.value = Math.min(4, Math.max(0.001, num(p.time, 0.375)));
      const fb = ctx.createGain();
      fb.gain.value = Math.min(0.92, Math.max(0, num(p.feedback, 0.3)));
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = num(p.tone, 6000);
      delay.connect(tone).connect(fb).connect(delay);
      return wetDry(ctx, { input: delay, output: tone }, num(effect.wet, 0.25));
    }
    case 'distortion':
    case 'overdrive': {
      const amount = Math.max(0, num(p.amount, 30));
      const shaper = ctx.createWaveShaper();
      const n = 4096;
      const curve = new Float32Array(n);
      const k = amount;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / (n - 1) - 1;
        curve[i] = ((1 + k / 10) * x) / (1 + (k / 10) * Math.abs(x));
      }
      shaper.curve = curve;
      shaper.oversample = '4x';
      return wetDry(ctx, { input: shaper, output: shaper }, num(effect.wet, 1));
    }
    case 'chorus':
    case 'flanger': {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = num(p.delay, 0.012);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = num(p.rate, 0.8);
      const depth = ctx.createGain();
      depth.gain.value = num(p.depth, 0.5) * 0.003;
      lfo.connect(depth).connect(d.delayTime);
      lfo.start(0);
      const dev = wetDry(ctx, { input: d, output: d }, num(effect.wet, 0.3));
      const disp = dev.dispose;
      dev.dispose = () => { try { lfo.stop(); lfo.disconnect(); } catch { /* noop */ } disp(); };
      return dev;
    }
    case 'stereoWidener': {
      // Mid/side width with mono-compatible lows: content below `monoBelow` Hz is summed to mono.
      const width = Math.max(0, Math.min(2, num(p.width, 1)));
      const monoBelow = num(p.monoBelow, 0);
      const input = ctx.createGain();
      const output = ctx.createGain();
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      input.connect(split);
      // M = (L+R)/2, S = (L-R)/2; L' = M + wS, R' = M - wS
      const mid = ctx.createGain(); mid.gain.value = 0.5;
      const sideL = ctx.createGain(); sideL.gain.value = 0.5;
      const sideR = ctx.createGain(); sideR.gain.value = -0.5;
      split.connect(mid, 0); split.connect(mid, 1);
      split.connect(sideL, 0); split.connect(sideR, 1);
      const side = ctx.createGain(); side.gain.value = width;
      sideL.connect(side); sideR.connect(side);
      let sideOut: AudioNode = side;
      if (monoBelow > 0) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = monoBelow;
        side.connect(hp);
        sideOut = hp;
      }
      const sideInv = ctx.createGain(); sideInv.gain.value = -1;
      sideOut.connect(sideInv);
      mid.connect(merge, 0, 0); mid.connect(merge, 0, 1);
      sideOut.connect(merge, 0, 0);
      sideInv.connect(merge, 0, 1);
      merge.connect(output);
      return { input, output, dispose: () => { try { input.disconnect(); merge.disconnect(); } catch { /* noop */ } } };
    }
    case 'multibandCompressor': {
      // 3-band (LR4 crossovers at lowX / highX), gentle compression per band.
      const lowX = num(p.lowCross, 200);
      const highX = num(p.highCross, 3000);
      const input = ctx.createGain();
      const output = ctx.createGain();
      const bq = (type: BiquadFilterType, f: number) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 0.7071; return b; };
      const comp = (prefix: string) => {
        const c = ctx.createDynamicsCompressor();
        c.threshold.value = num(p[`${prefix}Threshold`], num(p.threshold, -20));
        c.ratio.value = num(p[`${prefix}Ratio`], num(p.ratio, 2));
        c.attack.value = num(p.attack, 0.02);
        c.release.value = num(p.release, 0.25);
        c.knee.value = 6;
        return c;
      };
      const l1 = bq('lowpass', lowX), l2 = bq('lowpass', lowX);
      const h1 = bq('highpass', lowX), h2 = bq('highpass', lowX);
      const m1 = bq('lowpass', highX), m2 = bq('lowpass', highX);
      const t1 = bq('highpass', highX), t2 = bq('highpass', highX);
      const cl = comp('low'), cm = comp('mid'), ch = comp('high');
      const makeup = ctx.createGain(); makeup.gain.value = dbToGain(num(p.makeup, 0));
      input.connect(l1).connect(l2).connect(cl).connect(makeup);
      input.connect(h1).connect(h2);
      h2.connect(m1).connect(m2).connect(cm).connect(makeup);
      h2.connect(t1).connect(t2).connect(ch).connect(makeup);
      makeup.connect(output);
      return { input, output, dispose: () => { try { input.disconnect(); output.disconnect(); makeup.disconnect(); } catch { /* noop */ } } };
    }
    case 'gate': {
      // Not implemented as a true gate in Web Audio without a worklet; pass-through.
      const g = ctx.createGain();
      return chain([g]);
    }
    default:
      return null;
  }
}

/** A chain of devices with a stable input/output. Rebuild with `set(effects)`. */
export class DeviceChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private devices: DeviceNode[] = [];
  private key = '';
  constructor(private ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
  }

  set(effects: EffectInstance[] | undefined): void {
    const list = (effects || []).filter((e) => e && e.enabled !== false);
    const key = JSON.stringify(list.map((e) => [e.id, e.type, e.wet, e.params]));
    if (key === this.key) return;
    this.key = key;
    try { this.input.disconnect(); } catch { /* noop */ }
    this.devices.forEach((d) => d.dispose());
    this.devices = [];
    let last: AudioNode = this.input;
    for (const e of list) {
      const d = createDevice(this.ctx, e);
      if (!d) continue;
      last.connect(d.input);
      last = d.output;
      this.devices.push(d);
    }
    last.connect(this.output);
  }

  dispose(): void {
    try { this.input.disconnect(); this.output.disconnect(); } catch { /* noop */ }
    this.devices.forEach((d) => d.dispose());
    this.devices = [];
  }
}

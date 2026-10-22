/**
 * Mix devices that are not the legacy 3-band EQ: 8-band EQ, split-band
 * de-esser, and a native-node compressor with an external key input.
 * The unkeyed compressor stays the browser DynamicsCompressor so old
 * projects keep their sound.
 */

import { dbToGain } from './rng';
import { createEq8, readEqBands } from './eq-bands';

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Downward compressor gain. `levelDb` is the key level. Unity below the knee. */
export function compressorGain(levelDb: number, thresholdDb: number, ratio: number, kneeDb: number): number {
  const r = Math.max(1, ratio);
  const knee = Math.max(0, kneeDb);
  const over = levelDb - thresholdDb;
  let gr = 0;
  if (knee > 0 && over > -knee / 2 && over < knee / 2) {
    const x = over + knee / 2;
    gr = (x * x) / (2 * knee) * (1 - 1 / r);
  } else if (over >= knee / 2) {
    gr = over * (1 - 1 / r);
  }
  return dbToGain(-gr);
}

export function createKeyedCompressor(ctx: BaseAudioContext, p: Record<string, unknown>, externalKey: boolean): { input: AudioNode; output: AudioNode; keyInput?: AudioNode; reduction: () => number; dispose: () => void } {
  const threshold = num(p.threshold, -18);
  const ratio = num(p.ratio, 3);
  const knee = num(p.knee, 6);
  const release = Math.max(0.01, Math.min(2, num(p.release, 0.2)));
  const input = ctx.createGain();
  const output = ctx.createGain();
  const vca = ctx.createGain();
  vca.gain.value = 1;
  const makeup = ctx.createGain();
  const auto = num(p.autoMakeup, 0) !== 0;
  const staticMakeup = auto ? Math.max(0, -threshold * (1 - 1 / Math.max(1, ratio)) * 0.5) : num(p.makeup, 0);
  makeup.gain.value = dbToGain(staticMakeup);
  input.connect(vca).connect(makeup).connect(output);

  const key = ctx.createGain();
  const hpfHz = num(p.scHpf, 0);
  let detect: AudioNode = key;
  const extra: AudioNode[] = [];
  if (hpfHz > 20) {
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = Math.min(5000, hpfHz);
    hpf.Q.value = 0.707;
    key.connect(hpf);
    detect = hpf;
    extra.push(hpf);
  }
  const rect = ctx.createWaveShaper();
  const rc = new Float32Array(1025);
  for (let i = 0; i < rc.length; i++) rc[i] = Math.abs((i * 2) / (rc.length - 1) - 1);
  rect.curve = rc;
  const env = ctx.createBiquadFilter();
  env.type = 'lowpass';
  env.frequency.value = 1 / (2 * Math.PI * release);
  env.Q.value = 0;
  const envGain = ctx.createGain();
  envGain.gain.value = Math.PI / 2;
  const shaper = ctx.createWaveShaper();
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const amp = Math.max(1e-6, Math.abs(x));
    const db = Math.max(-120, 20 * Math.log10(amp));
    curve[i] = compressorGain(db, threshold, ratio, knee);
  }
  shaper.curve = curve;
  detect.connect(rect).connect(env).connect(envGain).connect(shaper).connect(vca.gain);
  if (!externalKey) input.connect(key);
  const probe = ctx.createAnalyser();
  probe.fftSize = 256;
  shaper.connect(probe);
  const buf = new Float32Array(probe.fftSize);
  const nodes = [input, output, vca, makeup, key, rect, env, envGain, shaper, probe, ...extra];
  return {
    input,
    output,
    keyInput: externalKey ? key : undefined,
    reduction: () => {
      probe.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
      const g = Math.abs(buf[0] || 1);
      return g > 0 && g < 1 ? 20 * Math.log10(g) : 0;
    },
    dispose: () => nodes.forEach((node) => { try { node.disconnect(); } catch { /* noop */ } }),
  };
}

/** Split-band de-esser. Listen mode outputs only the high band. */
export function createDeesser(ctx: BaseAudioContext, p: Record<string, unknown>): { input: AudioNode; output: AudioNode; reduction: () => number; dispose: () => void } {
  const freq = Math.max(2000, Math.min(12000, num(p.freq, 6000)));
  const listen = num(p.listen, 0) !== 0;
  const input = ctx.createGain();
  const output = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = freq;
  hp.Q.value = 0.707;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq;
  lp.Q.value = 0.707;
  const high = createKeyedCompressor(ctx, { threshold: num(p.threshold, -24), ratio: num(p.ratio, 4), knee: 6, release: 0.05, makeup: 0 }, false);
  input.connect(hp).connect(high.input);
  high.output.connect(output);
  if (!listen) input.connect(lp).connect(output);
  return {
    input,
    output,
    reduction: () => high.reduction(),
    dispose: () => {
      try { input.disconnect(); output.disconnect(); hp.disconnect(); lp.disconnect(); } catch { /* noop */ }
      high.dispose();
    },
  };
}

/** Gain, per-channel polarity, mono sum, and L/R swap. No added latency. */
export function createUtility(ctx: BaseAudioContext, p: Record<string, unknown>): { input: AudioNode; output: AudioNode; dispose: () => void } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const gain = ctx.createGain();
  gain.gain.value = dbToGain(Math.max(-60, Math.min(24, num(p.gain, 0))));
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const left = ctx.createGain();
  const right = ctx.createGain();
  left.gain.value = num(p.invertL, 0) !== 0 ? -1 : 1;
  right.gain.value = num(p.invertR, 0) !== 0 ? -1 : 1;
  input.connect(gain).connect(split);
  const extra: AudioNode[] = [];
  if (num(p.mono, 0) !== 0) {
    const sum = ctx.createGain();
    sum.gain.value = 0.5;
    left.connect(sum);
    right.connect(sum);
    sum.connect(merge, 0, 0);
    sum.connect(merge, 0, 1);
    extra.push(sum);
  } else {
    const swap = num(p.swap, 0) !== 0;
    left.connect(merge, 0, swap ? 1 : 0);
    right.connect(merge, 0, swap ? 0 : 1);
  }
  split.connect(left, 0);
  split.connect(right, 1);
  merge.connect(output);
  const nodes = [input, output, gain, split, merge, left, right, ...extra];
  return {
    input,
    output,
    dispose: () => nodes.forEach((node) => { try { node.disconnect(); } catch { /* noop */ } }),
  };
}

export function createEightBand(ctx: BaseAudioContext, params: Record<string, unknown>): { input: AudioNode; output: AudioNode; dispose: () => void } {
  return createEq8(ctx, readEqBands(params));
}

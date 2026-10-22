/**
 * Pitch Correct worklet host. scripts/build-worklets.mjs inlines
 * lib/daw/dsp/pitch/core.ts into public/worklets/pitch-tap.js.
 * The processor sums to mono, runs processPitchBlock, and posts a meter
 * at 30 Hz or slower.
 */
import { applyPitchSettings, createPitchState, processPitchBlock, type PitchSettings, type PitchState } from '../dsp/pitch/core';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

const g = globalThis as unknown as {
  currentTime: number;
  registerProcessor: (name: string, ctor: new () => AudioWorkletProcessor) => void;
};

class PitchCorrectProcessor extends AudioWorkletProcessor {
  private state: PitchState | null = null;
  private lastPost = -1;
  private id = '';

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; id?: string; settings?: PitchSettings } | null;
      if (!data || data.type !== 'settings' || !data.settings) return;
      if (data.id) this.id = data.id;
      if (!this.state) this.state = createPitchState(data.settings);
      else applyPitchSettings(this.state, data.settings);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!this.state || !input || !input[0] || !output || !output[0]) return true;
    const n = input[0].length;
    const mono = new Float32Array(n);
    let count = 0;
    for (let c = 0; c < input.length; c++) {
      const ch = input[c];
      if (!ch || ch.length < n) continue;
      count += 1;
      for (let i = 0; i < n; i++) mono[i] += ch[i];
    }
    if (count > 1) for (let i = 0; i < n; i++) mono[i] /= count;
    const block = new Float32Array(n);
    const meter = processPitchBlock(this.state, count ? mono : input[0], block);
    for (let c = 0; c < output.length; c++) {
      const out = output[c];
      if (!out) continue;
      const m = Math.min(n, out.length);
      for (let i = 0; i < m; i++) out[i] = block[i];
    }
    const now = g.currentTime;
    if (this.lastPost < 0 || now - this.lastPost >= 1 / 30) {
      this.lastPost = now;
      this.port.postMessage({ type: 'meter', id: this.id, meter });
    }
    return true;
  }
}

g.registerProcessor('concord-pitch-correct', PitchCorrectProcessor);

export {};

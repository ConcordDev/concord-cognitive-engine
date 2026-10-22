/**
 * AudioWorklet capture tap. No imports: scripts/build-worklets.mjs compiles
 * this file alone to public/worklets/capture-tap.js. Shared assembly lives
 * in lib/daw/dsp/capture-blocks.ts (main thread).
 *
 * The processor copies each render quantum and transfers the copies. It does
 * not resample, filter, or pitch-shift. 128 frames is the usual quantum;
 * the processor uses whatever length the browser passed.
 *
 * lib.dom in this TypeScript version declares AudioWorkletNode but not
 * AudioWorkletProcessor. The declare below is types-only; the name at
 * runtime is the worklet global.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

const g = globalThis as unknown as {
  currentTime: number;
  registerProcessor: (name: string, ctor: new () => AudioWorkletProcessor) => void;
};

class CaptureTapProcessor extends AudioWorkletProcessor {
  private armed = false;
  private gen = 0;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; on?: boolean; gen?: number } | null;
      if (!data || data.type !== 'arm') return;
      this.armed = !!data.on;
      if (typeof data.gen === 'number') this.gen = data.gen;
      if (!this.armed) this.port.postMessage({ type: 'disarmed', gen: this.gen });
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.armed) return true;
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) return true;
    const channels: Float32Array[] = [];
    const transfers: ArrayBuffer[] = [];
    for (let c = 0; c < input.length; c++) {
      const src = input[c];
      const copy = new Float32Array(src.length);
      copy.set(src);
      channels.push(copy);
      transfers.push(copy.buffer as ArrayBuffer);
    }
    this.port.postMessage({ type: 'block', gen: this.gen, time: g.currentTime, channels }, transfers);
    return true;
  }
}

g.registerProcessor('concord-capture-tap', CaptureTapProcessor);

export {};

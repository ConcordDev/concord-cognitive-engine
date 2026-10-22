/**
 * Pitch Editor analysis off the UI thread. The pure core lives in
 * dsp/pitch/editor.ts. This file only hosts it.
 */

import { analyzePitch } from './dsp/pitch/editor';

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data || {};
  if (msg.type !== 'analyze') return;
  try {
    const channel = msg.channel as Float32Array;
    const result = analyzePitch(channel, Number(msg.sampleRate) || 48000);
    self.postMessage({ type: 'analysis', id: msg.id, result });
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : 'Pitch analysis failed' });
  }
};

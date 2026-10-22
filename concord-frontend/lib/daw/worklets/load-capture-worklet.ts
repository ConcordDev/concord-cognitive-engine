/**
 * Load the same-origin capture worklet once per AudioContext.
 * Failure is not cached: the next open() can try again.
 */

import { CAPTURE_WORKLET_URL } from '../dsp/capture-blocks';

const loaded = new WeakSet<object>();

export async function ensureCaptureWorklet(ctx: BaseAudioContext, url: string = CAPTURE_WORKLET_URL): Promise<boolean> {
  const aw = (ctx as AudioContext).audioWorklet;
  if (!aw || typeof aw.addModule !== 'function') return false;
  if (loaded.has(ctx)) return true;
  try {
    await aw.addModule(url);
    loaded.add(ctx);
    return true;
  } catch {
    return false;
  }
}

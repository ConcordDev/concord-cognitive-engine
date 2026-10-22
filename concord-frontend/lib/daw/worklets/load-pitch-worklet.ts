/**
 * Load the pitch worklet once per context. A failed load is remembered so
 * the device card can say why the knobs are hidden. Capture stays on the
 * ScriptProcessor path; this device does not.
 */

export const PITCH_WORKLET_NAME = 'concord-pitch-correct';
export const PITCH_WORKLET_URL = '/worklets/pitch-tap.js';

const loaded = new WeakSet<object>();
let ready = false;
let failed = false;

export function pitchWorkletReady(): boolean {
  return ready;
}

export function pitchWorkletFailed(): boolean {
  return failed;
}

export async function ensurePitchWorklet(ctx: BaseAudioContext): Promise<boolean> {
  if (ready) return true;
  const aw = (ctx as AudioContext).audioWorklet;
  if (!aw || typeof aw.addModule !== 'function') {
    failed = true;
    return false;
  }
  if (loaded.has(ctx)) return ready;
  try {
    await aw.addModule(PITCH_WORKLET_URL);
    loaded.add(ctx);
    ready = true;
    failed = false;
    return true;
  } catch {
    failed = true;
    return false;
  }
}

/** Test hook. Not used by the app. */
export function resetPitchWorkletForTests(): void {
  ready = false;
  failed = false;
}

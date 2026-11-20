/**
 * The Stall's two sounds, synthesized with Web Audio (no asset files):
 * a till "cha-ching" on a completed sale and a brass bell when the daily
 * goal is hit. Off by default; the choice is a per-viewer preference.
 * Each sound is played only in response to a confirmed server result.
 */

const PREF_KEY = 'retail:stall:sound';

export function soundEnabled(): boolean {
  try { return window.localStorage.getItem(PREF_KEY) === 'on'; } catch { return false; }
}

export function setSoundEnabled(on: boolean): void {
  try { window.localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* preference only */ }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = ctx || new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(a: AudioContext, freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(a.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/** Drawer-slide click, then two bright bell partials. */
export function playChaChing(): void {
  if (!soundEnabled()) return;
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  tone(a, 180, t, 0.06, 0.12, 'square');
  tone(a, 2093, t + 0.07, 0.5, 0.09);
  tone(a, 2637, t + 0.07, 0.45, 0.06);
  tone(a, 3136, t + 0.16, 0.6, 0.07);
}

/** A struck brass bell: inharmonic partials with a long decay. */
export function playBell(): void {
  if (!soundEnabled()) return;
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  for (const [f, g, d] of [[880, 0.1, 1.6], [1760 * 1.19, 0.05, 1.1], [880 * 2.76, 0.035, 0.8], [880 * 5.4, 0.02, 0.5]] as const) {
    tone(a, f, t, d, g);
  }
}

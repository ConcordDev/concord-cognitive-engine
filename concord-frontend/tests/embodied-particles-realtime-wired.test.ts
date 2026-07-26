// DET-C batch 5 — 'concordia:embodied-signal' and 'concordia:exertion' had
// real, live listeners in EmbodiedParticlesBridge.tsx (cold-breath needs
// ambient temperature + sprint exertion to react to) but nothing anywhere
// ever dispatched either event — the listener-side documentation even
// claimed a producer existed ("the environment-sensor heartbeat publishes
// concordia:embodied-signal") when the heartbeat only ever wrote to the
// server-side embodied_signal_log DB table, never a window event.
//
// Fix: AvatarSystem3D now derives a real exertion level from the same
// sprint/stamina state it already computes every frame and dispatches it
// throttled; EmbodiedParticlesBridge now polls the same
// `embodied.signals_for_player` macro LinkScanOverlay already uses
// on-demand, and broadcasts the result as the window event its own
// listener consumes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('concordia:exertion — real sprint/stamina-derived producer', () => {
  const src = read('components/world-lens/AvatarSystem3D.tsx');

  it('dispatches concordia:exertion', () => {
    expect(src).toMatch(/dispatchEvent\(new CustomEvent\('concordia:exertion'/);
  });

  it('derives the level from real isRunning/stamina state, not a fabricated constant', () => {
    const idx = src.indexOf("dispatchEvent(new CustomEvent('concordia:exertion'");
    const region = src.slice(Math.max(0, idx - 400), idx);
    expect(region).toMatch(/isRunning/);
    expect(region).toMatch(/staminaRatio/);
  });

  it('throttles the dispatch instead of firing every frame', () => {
    expect(src).toMatch(/lastExertionDispatchRef/);
    const idx = src.indexOf('lastExertionDispatchRef.current');
    expect(idx).toBeGreaterThan(-1);
  });

  it('EmbodiedParticlesBridge listens for it', () => {
    const bridge = read('components/world/EmbodiedParticlesBridge.tsx');
    expect(bridge).toMatch(/addEventListener\('concordia:exertion'/);
  });
});

describe('concordia:embodied-signal — real poll-and-broadcast producer', () => {
  const src = read('components/world/EmbodiedParticlesBridge.tsx');

  it('polls the real embodied.signals_for_player macro (same one LinkScanOverlay uses)', () => {
    expect(src).toMatch(/domain:\s*'embodied',\s*name:\s*'signals_for_player'/);
  });

  it('broadcasts the result as the window event its own listener already consumes', () => {
    expect(src).toMatch(/dispatchEvent\(new CustomEvent\('concordia:embodied-signal'/);
    expect(src).toMatch(/addEventListener\('concordia:embodied-signal'/);
  });

  it('polls on an interval, not every frame, and cleans it up on unmount', () => {
    expect(src).toMatch(/setInterval\(pollEmbodiedSignal/);
    expect(src).toMatch(/clearInterval\(signalTimer\)/);
  });
});

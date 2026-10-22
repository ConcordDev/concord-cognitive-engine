/**
 * Equal-power fades. A fade-in uses sin(u·π/2), a fade-out uses cos(u·π/2),
 * so two overlapping regions of uncorrelated audio keep constant power.
 */

export function equalPowerGain(edge: 'in' | 'out', u: number): number {
  const x = Math.max(0, Math.min(1, u));
  return edge === 'in' ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2);
}

/** Gain at time `t` inside a span of `dur` seconds. */
export function envelopeGain(t: number, dur: number, fadeInSec: number, fadeOutSec: number, shape: 'linear' | 'equalPower'): number {
  if (dur <= 0) return 0;
  let g = 1;
  if (fadeInSec > 1e-6 && t < fadeInSec) {
    const u = t / fadeInSec;
    g *= shape === 'equalPower' ? equalPowerGain('in', u) : u;
  }
  if (fadeOutSec > 1e-6 && t > dur - fadeOutSec) {
    const u = (t - (dur - fadeOutSec)) / fadeOutSec;
    g *= shape === 'equalPower' ? equalPowerGain('out', u) : 1 - u;
  }
  return g;
}

/** Sample-accurate edge fades baked into a punch take. In place. */
export function applyEqualPowerEdgeFades(channels: Float32Array[], sampleRate: number, fadeSec: number): void {
  const n = channels[0]?.length || 0;
  if (n < 4) return;
  const f = Math.min(Math.floor(n / 2), Math.max(1, Math.round(fadeSec * sampleRate)));
  for (const ch of channels) {
    for (let i = 0; i < f; i++) {
      ch[i] *= equalPowerGain('in', i / f);
      ch[n - 1 - i] *= equalPowerGain('out', 1 - i / f);
    }
  }
}

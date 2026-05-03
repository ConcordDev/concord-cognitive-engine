/**
 * combo-vfx.ts — Mapping from combat-combo tier (1-5) to visual / audio
 * intensity values the GameJuice + ParticleEffects + SoundscapeEngine
 * layers consume. Higher-tier combos look + sound categorically richer:
 * more particles, stronger shake, longer hit-stop, brighter flash, an
 * extra camera-pull on tier-5.
 *
 * The combat substrate stores combat_combos.tier (1..5) and a per-combo
 * vfx_seed (12-char hash). The seed lets EvoAsset evolve unique visuals
 * for individual high-tier combos over time — once a combo accumulates
 * enough mastery_xp it becomes a candidate for a custom particle preset.
 *
 * For the runtime, callers just call `getComboVfx(tier)` and feed the
 * result into the polish-pass channels. Pure; no IO.
 */

export interface ComboVfx {
  particleCount:    number;          // additional ParticleEffects emit count
  shakeAmplitude:   number;          // emitScreenShake intensity (1-10)
  hitStopMs:        number;          // emitHitStop duration
  hitStopSeverity:  'light' | 'heavy' | 'crit' | 'kill';
  flashOpacity:     number;          // post-combo white flash 0-1
  cameraPullScale:  number;          // momentary zoom-in (1.0 = no zoom)
  trailColor:       string;          // CSS color for after-image trail
  audioLayers:      string[];        // SFX layer ids to play
  cinematic:        boolean;         // tier-5 only — letterbox + slow-mo
}

const TIER_PRESET: Record<number, ComboVfx> = {
  1: {
    particleCount: 12,
    shakeAmplitude: 3,
    hitStopMs: 80,
    hitStopSeverity: 'light',
    flashOpacity: 0.12,
    cameraPullScale: 1.000,
    trailColor: 'rgba(180,200,220,0.55)',
    audioLayers: ['hit-confirm-light'],
    cinematic: false,
  },
  2: {
    particleCount: 22,
    shakeAmplitude: 4,
    hitStopMs: 120,
    hitStopSeverity: 'heavy',
    flashOpacity: 0.20,
    cameraPullScale: 1.005,
    trailColor: 'rgba(120,200,255,0.70)',
    audioLayers: ['hit-confirm-heavy'],
    cinematic: false,
  },
  3: {
    particleCount: 38,
    shakeAmplitude: 5,
    hitStopMs: 160,
    hitStopSeverity: 'crit',
    flashOpacity: 0.30,
    cameraPullScale: 1.012,
    trailColor: 'rgba(80,220,255,0.85)',
    audioLayers: ['hit-confirm-crit', 'fanfare-short'],
    cinematic: false,
  },
  4: {
    particleCount: 60,
    shakeAmplitude: 7,
    hitStopMs: 220,
    hitStopSeverity: 'crit',
    flashOpacity: 0.45,
    cameraPullScale: 1.020,
    trailColor: 'rgba(255,220,80,0.90)',
    audioLayers: ['hit-confirm-crit', 'fanfare-short', 'rumble'],
    cinematic: false,
  },
  5: {
    particleCount: 96,
    shakeAmplitude: 9,
    hitStopMs: 320,
    hitStopSeverity: 'kill',
    flashOpacity: 0.62,
    cameraPullScale: 1.030,
    trailColor: 'rgba(255,180,40,1.0)',
    audioLayers: ['hit-confirm-kill', 'victory-sting', 'rumble'],
    cinematic: true,
  },
};

export function getComboVfx(tier: number): ComboVfx {
  const t = Math.max(1, Math.min(5, Math.floor(tier))) as 1 | 2 | 3 | 4 | 5;
  return TIER_PRESET[t];
}

/**
 * Apply the full polish-pass VFX chain for a combo trigger. Dispatches
 * particle / hit-stop / shake / flash / SFX events through the existing
 * channels so any layer that consumes them gets the upgraded fidelity.
 *
 * Optional vfxSeed: when supplied, fires concordia:evo-asset-interaction
 * so the EvoAsset pipeline can track which combos see the most use and
 * promote them for unique visual evolution.
 */
export function dispatchComboVfx(opts: {
  tier: number;
  centerX?: number;       // viewport %; defaults to center
  centerY?: number;
  vfxSeed?: string;
  comboName?: string;
}): void {
  if (typeof window === 'undefined') return;
  const vfx = getComboVfx(opts.tier);
  const x = opts.centerX ?? 50;
  const y = opts.centerY ?? 45;

  // Particles
  window.dispatchEvent(new CustomEvent('concordia:particle-effect', {
    detail: { type: 'burst', position: { x, y }, count: vfx.particleCount },
  }));
  // Hit-stop + shake
  window.dispatchEvent(new CustomEvent('concordia:emit-hit-stop', {
    detail: { durationMs: vfx.hitStopMs, severity: vfx.hitStopSeverity },
  }));
  window.dispatchEvent(new CustomEvent('concordia:emit-screen-shake', {
    detail: { intensity: vfx.shakeAmplitude },
  }));
  // Audio layers
  for (const sfxId of vfx.audioLayers) {
    window.dispatchEvent(new CustomEvent('concordia:soundscape-command', {
      detail: { action: 'triggerSFX', sfxId },
    }));
  }
  // Flash overlay (cinematic for tier 5)
  if (vfx.cinematic) {
    window.dispatchEvent(new CustomEvent('concordia:cinematic-flash', {
      detail: { opacity: vfx.flashOpacity, durationMs: 700, comboName: opts.comboName },
    }));
  }
  // EvoAsset interaction record so high-tier combos earn promotion candidates
  if (opts.vfxSeed) {
    try {
      void fetch('/api/evo-asset/interaction', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          source: 'combat_combo',
          sourceId: opts.vfxSeed,
          action: `combo_trigger_t${opts.tier}`,
          weight: opts.tier * 0.5,
        }),
      }).catch(() => { /* fire-and-forget */ });
    } catch { /* ignore */ }
  }
}

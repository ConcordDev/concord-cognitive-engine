import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// R7 — ConcordiaScene.tsx mounts its own static, theme-based sun+ambient
// rig, and SkyWeatherRenderer.tsx (mounted alongside it under the default
// viewMode==='explore' path — components/world/WorldOsSurface.tsx) mounts a SECOND,
// independent, real time-of-day-driven sun+ambient rig into the SAME
// scene. Both used to stay live for the whole session: at midday the two
// suns' intensities summed well past what either was individually tuned
// for, and — because ConcordiaScene's rig is static and never re-scaled by
// time of day — night never actually got dark, since a full-strength
// fixed-direction sun kept lighting the world regardless of what the sky/
// stars said. Fixed by tagging ConcordiaScene's lights and having
// SkyWeatherRenderer's onSceneReady handler remove them once its own
// (more complete) rig takes over.
//
// Both files are large Three.js/DOM-heavy components — this repo's
// established pattern for such files is a source-pinning regression test
// (see tests/world-lens-avatar-armor-wiring.test.ts's own header comment)
// rather than a full scene mount.

const concordiaSceneSrc = readFileSync(
  join(process.cwd(), 'components/world-lens/ConcordiaScene.tsx'),
  'utf8',
);
const skyWeatherSrc = readFileSync(
  join(process.cwd(), 'components/world-lens/SkyWeatherRenderer.tsx'),
  'utf8',
);

describe('ConcordiaScene — default sun/ambient are tagged for SkyWeatherRenderer to find', () => {
  it('tags the ambient light with isConcordiaDefaultAmbient before adding it to the scene', () => {
    const idx = concordiaSceneSrc.indexOf('ambient.userData.isConcordiaDefaultAmbient = true;');
    expect(idx).toBeGreaterThan(-1);
    const addIdx = concordiaSceneSrc.indexOf('scene.add(ambient);');
    expect(addIdx).toBeGreaterThan(idx);
  });

  it('tags the sun (directional light) with isConcordiaDefaultSun before adding it to the scene', () => {
    const idx = concordiaSceneSrc.indexOf('sun.userData.isConcordiaDefaultSun = true;');
    expect(idx).toBeGreaterThan(-1);
    const addIdx = concordiaSceneSrc.indexOf('scene.add(sun);');
    expect(addIdx).toBeGreaterThan(idx);
  });
});

describe('SkyWeatherRenderer — removes ConcordiaScene\'s static default lights once its own rig takes over', () => {
  it('onSceneReady traverses the scene for the tagged default lights BEFORE adding skyGroup', () => {
    const onSceneReadyIdx = skyWeatherSrc.indexOf('function onSceneReady(e: Event)');
    expect(onSceneReadyIdx).toBeGreaterThan(-1);

    const traverseIdx = skyWeatherSrc.indexOf('detail.scene.traverse?.((obj)', onSceneReadyIdx);
    const removeCallIdx = skyWeatherSrc.indexOf('for (const obj of toRemove) detail.scene.remove(obj);', onSceneReadyIdx);
    const addSkyGroupIdx = skyWeatherSrc.indexOf('detail.scene.add(skyGroup);', onSceneReadyIdx);

    expect(traverseIdx).toBeGreaterThan(onSceneReadyIdx);
    expect(removeCallIdx).toBeGreaterThan(traverseIdx);
    expect(addSkyGroupIdx).toBeGreaterThan(removeCallIdx);
  });

  it('matches on the SAME tag names ConcordiaScene sets (isConcordiaDefaultSun / isConcordiaDefaultAmbient)', () => {
    expect(skyWeatherSrc).toContain('ud?.isConcordiaDefaultSun || ud?.isConcordiaDefaultAmbient');
    // The tag names must be byte-identical across both files, or the
    // traverse silently matches nothing and the double-light bug is back.
    expect(concordiaSceneSrc).toContain('isConcordiaDefaultAmbient');
    expect(concordiaSceneSrc).toContain('isConcordiaDefaultSun');
  });

  it('the removal is best-effort (wrapped in try/catch) so a traverse failure never blocks sky/weather from mounting', () => {
    const onSceneReadyIdx = skyWeatherSrc.indexOf('function onSceneReady(e: Event)');
    const tryIdx = skyWeatherSrc.indexOf('try {', onSceneReadyIdx);
    const traverseIdx = skyWeatherSrc.indexOf('detail.scene.traverse?.((obj)', onSceneReadyIdx);
    const addSkyGroupIdx = skyWeatherSrc.indexOf('detail.scene.add(skyGroup);', onSceneReadyIdx);
    expect(tryIdx).toBeGreaterThan(onSceneReadyIdx);
    expect(traverseIdx).toBeGreaterThan(tryIdx);
    expect(traverseIdx).toBeLessThan(addSkyGroupIdx);
  });
});

// R7 — auto-quality-downgrade used to be one-way (never recovers) and
// silent (no player-visible notification), and the in-canvas quality
// selector never persisted its choice (a separate settings-page selector
// did, so the two disagreed and the in-canvas choice was lost on reload).
describe('ConcordiaScene — quality auto-downgrade now recovers and notifies (R7)', () => {
  it('tracks a separate high-fps counter for the symmetric upgrade path', () => {
    expect(concordiaSceneSrc).toContain('const highFpsCountRef = useRef(0);');
  });

  it('upgrade requires a much longer sustained window than downgrade (asymmetric hysteresis, avoids flapping)', () => {
    const downgradeIdx = concordiaSceneSrc.indexOf('lowFpsCountRef.current >= 3');
    const upgradeIdx = concordiaSceneSrc.indexOf('highFpsCountRef.current >= 180');
    expect(downgradeIdx).toBeGreaterThan(-1);
    expect(upgradeIdx).toBeGreaterThan(-1);
  });

  it('dispatches a concordia:toast on both downgrade and upgrade', () => {
    const idx = concordiaSceneSrc.indexOf("window.dispatchEvent(new CustomEvent('concordia:toast'");
    expect(idx).toBeGreaterThan(-1);
    expect(concordiaSceneSrc).toContain('Graphics quality lowered to');
    expect(concordiaSceneSrc).toContain('Graphics quality restored to');
  });

  it('never persists an automatic quality change to localStorage (only the manual selector does)', () => {
    const effectIdx = concordiaSceneSrc.indexOf("function onPerfBudget(ev: Event)");
    const nextEffectStart = concordiaSceneSrc.indexOf('useEffect(() => {', effectIdx + 100);
    const block = concordiaSceneSrc.slice(effectIdx, nextEffectStart > -1 ? nextEffectStart : effectIdx + 3000);
    expect(block).not.toContain('setStoredQualityPreset');
  });

  it('the in-canvas quality-selector click handler persists via setStoredQualityPreset (was a silent-loss bug)', () => {
    const idx = concordiaSceneSrc.indexOf('setQuality(q);');
    expect(idx).toBeGreaterThan(-1);
    const block = concordiaSceneSrc.slice(idx, idx + 1200);
    expect(block).toContain('setStoredQualityPreset(q);');
  });

  it("ConcordiaScene's quality prop has no '= \\'medium\\'' default (would collapse unset vs. explicit-medium)", () => {
    expect(concordiaSceneSrc).not.toContain("quality: initialQuality = 'medium',");
    expect(concordiaSceneSrc).toContain('quality: initialQuality,');
  });

  it('auto-detection only fires when the prop is genuinely undefined, not when it equals \'medium\'', () => {
    expect(concordiaSceneSrc).toContain('initialQuality === undefined ? detectInitialQuality() : initialQuality');
    expect(concordiaSceneSrc).not.toContain("initialQuality === 'medium' ? detectInitialQuality()");
  });
});

describe('world/page.tsx — quality prop distinguishes "no preference" from "explicit medium" (R7)', () => {
  const pageSrc = readFileSync(
    join(process.cwd(), 'components/world/WorldOsSurface.tsx'),
    'utf8',
  );

  it('passes undefined to ConcordiaScene when no preset was ever explicitly stored', () => {
    expect(pageSrc).toContain('quality={hasStoredQualityPreset() ? getStoredQualityPreset() : undefined}');
  });
});

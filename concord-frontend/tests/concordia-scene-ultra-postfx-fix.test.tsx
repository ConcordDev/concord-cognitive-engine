// World Lens plan Phase 3 ("Fix Ultra") — closes two compounding bugs found
// in the post-processing composer chain, both confirmed live before the fix
// by reading the actual vendored three.js source (node_modules/three/
// examples/jsm/postprocessing/{RenderPass,SSAARenderPass,TAARenderPass,
// TexturePass}.js), not assumed from behavior alone:
//
// Bug A (the plan's originally-scoped target): SSGIPass is a standalone
// manager (its own G-buffer + full duplicate scene re-render), not an
// EffectComposer Pass. The render loop used to branch
// `if (ssgiPassRef.current) { ssgiPassRef.current.render(null); }` — an
// exclusive-or against `composerRef.current`, meaning the entire composer
// chain (bloom/vignette/color-grade/motion-blur/chromatic-aberration/LUT/
// DoF/volumetric-fog) was skipped outright whenever SSGI was active
// (quality === 'ultra'). Fix: SSGI now renders into an offscreen target
// (`ssgiOutputTargetRef`) and the composer's pass 0 is spliced for a
// `TexturePass` bound to that target's texture, so the rest of the chain
// post-processes SSGI's GI-composited image instead of never running.
//
// Bug B (found incidentally while fixing Bug A, same bug class, same
// blocking effect on the plan's own "ultra never regresses vs high"
// success criterion — fixed in the same pass per this repo's stated
// incidental-bug policy): `TAARenderPass` was wired as the *last* composer
// pass (after RenderPass, bloom, vignette, color-grade, motion-blur,
// chromatic-aberration, LUT, and DoF) at high/ultra quality. Reading the
// vendored source confirms `TAARenderPass extends SSAARenderPass`, and
// `SSAARenderPass.render()` always performs its own fresh jittered
// `renderer.render(scene, camera)` calls into `writeBuffer` — it has no
// dependency on the incoming buffer's prior contents. Positioned late, this
// silently discarded every pass added before it for *every* high/ultra user,
// independent of whether SSGI was even active. Fix: TAA is now constructed
// first and used as pass 0 (replacing plain RenderPass) instead of being
// appended after the rest of the chain; RenderPass is only used as a
// fallback when TAA construction fails or isn't quality-eligible.
//
// ConcordiaScene.tsx pulls in Three.js scene construction, Rapier physics,
// and dozens of world-lens libraries that aren't mountable in a jsdom test
// environment — the codebase's own existing tests for this file use static
// source-text pins for exactly this reason (see
// tests/concordia-scene-resource-leak-fix.test.tsx). This file follows the
// same established pattern.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/ConcordiaScene.tsx'),
  'utf8'
);

describe('Phase 3 fix — TAA repositioned to pass 0', () => {
  it('constructs TAARenderPass immediately after the EffectComposer, before bloom/vignette', () => {
    const composerIdx = src.indexOf('const composer = new EffectComposer(renderer);');
    const taaImportIdx = src.indexOf("await import('three/examples/jsm/postprocessing/TAARenderPass.js')");
    const bloomIdx = src.indexOf('new UnrealBloomPass(');
    expect(composerIdx).toBeGreaterThan(-1);
    expect(taaImportIdx).toBeGreaterThan(-1);
    expect(bloomIdx).toBeGreaterThan(-1);
    expect(taaImportIdx).toBeGreaterThan(composerIdx);
    expect(taaImportIdx).toBeLessThan(bloomIdx);
  });

  it('falls back to plain RenderPass as pass 0 only when TAA was not added', () => {
    expect(src).toMatch(/let taaPassAdded = false;/);
    expect(src).toMatch(/taaPassAdded = true;/);
    expect(src).toMatch(/if \(!taaPassAdded\) \{\s*\n\s*composer\.addPass\(new RenderPass\(scene, camera\)\);\s*\n\s*\}/);
  });

  it('there is exactly one TAARenderPass construction site (the old late-position block was removed, not duplicated)', () => {
    const matches = src.match(/new TAARenderPass\(scene, camera\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('TAA is no longer appended after the DoF pass', () => {
    const dofIdx = src.indexOf('const dofPass = new ShaderPass(dofShader);');
    const addDofIdx = src.indexOf('composer.addPass(dofPass);');
    expect(dofIdx).toBeGreaterThan(-1);
    expect(addDofIdx).toBeGreaterThan(dofIdx);
    // Nothing between the DoF composer.addPass and the volumetric-fog
    // section header should construct or add a TAA pass.
    const volFogIdx = src.indexOf('Sprint 7: Volumetric fog (ultra only)');
    expect(volFogIdx).toBeGreaterThan(addDofIdx);
    const between = src.slice(addDofIdx, volFogIdx);
    expect(between).not.toMatch(/composer\.addPass\(taaPass\)/);
    expect(between).not.toMatch(/new TAARenderPass/);
  });
});

describe('Phase 3 fix — SSGI feeds the composer instead of replacing it', () => {
  it('declares an ssgiOutputTargetRef alongside ssgiPassRef', () => {
    expect(src).toMatch(/const ssgiOutputTargetRef = useRef<import\('three'\)\.WebGLRenderTarget \| null>\(null\);/);
  });

  it('ssgiPassRef.render accepts a real WebGLRenderTarget, not just null', () => {
    expect(src).toMatch(/render: \(t: import\('three'\)\.WebGLRenderTarget \| null\) => void;/);
  });

  it('splices the composer pass 0 for a TexturePass bound to the SSGI output target when SSGI constructs successfully', () => {
    const ssgiCtorIdx = src.indexOf('ssgiPassRef.current = new SSGIPass(');
    const texturePassImportIdx = src.indexOf("await import('three/examples/jsm/postprocessing/TexturePass.js')");
    const spliceIdx = src.indexOf('passes[0] = texPass;');
    expect(ssgiCtorIdx).toBeGreaterThan(-1);
    expect(texturePassImportIdx).toBeGreaterThan(ssgiCtorIdx);
    expect(spliceIdx).toBeGreaterThan(texturePassImportIdx);
    expect(src).toMatch(/if \(composerRef\.current\) \{[\s\S]{0,400}TexturePass[\s\S]{0,600}passes\[0\] = texPass;/);
  });

  it('the SSGI-only offscreen target is sized to the canvas and typed HalfFloat', () => {
    expect(src).toMatch(/new THREE\.WebGLRenderTarget\(canvas!\.clientWidth, canvas!\.clientHeight, \{\s*\n\s*type: THREE\.HalfFloatType,\s*\n\s*\}\);/);
  });

  it('the render loop drives SSGI into the offscreen target AND still runs the composer chain when both are live', () => {
    const region = src.match(
      /if \(ssgiPassRef\.current && composerRef\.current && ssgiOutputTargetRef\.current\) \{\s*\n\s*ssgiPassRef\.current\.render\(ssgiOutputTargetRef\.current\);\s*\n\s*composerRef\.current\.render\(delta\);\s*\n\s*\} else if \(ssgiPassRef\.current\) \{\s*\n\s*ssgiPassRef\.current\.render\(null\);\s*\n\s*\} else if \(composerRef\.current\) \{\s*\n\s*composerRef\.current\.render\(delta\);\s*\n\s*\} else \{\s*\n\s*renderer\.render\(scene, camera\);\s*\n\s*\}/
    );
    expect(region).toBeTruthy();
  });

  it('the old exclusive-or comment ("SSGI > EffectComposer > plain renderer") is gone — SSGI and the composer now compose, not exclude', () => {
    expect(src).not.toMatch(/\/\/ Render: SSGI > EffectComposer > plain renderer/);
  });

  it('the three-way check is the FIRST branch, not preceded by a bare ssgi-only branch (the old exclusive-or order)', () => {
    const renderCallSite = src.indexOf('if (ssgiPassRef.current && composerRef.current && ssgiOutputTargetRef.current)');
    const bareSsgiOnlyIdx = src.indexOf('} else if (ssgiPassRef.current) {\n          ssgiPassRef.current.render(null);');
    expect(renderCallSite).toBeGreaterThan(-1);
    expect(bareSsgiOnlyIdx).toBeGreaterThan(renderCallSite);
  });
});

describe('Phase 3 fix — SSGI output target lifecycle (resize + dispose)', () => {
  it('resize handler resizes the SSGI output target alongside the composer and SSGI pass', () => {
    expect(src).toMatch(/composerRef\.current\?\.setSize\(w, h\);\s*\n\s*ssgiPassRef\.current\?\.setSize\(w, h\);\s*\n\s*ssgiOutputTargetRef\.current\?\.setSize\(w, h\);/);
  });

  it('cleanup disposes and nulls the SSGI output target alongside ssgiPassRef', () => {
    expect(src).toMatch(/ssgiPassRef\.current\?\.dispose\(\);\s*\n\s*ssgiPassRef\.current = null;\s*\n\s*try \{ ssgiOutputTargetRef\.current\?\.dispose\(\); \} catch \{ \/\* idempotent \*\/ \}\s*\n\s*ssgiOutputTargetRef\.current = null;/);
  });
});

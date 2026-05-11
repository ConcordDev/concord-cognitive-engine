// concord-frontend/__tests__/sprint-7-visual-polish.test.ts
//
// Sprint 7 acceptance — TAA + volumetric fog + WebGPU opt-in pathway
// are present in ConcordiaScene.tsx and gated on the right preconditions.
//
// We can't run the full Three.js renderer in vitest (no WebGL context),
// so this test reads the source and pins the integration points: the
// imports exist, the quality gates fire, and the post-process chain
// orders the passes correctly.

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SCENE_PATH = path.resolve(__dirname, '..', 'components/world-lens/ConcordiaScene.tsx');
const SCENE_SRC = fs.readFileSync(SCENE_PATH, 'utf8');

describe('Sprint 7 — visual polish wire-up', () => {
  test('TAARenderPass is dynamically imported in the post-process chain', () => {
    expect(SCENE_SRC).toContain('TAARenderPass');
    expect(SCENE_SRC).toMatch(/import\([^)]*TAARenderPass[^)]*\)/);
  });

  test('TAA only activates at quality "high" or "ultra"', () => {
    // Find the TAA gate.
    const taaSection = SCENE_SRC.split('TAARenderPass')[0];
    const lastGate = taaSection.lastIndexOf("quality === 'high'");
    const lastUltraGate = taaSection.lastIndexOf("quality === 'ultra'");
    expect(lastGate).toBeGreaterThan(0);
    expect(lastUltraGate).toBeGreaterThan(0);
  });

  test('Volumetric fog shader is present and ultra-only', () => {
    expect(SCENE_SRC).toContain('volumetricFogShader');
    expect(SCENE_SRC).toContain('uniform float fogDensity');
    // Volumetric fog must be inside an ultra-gated block.
    const volFogIdx = SCENE_SRC.indexOf('volumetricFogShader');
    const ultraGate = SCENE_SRC.lastIndexOf("quality === 'ultra'", volFogIdx);
    expect(ultraGate).toBeGreaterThan(0);
    expect(volFogIdx - ultraGate).toBeLessThan(500); // gate within 500 chars
  });

  test('Volumetric fog time uniform is animated every frame', () => {
    expect(SCENE_SRC).toContain('_volFogAnimate');
    expect(SCENE_SRC).toContain('volFogPass.uniforms.time.value');
  });

  test('Volumetric fog color setter is wired to active theme', () => {
    expect(SCENE_SRC).toContain('_volFogSetColor');
    expect(SCENE_SRC).toContain('activeTheme.fog.color');
  });

  test('WebGPU activation is opt-in via localStorage', () => {
    expect(SCENE_SRC).toContain('concordia:renderer');
    expect(SCENE_SRC).toContain("=== 'webgpu'");
    expect(SCENE_SRC).toContain('WebGPURenderer');
  });

  test('WebGPU init failure falls back to WebGL2 (no crash)', () => {
    // Verify fallback pattern exists.
    expect(SCENE_SRC).toMatch(/falling back to WebGL2/i);
    expect(SCENE_SRC).toContain('useWebGPU = false');
  });

  test('Renderer sentinel exposes which backend is live', () => {
    expect(SCENE_SRC).toContain('__isWebGPU');
  });

  test('TAA sampleLevel scales with quality (ultra=3, high=2)', () => {
    expect(SCENE_SRC).toContain('sampleLevel');
    expect(SCENE_SRC).toMatch(/quality === 'ultra' \? 3 : 2/);
  });

  test('Post-process chain order: render → bloom → vignette → grade → dof → taa → volfog', () => {
    // Search for actual `new X(...)` instantiation patterns rather than
    // bare class names — the latter also match import-destructuring lines.
    const indices = {
      RenderPass: SCENE_SRC.indexOf('new RenderPass(scene, camera)'),
      Bloom:      SCENE_SRC.indexOf('new UnrealBloomPass('),
      Vignette:   SCENE_SRC.indexOf('new ShaderPass(vignetteShader)'),
      Grade:      SCENE_SRC.indexOf('new ShaderPass(colorGradeShader)'),
      DoF:        SCENE_SRC.indexOf('new ShaderPass(dofShader)'),
      TAA:        SCENE_SRC.indexOf('new TAARenderPass('),
      VolFog:     SCENE_SRC.indexOf('new ShaderPass(volumetricFogShader)'),
    };
    expect(indices.RenderPass).toBeGreaterThan(0);
    expect(indices.Bloom).toBeGreaterThan(indices.RenderPass);
    expect(indices.Vignette).toBeGreaterThan(indices.Bloom);
    expect(indices.Grade).toBeGreaterThan(indices.Vignette);
    expect(indices.DoF).toBeGreaterThan(indices.Grade);
    expect(indices.TAA).toBeGreaterThan(indices.DoF);
    expect(indices.VolFog).toBeGreaterThan(indices.TAA);
  });
});

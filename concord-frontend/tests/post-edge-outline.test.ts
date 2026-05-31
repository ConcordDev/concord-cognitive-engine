// Track 2 — edge-detection outline post-pass. Pins the pure builder ConcordiaScene
// wires into the EffectComposer: correct uniform defaults, a Sobel kernel + a
// strength-0 passthrough guard in the GLSL, and the clamped setters. No WebGL —
// a fake ShaderPass ctor + minimal THREE stand-ins capture the shader object.
//
// Run: npx vitest run tests/post-edge-outline.test.ts

import { describe, it, expect } from 'vitest';
import { createEdgeOutlinePass, _edgeOutlineShader } from '../lib/world-lens/post-edge-outline';

class FakeVec2 { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; }
  set(x: number, y: number) { this.x = x; this.y = y; } }
class FakeColor { hex: number; constructor(hex: number) { this.hex = hex; } }
const THREE = { Vector2: FakeVec2, Color: FakeColor };

// Captures the shader object the ShaderPass would have received.
class FakeShaderPass {
  uniforms: Record<string, { value: unknown }>;
  constructor(shader: { uniforms: Record<string, { value: unknown }> }) { this.uniforms = shader.uniforms; }
}

describe('createEdgeOutlinePass', () => {
  it('builds with the expected uniforms + resolution from opts', () => {
    const p = createEdgeOutlinePass(THREE as never, FakeShaderPass as never, { width: 800, height: 600 });
    const u = p.shaderPass.uniforms;
    expect(u.tDiffuse.value).toBeNull();
    expect(u.strength.value).toBeCloseTo(0.8);
    expect(u.threshold.value).toBeCloseTo(0.18);
    expect((u.resolution.value as FakeVec2).x).toBe(800);
    expect((u.resolution.value as FakeVec2).y).toBe(600);
    expect((u.edgeColor.value as FakeColor).hex).toBe(0x0a0a0a);
  });

  it('clamps setStrength / setThreshold into [0,1]', () => {
    const p = createEdgeOutlinePass(THREE as never, FakeShaderPass as never);
    p.setStrength(5); expect(p.shaderPass.uniforms.strength.value).toBe(1);
    p.setStrength(-2); expect(p.shaderPass.uniforms.strength.value).toBe(0);
    p.setThreshold(9); expect(p.shaderPass.uniforms.threshold.value).toBe(1);
  });

  it('setResolution updates the Vector2 in place', () => {
    const p = createEdgeOutlinePass(THREE as never, FakeShaderPass as never, { width: 100, height: 100 });
    p.setResolution(1920, 1080);
    const r = p.shaderPass.uniforms.resolution.value as FakeVec2;
    expect(r.x).toBe(1920); expect(r.y).toBe(1080);
  });

  it('the GLSL is a real Sobel with a strength-0 passthrough guard', () => {
    const fs = _edgeOutlineShader.fragmentShader;
    // Sobel kernel weights present.
    expect(fs).toContain('2.0 * r');
    expect(fs).toContain('sqrt(gx * gx + gy * gy)');
    // Passthrough at strength 0 (no regression when disabled).
    expect(fs).toMatch(/strength\s*<\s*0\.001/);
    expect(fs).toContain('smoothstep(threshold');
  });
});

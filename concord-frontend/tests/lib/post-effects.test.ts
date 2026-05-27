import { describe, it, expect } from 'vitest';
import { createMotionBlurPass, _motionBlurShader } from '@/lib/world-lens/post-motion-blur';
import {
  createChromaticAberrationPass,
  _chromaticShader,
} from '@/lib/world-lens/post-chromatic-aberration';
import { createAutoExposure } from '@/lib/world-lens/post-auto-exposure';
import { parseCubeLut, createLUTPass, _lutShader } from '@/lib/world-lens/lut-loader';

// Stand-in for THREE.ShaderPass — just wraps the shader, exposes uniforms.
class FakeShaderPass {
  uniforms: Record<string, { value: unknown }>;
  constructor(shader: { uniforms: Record<string, { value: unknown }> }) {
    this.uniforms = shader.uniforms;
  }
}

describe('motion blur pass', () => {
  it('shader has required uniforms', () => {
    expect(_motionBlurShader.uniforms.strength).toBeDefined();
    expect(_motionBlurShader.uniforms.samples).toBeDefined();
  });

  it('builds with default strength', () => {
    const p = createMotionBlurPass(FakeShaderPass as unknown as new (s: unknown) => unknown);
    expect(p.shaderPass.uniforms.strength.value).toBeCloseTo(0.45, 2);
    expect(p.shaderPass.uniforms.samples.value).toBe(6);
  });

  it('setStrength clamps to [0, 1]', () => {
    const p = createMotionBlurPass(FakeShaderPass as unknown as new (s: unknown) => unknown);
    p.setStrength(-1);
    expect(p.shaderPass.uniforms.strength.value).toBe(0);
    p.setStrength(5);
    expect(p.shaderPass.uniforms.strength.value).toBe(1);
  });
});

describe('chromatic aberration pass', () => {
  it('shader has falloff in radial direction', () => {
    expect(_chromaticShader.fragmentShader).toContain('falloff');
  });

  it('starts at low ambient intensity', () => {
    const p = createChromaticAberrationPass(FakeShaderPass as unknown as new (s: unknown) => unknown);
    p.tick(0);
    expect(p.shaderPass.uniforms.intensity.value as number).toBeLessThan(0.005);
  });

  it('pulse increases intensity transiently', () => {
    const p = createChromaticAberrationPass(FakeShaderPass as unknown as new (s: unknown) => unknown);
    const t0 = performance.now();
    p.pulse(0.025, 200);
    p.tick(t0 + 20);
    expect(p.shaderPass.uniforms.intensity.value as number).toBeGreaterThan(0.005);
    p.tick(t0 + 500);
    expect(p.shaderPass.uniforms.intensity.value as number).toBeLessThan(0.005);
  });

  it('window event fires pulses', () => {
    const p = createChromaticAberrationPass(FakeShaderPass as unknown as new (s: unknown) => unknown);
    const detach = p.attachWindowEvents();
    const t0 = performance.now();
    window.dispatchEvent(new CustomEvent('concordia:chromatic-pulse', {
      detail: { magnitude: 0.02, durationMs: 200 },
    }));
    // Advance time into the rising-edge attack window (0-20% of duration)
    p.tick(t0 + 25);
    expect(p.shaderPass.uniforms.intensity.value as number).toBeGreaterThan(0.005);
    detach();
  });

  it('clamps pulse magnitude', () => {
    const p = createChromaticAberrationPass(FakeShaderPass as unknown as new (s: unknown) => unknown);
    p.pulse(10);
    p.tick(performance.now());
    expect(p.shaderPass.uniforms.intensity.value as number).toBeLessThanOrEqual(0.04);
  });
});

describe('auto exposure', () => {
  it('starts at default exposure of 1.0', () => {
    const ae = createAutoExposure();
    expect(ae.getCurrentExposure()).toBe(1.0);
    expect(ae.getTargetExposure()).toBe(1.0);
  });

  it('setExposure clamps to bounds', () => {
    const ae = createAutoExposure({ minExposure: 0.5, maxExposure: 1.5 });
    ae.setExposure(10);
    expect(ae.getCurrentExposure()).toBeLessThanOrEqual(1.5);
    ae.setExposure(-1);
    expect(ae.getCurrentExposure()).toBeGreaterThanOrEqual(0.5);
  });

  it('tick is a no-op when no renderer canvas', () => {
    const ae = createAutoExposure();
    // Tick with a fake renderer that has no context — should not crash.
    const fakeRenderer = {
      getContext: () => null,
      domElement: { width: 100, height: 100 },
      toneMappingExposure: 1.0,
    };
    expect(() =>
      ae.tick(fakeRenderer as unknown as Parameters<typeof ae.tick>[0], 100, 100),
    ).not.toThrow();
  });
});

describe('LUT loader', () => {
  it('parses a minimal 2x2x2 LUT', () => {
    const text = `
      TITLE "Test LUT"
      LUT_3D_SIZE 2
      0 0 0
      1 0 0
      0 1 0
      1 1 0
      0 0 1
      1 0 1
      0 1 1
      1 1 1
    `;
    const lut = parseCubeLut(text);
    expect(lut.size).toBe(2);
    expect(lut.title).toBe('Test LUT');
    expect(lut.data.length).toBe(2 * 2 * 2 * 3);
  });

  it('throws on missing LUT_3D_SIZE', () => {
    expect(() => parseCubeLut('0 0 0\n1 1 1\n')).toThrow();
  });

  it('throws on 1D LUT', () => {
    expect(() => parseCubeLut('LUT_1D_SIZE 4\n0 0 0\n')).toThrow();
  });

  it('skips comment lines', () => {
    const text = `
      # this is a comment
      LUT_3D_SIZE 2
      # so is this
      0 0 0
      1 0 0
      0 1 0
      1 1 0
      0 0 1
      1 0 1
      0 1 1
      1 1 1
    `;
    const lut = parseCubeLut(text);
    expect(lut.size).toBe(2);
  });

  it('createLUTPass starts disabled', () => {
    const fakeThree = {
      Data3DTexture: class {
        constructor(_data: unknown, _w: number, _h: number, _d: number) {}
        format = 0; type = 0;
        minFilter = 0; magFilter = 0;
        wrapS = 0; wrapT = 0; wrapR = 0;
        needsUpdate = false;
      },
      RGBAFormat: 1, UnsignedByteType: 1,
      LinearFilter: 1, ClampToEdgeWrapping: 1,
    };
    const p = createLUTPass(
      fakeThree as unknown as typeof import('three'),
      FakeShaderPass as unknown as new (s: unknown) => unknown,
    );
    expect(p.shaderPass.uniforms.enabled.value).toBe(0.0);
  });

  it('LUT shader has the right uniforms', () => {
    expect(_lutShader.uniforms.lut3D).toBeDefined();
    expect(_lutShader.uniforms.lutSize).toBeDefined();
    expect(_lutShader.uniforms.strength).toBeDefined();
    expect(_lutShader.uniforms.enabled).toBeDefined();
  });
});

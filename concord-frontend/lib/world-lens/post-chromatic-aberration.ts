/**
 * Chromatic aberration post-pass.
 *
 * RGB-channel offset along a radial outward direction from screen
 * center. Magnitude bound to a `concordia:chromatic-pulse` window event
 * so the existing ImpactFeedback layer can pulse it on hits without
 * threading a uniform through props.
 *
 * Ambient magnitude is a soft baseline (lens optics realism); pulses
 * stack on top with a fast attack + slow decay envelope.
 */

export interface ChromaticAberrationPass {
  shaderPass: { uniforms: Record<string, { value: unknown }> };
  pulse(magnitude: number, durationMs?: number): void;
  setAmbient(magnitude: number): void;
  tick(nowMs: number): void;
  attachWindowEvents(): () => void;
}

const chromaticShader = {
  uniforms: {
    tDiffuse:  { value: null },
    intensity: { value: 0.002 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float intensity;
    varying vec2 vUv;
    void main() {
      vec2 center = vec2(0.5, 0.5);
      vec2 dir = vUv - center;
      float d = length(dir);
      // Falloff toward center so the aberration only shows in periphery.
      float falloff = smoothstep(0.0, 0.6, d) * d;
      vec2 offset = dir * intensity * falloff;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

interface PendingPulse {
  startMs:  number;
  durationMs: number;
  magnitude: number;
}

export function createChromaticAberrationPass(
  ShaderPassCtor: new (shader: unknown) => unknown,
): ChromaticAberrationPass {
  const builtShader = {
    uniforms: {
      tDiffuse:  { value: null },
      intensity: { value: 0.002 },
    },
    vertexShader:   chromaticShader.vertexShader,
    fragmentShader: chromaticShader.fragmentShader,
  };
  const pass = new ShaderPassCtor(builtShader) as { uniforms: Record<string, { value: unknown }> };

  let ambient = 0.002;
  const pulses: PendingPulse[] = [];

  return {
    shaderPass: pass,

    pulse(magnitude, durationMs = 280) {
      pulses.push({
        startMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        durationMs,
        magnitude: Math.max(0, Math.min(0.04, magnitude)),
      });
    },

    setAmbient(magnitude) {
      ambient = Math.max(0, Math.min(0.02, magnitude));
    },

    tick(nowMs) {
      let accum = ambient;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        const t = nowMs - p.startMs;
        if (t >= p.durationMs) {
          pulses.splice(i, 1);
          continue;
        }
        // Fast attack (first 20% of duration), then ease-out decay
        const phase = t / p.durationMs;
        const env = phase < 0.2
          ? phase / 0.2
          : (1 - phase) / 0.8;
        accum += p.magnitude * Math.max(0, Math.min(1, env));
      }
      pass.uniforms.intensity.value = Math.max(0, Math.min(0.04, accum));
    },

    attachWindowEvents() {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as
          | { magnitude?: number; durationMs?: number }
          | undefined;
        if (!detail) return;
        const mag = typeof detail.magnitude === 'number' ? detail.magnitude : 0.015;
        const dur = typeof detail.durationMs === 'number' ? detail.durationMs : 280;
        this.pulse(mag, dur);
      };
      window.addEventListener('concordia:chromatic-pulse', handler as EventListener);
      return () => {
        try { window.removeEventListener('concordia:chromatic-pulse', handler as EventListener); }
        catch { /* idempotent */ }
      };
    },
  };
}

export const _chromaticShader = chromaticShader;

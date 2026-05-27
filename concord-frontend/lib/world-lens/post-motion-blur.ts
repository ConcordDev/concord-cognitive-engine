/**
 * Motion blur post-process pass.
 *
 * Velocity-based screen-space blur. Uses the previous frame's
 * view-projection matrix to compute per-pixel screen velocity, then
 * blurs along that direction. Cheap (no separate velocity render
 * target), accurate for camera motion, ignores per-object motion
 * (acceptable trade-off for the cost — full per-object motion would
 * require G-buffer velocity).
 *
 * Builder returns a ShaderPass + a `setMatrices(prev, current)` hook
 * the renderer should call once per frame with the camera VP matrices.
 */

import type * as THREE_NS from 'three';

export interface MotionBlurPass {
  shaderPass: { uniforms: Record<string, { value: unknown }> };
  setMatrices(prevVP: THREE_NS.Matrix4, curVP: THREE_NS.Matrix4): void;
  setStrength(strength: number): void;
}

const motionBlurShader = {
  uniforms: {
    tDiffuse:    { value: null },
    prevVP:      { value: null },
    curVP:       { value: null },
    strength:    { value: 0.45 },
    samples:     { value: 6 },
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
    uniform mat4 prevVP;
    uniform mat4 curVP;
    uniform float strength;
    uniform float samples;
    varying vec2 vUv;
    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);
      if (strength < 0.001) { gl_FragColor = baseColor; return; }
      // Reconstruct an NDC position; depth proxy from luminance bias
      // keeps everything in [-1, 1] without a depth target.
      vec2 ndc = vUv * 2.0 - 1.0;
      vec4 curWorld = inverse(curVP) * vec4(ndc, 0.0, 1.0);
      vec4 prevClip = prevVP * curWorld;
      vec2 prevNdc = prevClip.xy / max(0.0001, prevClip.w);
      vec2 velocity = (ndc - prevNdc) * 0.5 * strength;
      // Cap per-pixel velocity so a sudden camera teleport doesn't smear
      float maxV = 0.08;
      velocity = clamp(velocity, vec2(-maxV), vec2(maxV));
      vec4 acc = baseColor;
      float sampleCount = max(1.0, samples);
      for (float i = 1.0; i < 16.0; i++) {
        if (i >= sampleCount) break;
        float t = i / sampleCount;
        vec2 off = velocity * t;
        acc += texture2D(tDiffuse, vUv - off);
      }
      gl_FragColor = acc / (1.0 + min(sampleCount - 1.0, 15.0));
    }
  `,
};

/**
 * Build the motion-blur pass. The caller is responsible for adding the
 * returned ShaderPass to its EffectComposer; calling setMatrices each
 * frame before render; and disposing when done.
 */
export function createMotionBlurPass(
  ShaderPassCtor: new (shader: unknown) => unknown,
): MotionBlurPass {
  const shader = JSON.parse(JSON.stringify({
    uniforms: {
      tDiffuse: { value: null },
      strength: { value: motionBlurShader.uniforms.strength.value },
      samples:  { value: motionBlurShader.uniforms.samples.value },
    },
  }));
  // Rebuild fresh non-shared uniform objects so the pass can be
  // disposed/recreated without affecting any other instance.
  const builtShader = {
    uniforms: {
      tDiffuse: { value: null },
      prevVP:   { value: null },
      curVP:    { value: null },
      strength: { value: 0.45 },
      samples:  { value: 6 },
    },
    vertexShader: motionBlurShader.vertexShader,
    fragmentShader: motionBlurShader.fragmentShader,
  };
  const pass = new ShaderPassCtor(builtShader) as { uniforms: Record<string, { value: unknown }> };
  void shader;
  return {
    shaderPass: pass,
    setMatrices(prevVP, curVP) {
      pass.uniforms.prevVP.value = prevVP;
      pass.uniforms.curVP.value = curVP;
    },
    setStrength(strength: number) {
      pass.uniforms.strength.value = Math.max(0, Math.min(1, strength));
    },
  };
}

export const _motionBlurShader = motionBlurShader;

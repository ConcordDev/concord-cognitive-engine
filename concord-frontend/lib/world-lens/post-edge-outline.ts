/**
 * Edge-detection outline post-process pass (Track 2 — rendering).
 *
 * A luminance Sobel ink-edge pass that darkens silhouette + interior edges in
 * screen space, the "BotW / Hi-Fi Rush" toon line the inverted-hull outline
 * can't draw on interior creases. Self-contained: a color→color pass that reads
 * only `tDiffuse` + resolution (no depth/normal target needed), so it can never
 * destabilise the composer — at strength 0 it returns the input byte-identical.
 *
 * Cheaper-than-normal/depth Sobel is intentional: the inverted-hull outline
 * already handles silhouettes; this adds the interior linework for the toon
 * read. Reuses the exact builder shape as post-motion-blur / post-chromatic-
 * aberration so ConcordiaScene wires it the same way.
 *
 * Builder returns a ShaderPass + setStrength / setThreshold / setResolution.
 */

export interface EdgeOutlinePass {
  shaderPass: { uniforms: Record<string, { value: unknown }> };
  setStrength(strength: number): void;
  setThreshold(threshold: number): void;
  setResolution(width: number, height: number): void;
}

const edgeOutlineShader = {
  uniforms: {
    tDiffuse:   { value: null },
    resolution: { value: null },   // THREE.Vector2 (px)
    strength:   { value: 0.8 },     // 0 = off (passthrough), 1 = full ink
    threshold:  { value: 0.18 },    // gradient magnitude below this draws no line
    edgeColor:  { value: null },    // THREE.Color (defaults to near-black)
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
    uniform vec2 resolution;
    uniform float strength;
    uniform float threshold;
    uniform vec3 edgeColor;
    varying vec2 vUv;

    float lum(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (strength < 0.001) { gl_FragColor = base; return; }
      vec2 px = 1.0 / max(resolution, vec2(1.0));
      // 3x3 Sobel on luminance.
      float tl = lum(vUv + px * vec2(-1.0,  1.0));
      float  t = lum(vUv + px * vec2( 0.0,  1.0));
      float tr = lum(vUv + px * vec2( 1.0,  1.0));
      float  l = lum(vUv + px * vec2(-1.0,  0.0));
      float  r = lum(vUv + px * vec2( 1.0,  0.0));
      float bl = lum(vUv + px * vec2(-1.0, -1.0));
      float  b = lum(vUv + px * vec2( 0.0, -1.0));
      float br = lum(vUv + px * vec2( 1.0, -1.0));
      float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
      float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
      float mag = sqrt(gx * gx + gy * gy);
      // Smooth ramp above the threshold so lines anti-alias instead of popping.
      float edge = smoothstep(threshold, threshold + 0.25, mag) * strength;
      gl_FragColor = vec4(mix(base.rgb, edgeColor, edge), base.a);
    }
  `,
};

/**
 * Build the edge-outline pass. The caller adds the returned ShaderPass to its
 * EffectComposer, sets the resolution (and updates it on resize), and tunes
 * strength. `THREE` is passed so the builder can construct the Vector2/Color
 * uniform defaults without importing three at module scope.
 */
export function createEdgeOutlinePass(
  THREE: { Vector2: new (x: number, y: number) => unknown; Color: new (hex: number) => unknown },
  ShaderPassCtor: new (shader: unknown) => unknown,
  opts: { width?: number; height?: number; edgeColorHex?: number } = {},
): EdgeOutlinePass {
  const builtShader = {
    uniforms: {
      tDiffuse:   { value: null },
      resolution: { value: new THREE.Vector2(opts.width ?? 1280, opts.height ?? 720) },
      strength:   { value: 0.8 },
      threshold:  { value: 0.18 },
      edgeColor:  { value: new THREE.Color(opts.edgeColorHex ?? 0x0a0a0a) },
    },
    vertexShader: edgeOutlineShader.vertexShader,
    fragmentShader: edgeOutlineShader.fragmentShader,
  };
  const pass = new ShaderPassCtor(builtShader) as { uniforms: Record<string, { value: unknown }> };
  return {
    shaderPass: pass,
    setStrength(strength: number) {
      pass.uniforms.strength.value = Math.max(0, Math.min(1, strength));
    },
    setThreshold(threshold: number) {
      pass.uniforms.threshold.value = Math.max(0, Math.min(1, threshold));
    },
    setResolution(width: number, height: number) {
      (pass.uniforms.resolution.value as { set?: (x: number, y: number) => void } | null)?.set?.(
        Math.max(1, width), Math.max(1, height),
      );
    },
  };
}

export const _edgeOutlineShader = edgeOutlineShader;

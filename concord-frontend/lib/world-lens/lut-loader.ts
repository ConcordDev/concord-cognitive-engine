/**
 * LUT (.cube) loader + 3D-LUT ShaderPass.
 *
 * Parses Adobe .cube LUT files (industry standard for cinematic color
 * grading) into a 3D texture, then renders a ShaderPass that samples
 * the LUT to remap the rendered frame's colours. A LUT lets you
 * achieve "Blade Runner orange-teal" or "Mad Max bleach-bypass" with a
 * single asset swap — no shader recompilation needed.
 *
 * Supports per-biome / per-time-of-day LUT switching by calling
 * `setLut(parsedLut)` after `parseCubeLut(text)`.
 */

import type * as THREE_NS from 'three';

export interface ParsedCubeLut {
  size: number;
  /** Flat RGB values, length = size³ × 3. */
  data: Float32Array;
  title?: string;
}

export interface LUTPass {
  shaderPass: { uniforms: Record<string, { value: unknown }> };
  setLut(lut: ParsedCubeLut): void;
  setStrength(strength: number): void;
  /** Disable the LUT pass entirely (identity passthrough). */
  setEnabled(enabled: boolean): void;
}

/** Parse Adobe .cube LUT text into a typed structure. */
export function parseCubeLut(text: string): ParsedCubeLut {
  const lines = text.split(/\r?\n/);
  let size = 0;
  let title: string | undefined;
  const data: number[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.toUpperCase().startsWith('TITLE')) {
      const m = line.match(/"([^"]*)"/);
      if (m) title = m[1];
      continue;
    }
    if (line.toUpperCase().startsWith('LUT_3D_SIZE')) {
      const parts = line.split(/\s+/);
      const n = parseInt(parts[1] ?? '0', 10);
      if (!isNaN(n) && n > 0) size = n;
      continue;
    }
    if (line.toUpperCase().startsWith('DOMAIN_MIN') || line.toUpperCase().startsWith('DOMAIN_MAX')) {
      continue; // accept default 0..1 domain
    }
    if (line.toUpperCase().startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUTs are not supported; use a 3D LUT (.cube with LUT_3D_SIZE).');
    }
    const nums = line.split(/\s+/).map(parseFloat).filter((n) => !isNaN(n));
    if (nums.length >= 3) {
      data.push(nums[0], nums[1], nums[2]);
    }
  }
  if (size === 0) throw new Error('LUT_3D_SIZE missing in .cube file');
  const expectedLen = size * size * size * 3;
  if (data.length !== expectedLen) {
    throw new Error(
      `LUT data length mismatch: got ${data.length}, expected ${expectedLen} for size ${size}`,
    );
  }
  return { size, data: new Float32Array(data), title };
}

/** Convert a parsed LUT into a Data3DTexture. */
export function lutToTexture(
  THREE: typeof THREE_NS,
  lut: ParsedCubeLut,
): THREE_NS.Data3DTexture {
  const size = lut.size;
  // Three.js expects 4-channel data for Data3DTexture (RGBA). Pad alpha=255.
  const rgba = new Uint8Array(size * size * size * 4);
  for (let i = 0; i < size * size * size; i++) {
    rgba[i * 4]     = Math.max(0, Math.min(255, Math.round(lut.data[i * 3]     * 255)));
    rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(lut.data[i * 3 + 1] * 255)));
    rgba[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(lut.data[i * 3 + 2] * 255)));
    rgba[i * 4 + 3] = 255;
  }
  const texture = new THREE.Data3DTexture(rgba, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

const lutShader = {
  uniforms: {
    tDiffuse: { value: null },
    lut3D:    { value: null },
    lutSize:  { value: 32 },
    strength: { value: 1.0 },
    enabled:  { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp sampler3D;
    uniform sampler2D tDiffuse;
    uniform sampler3D lut3D;
    uniform float lutSize;
    uniform float strength;
    uniform float enabled;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (enabled < 0.5) { gl_FragColor = c; return; }
      // Map linear [0,1] colour into LUT texture coords with a half-texel
      // inset to avoid sampling outside the LUT edges.
      vec3 inset = vec3(0.5) / lutSize;
      vec3 scaled = mix(inset, 1.0 - inset, c.rgb);
      vec3 graded = texture(lut3D, scaled).rgb;
      gl_FragColor = vec4(mix(c.rgb, graded, strength), c.a);
    }
  `,
};

export function createLUTPass(
  THREE: typeof THREE_NS,
  ShaderPassCtor: new (shader: unknown) => unknown,
): LUTPass {
  const builtShader = {
    uniforms: {
      tDiffuse: { value: null },
      lut3D:    { value: null },
      lutSize:  { value: 32 },
      strength: { value: 1.0 },
      enabled:  { value: 0.0 },
    },
    vertexShader: lutShader.vertexShader,
    fragmentShader: lutShader.fragmentShader,
  };
  const pass = new ShaderPassCtor(builtShader) as { uniforms: Record<string, { value: unknown }> };

  return {
    shaderPass: pass,

    setLut(lut) {
      const tex = lutToTexture(THREE, lut);
      pass.uniforms.lut3D.value = tex;
      pass.uniforms.lutSize.value = lut.size;
      pass.uniforms.enabled.value = 1.0;
    },

    setStrength(strength) {
      pass.uniforms.strength.value = Math.max(0, Math.min(1, strength));
    },

    setEnabled(enabled) {
      pass.uniforms.enabled.value = enabled ? 1.0 : 0.0;
    },
  };
}

export const _lutShader = lutShader;

/**
 * Underwater rendering pass — Sprint D / X1+X2+X3
 *
 * Real WebGL2 shader replacing the Sprint C DOM-overlay hack.
 *
 * Inputs:
 *   - tDiffuse (the rendered scene)
 *   - tDepth   (camera depth buffer for raymarched fog + caustics)
 *   - uCameraDepth (player Y vs water Y)
 *   - uTime
 *   - uTint    (biome-tinted underwater color)
 *   - uSunDir  (sun direction vector for god-rays + caustics)
 *   - uOxygenPct (drives low-oxygen vignette)
 *
 * Effects:
 *   - Depth-based blue-green tint
 *   - Exponential distance fog (visibility shrinks with depth)
 *   - Cheap screen-space god-rays from sun direction
 *   - Animated caustic patterns on submerged surfaces
 *   - Particulate matter (drifting Worley specks)
 *   - Low-oxygen heartbeat vignette
 */

import * as THREE from 'three';

export const UNDERWATER_FRAG = /* glsl */`
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform float uTime;
  uniform float uCameraDepth;       // metres below water surface (>0 underwater)
  uniform vec3  uTint;              // biome tint (e.g. tropical clear vs swamp green)
  uniform vec2  uSunDirScreen;      // sun direction in screen-space (UV) for cheap god-rays
  uniform float uOxygenPct;         // 0..100
  uniform float uFogDensity;        // 1/metres
  uniform vec2  uResolution;

  varying vec2 vUv;

  // Cheap value noise.
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec4 col = texture2D(tDiffuse, vUv);

    // Linearise depth.
    float depth = texture2D(tDepth, vUv).r;
    float linearDepth = 1.0 / (1.0 - depth);  // approximate; renderer sets near/far in app

    // Fog factor by linear depth.
    float fogT = 1.0 - exp(-uFogDensity * linearDepth);
    fogT = clamp(fogT, 0.0, 0.95);

    // Tint shifts with player depth: clearer near surface, deeper at depth.
    float depthT = clamp(uCameraDepth / 12.0, 0.0, 1.0);
    vec3 fogColor = mix(uTint * 0.85, uTint * 0.45, depthT);

    // Caustic pattern projected from "above" — sin/cos noise cells.
    float caust = vnoise(vUv * 18.0 + uTime * 0.4);
    caust += vnoise(vUv * 32.0 - uTime * 0.7) * 0.5;
    caust = smoothstep(0.55, 1.0, caust) * (1.0 - depthT * 0.5);
    vec3 caustCol = vec3(0.9, 1.05, 1.10) * caust * 0.18;

    // Particulate matter — drifting specks.
    vec2 partUv = vUv * vec2(60.0, 60.0);
    partUv.y += uTime * 0.6;
    float spec = vnoise(partUv + 13.7);
    spec = smoothstep(0.85, 0.95, spec) * 0.3;
    vec3 specCol = vec3(0.7, 0.9, 0.9) * spec;

    // Cheap screen-space god rays — radial accumulation toward sun.
    float godRay = 0.0;
    vec2 toSun = uSunDirScreen - vUv;
    float toSunLen = length(toSun);
    if (toSunLen > 0.0001) {
      vec2 dir = toSun / toSunLen;
      const int STEPS = 8;
      float step = toSunLen / float(STEPS);
      for (int i = 0; i < STEPS; i++) {
        vec2 sample = vUv + dir * step * float(i);
        float d = texture2D(tDepth, sample).r;
        godRay += smoothstep(0.95, 1.0, d) * 0.04;
      }
    }
    vec3 godRayCol = vec3(1.0, 1.05, 0.85) * godRay * (1.0 - depthT);

    // Compose.
    col.rgb = mix(col.rgb, fogColor, fogT);
    col.rgb += caustCol + specCol + godRayCol;

    // Low-oxygen vignette (red, pulsing).
    if (uOxygenPct < 30.0) {
      float ratio = (30.0 - uOxygenPct) / 30.0;
      float pulse = 0.6 + 0.4 * sin(uTime * 4.0);
      vec2 cv = vUv - vec2(0.5);
      float v = smoothstep(0.2, 0.55, length(cv));
      col.rgb = mix(col.rgb, vec3(0.5, 0.1, 0.1), v * ratio * pulse);
    }

    gl_FragColor = col;
  }
`;

export const UNDERWATER_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export interface UnderwaterUniforms {
  tDiffuse:        { value: THREE.Texture | null };
  tDepth:          { value: THREE.Texture | null };
  uTime:           { value: number };
  uCameraDepth:    { value: number };
  uTint:           { value: THREE.Color };
  uSunDirScreen:   { value: THREE.Vector2 };
  uOxygenPct:      { value: number };
  uFogDensity:     { value: number };
  uResolution:     { value: THREE.Vector2 };
}

export function createUnderwaterUniforms(): UnderwaterUniforms {
  return {
    tDiffuse:      { value: null },
    tDepth:        { value: null },
    uTime:         { value: 0 },
    uCameraDepth:  { value: 0 },
    uTint:         { value: new THREE.Color(0x1a3a5c) },
    uSunDirScreen: { value: new THREE.Vector2(0.5, 0.85) },
    uOxygenPct:    { value: 100 },
    uFogDensity:   { value: 0.12 },
    uResolution:   { value: new THREE.Vector2(1920, 1080) },
  };
}

export const BIOME_TINT: Record<string, number> = {
  tropical:  0x1a8090,
  temperate: 0x1a3a5c,
  swamp:     0x2a4a30,
  boreal:    0x18283a,
  coastal:   0x224050,
};

export function createUnderwaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: UNDERWATER_VERT,
    fragmentShader: UNDERWATER_FRAG,
    uniforms: createUnderwaterUniforms() as unknown as Record<string, THREE.IUniform>,
    depthTest: false,
    depthWrite: false,
  });
}

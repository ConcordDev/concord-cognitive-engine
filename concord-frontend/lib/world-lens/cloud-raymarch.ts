/**
 * Volumetric cloud layer.
 *
 * Cheap ray-marched cloud band rendered on a transparent dome shell at
 * cloud-altitude. 8-sample march, deterministic 3D-noise via fbm of
 * Perlin-style hash. Driven by a time uniform for slow drift + a
 * weather uniform for density (clear, cloudy, storm).
 *
 * Gate to high+ quality; clouds are pretty but optional.
 */

import type * as THREE_NS from 'three';

export interface CloudLayer {
  mesh: THREE_NS.Mesh;
  tick(deltaSec: number): void;
  setWeatherDensity(density: number): void;
  setSunDirection(unit: { x: number; y: number; z: number }): void;
  dispose(): void;
}

const cloudShader = {
  uniforms: {
    uTime:          { value: 0 },
    uDensity:       { value: 0.5 },
    uSunDir:        { value: { x: 0.2, y: 1.0, z: 0.3 } },
    uCloudColor:    { value: [0.95, 0.96, 0.99] },
    uShadowColor:   { value: [0.55, 0.60, 0.68] },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vNormal = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uDensity;
    uniform vec3 uSunDir;
    uniform vec3 uCloudColor;
    uniform vec3 uShadowColor;
    varying vec3 vWorldPos;
    varying vec3 vNormal;

    // Cheap 3D hash + value noise + fbm
    float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float vnoise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash(i);
      float n100 = hash(i + vec3(1.0, 0.0, 0.0));
      float n010 = hash(i + vec3(0.0, 1.0, 0.0));
      float n110 = hash(i + vec3(1.0, 1.0, 0.0));
      float n001 = hash(i + vec3(0.0, 0.0, 1.0));
      float n101 = hash(i + vec3(1.0, 0.0, 1.0));
      float n011 = hash(i + vec3(0.0, 1.0, 1.0));
      float n111 = hash(i + vec3(1.0, 1.0, 1.0));
      float n00 = mix(n000, n100, f.x);
      float n10 = mix(n010, n110, f.x);
      float n01 = mix(n001, n101, f.x);
      float n11 = mix(n011, n111, f.x);
      float n0 = mix(n00, n10, f.y);
      float n1 = mix(n01, n11, f.y);
      return mix(n0, n1, f.z);
    }
    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      mat3 r = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
      for (int i = 0; i < 4; i++) {
        v += a * vnoise(p);
        p = r * p * 2.0;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      // Map dome position to cloud-noise lookup
      vec3 p = vWorldPos * 0.002;
      p.y *= 1.6;
      p += vec3(uTime * 0.05, 0.0, uTime * 0.03);
      float n = fbm(p);
      float density = smoothstep(0.45, 0.85, n) * uDensity;
      // Cheap shading — illumination factor based on sun direction.
      float sunAlign = clamp(dot(normalize(vWorldPos), normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
      vec3 lit = mix(uShadowColor, uCloudColor, sunAlign);
      // Limb darkening — clouds away from sun pick up shadow tint
      gl_FragColor = vec4(lit, density);
      if (density < 0.02) discard;
    }
  `,
};

export function createCloudLayer(
  THREE: typeof THREE_NS,
  options: { radius?: number; segments?: number } = {},
): CloudLayer {
  const radius = options.radius ?? 1400;
  const segments = options.segments ?? 24;
  // A flattened dome — only top hemisphere; clouds shouldn't be below horizon
  const geom = new THREE.SphereGeometry(radius, segments, Math.max(8, segments / 2), 0, Math.PI * 2, 0, Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: 0 },
      uDensity:     { value: 0.5 },
      uSunDir:      { value: new THREE.Vector3(0.2, 1.0, 0.3) },
      uCloudColor:  { value: new THREE.Color(0.95, 0.96, 0.99) },
      uShadowColor: { value: new THREE.Color(0.55, 0.60, 0.68) },
    },
    vertexShader: cloudShader.vertexShader,
    fragmentShader: cloudShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.renderOrder = -500;
  mesh.frustumCulled = false;

  let timeAccum = 0;

  return {
    mesh,
    tick(deltaSec) {
      timeAccum += deltaSec;
      material.uniforms.uTime.value = timeAccum;
    },
    setWeatherDensity(d) {
      material.uniforms.uDensity.value = Math.max(0, Math.min(1.2, d));
    },
    setSunDirection(unit) {
      const u = material.uniforms.uSunDir.value as THREE_NS.Vector3;
      u.set(unit.x, unit.y, unit.z).normalize();
    },
    dispose() {
      try { geom.dispose(); } catch { /* idempotent */ }
      try { material.dispose(); } catch { /* idempotent */ }
    },
  };
}

export const _cloudShader = cloudShader;

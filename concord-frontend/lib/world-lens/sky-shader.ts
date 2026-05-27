/**
 * Procedural sky-dome shader.
 *
 * Simplified Rayleigh + Mie atmospheric scattering: blends a horizon
 * tint with a zenith tint, modulated by the sun-elevation angle so the
 * sky goes orange-pink at dusk, cyan-blue at noon, deep-blue at night.
 * Mie scattering adds the bright halo near the sun.
 *
 * Not full atmospheric ray-marching — that's expensive and overkill
 * for a gameplay scene. This is the "sky reads correct" minimum that
 * costs ~0.2ms on a single inverted sphere mesh.
 */

import type * as THREE_NS from 'three';

export interface SkyDome {
  mesh:    THREE_NS.Mesh;
  setSun(directionUnit: { x: number; y: number; z: number }): void;
  setTimeOfDayHour(hour: number): void;
  setColors(zenith: number, horizon: number, sun: number): void;
  dispose(): void;
}

const skyShader = {
  uniforms: {
    uSunDir:        { value: { x: 0.2, y: 1.0, z: 0.3 } },
    uZenithColor:   { value: [0.10, 0.32, 0.62] },
    uHorizonColor:  { value: [0.78, 0.86, 0.95] },
    uSunColor:      { value: [1.00, 0.92, 0.78] },
    uSunIntensity:  { value: 1.5 },
    uTimePhase:     { value: 0.55 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vViewDir;
    void main() {
      vViewDir = normalize((vec4(position, 0.0) * viewMatrix).xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position.z = gl_Position.w;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uSunDir;
    uniform vec3 uZenithColor;
    uniform vec3 uHorizonColor;
    uniform vec3 uSunColor;
    uniform float uSunIntensity;
    uniform float uTimePhase;
    varying vec3 vViewDir;
    void main() {
      vec3 dir = normalize(vViewDir);
      float yElev = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
      // Soft zenith→horizon gradient
      vec3 base = mix(uHorizonColor, uZenithColor, smoothstep(0.45, 0.95, yElev));
      // Night dimming
      float dayFactor = clamp(uSunDir.y, 0.0, 1.0);
      vec3 night = vec3(0.02, 0.04, 0.08);
      base = mix(night, base, dayFactor);
      // Mie halo around sun
      float cosTheta = clamp(dot(dir, normalize(uSunDir)), -1.0, 1.0);
      float mie = pow(max(0.0, cosTheta), 32.0);
      vec3 sunGlow = uSunColor * mie * uSunIntensity * dayFactor;
      // Dawn/dusk warming — push horizon orange when sun low
      float lowSun = 1.0 - smoothstep(0.0, 0.25, uSunDir.y);
      vec3 dawn = vec3(0.95, 0.55, 0.32);
      base = mix(base, mix(base, dawn, 0.7), lowSun * (1.0 - smoothstep(0.4, 1.0, abs(dir.y))));
      vec3 col = base + sunGlow;
      // Slight stars at night
      float starFactor = (1.0 - dayFactor) * smoothstep(0.3, 1.0, yElev);
      float starN = fract(sin(dot(dir.xz, vec2(127.1, 311.7))) * 43758.5453);
      float star = step(0.998, starN) * starFactor;
      col += vec3(star);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createSkyDome(
  THREE: typeof THREE_NS,
  options: { radius?: number; segments?: number } = {},
): SkyDome {
  const radius = options.radius ?? 2000;
  const segments = options.segments ?? 32;
  const geom = new THREE.SphereGeometry(radius, segments, segments);
  // Render the dome from the inside
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir:       { value: new THREE.Vector3(0.2, 1.0, 0.3) },
      uZenithColor:  { value: new THREE.Vector3(0.10, 0.32, 0.62) },
      uHorizonColor: { value: new THREE.Vector3(0.78, 0.86, 0.95) },
      uSunColor:     { value: new THREE.Vector3(1.00, 0.92, 0.78) },
      uSunIntensity: { value: 1.5 },
      uTimePhase:    { value: 0.55 },
    },
    vertexShader:   skyShader.vertexShader,
    fragmentShader: skyShader.fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;

  return {
    mesh,
    setSun(d) {
      const u = material.uniforms.uSunDir.value as THREE_NS.Vector3;
      u.set(d.x, d.y, d.z).normalize();
    },
    setTimeOfDayHour(hour) {
      // Approx sun arc: noon = up; midnight = down.
      const phase = ((hour - 6) / 12) * Math.PI; // sunrise=0, sunset=π
      const y = Math.sin(phase);
      const x = Math.cos(phase) * 0.4;
      const z = 0.3;
      const u = material.uniforms.uSunDir.value as THREE_NS.Vector3;
      u.set(x, y, z).normalize();
      material.uniforms.uTimePhase.value = phase / Math.PI;
    },
    setColors(zenithHex, horizonHex, sunHex) {
      const zc = new THREE.Color(zenithHex);
      const hc = new THREE.Color(horizonHex);
      const sc = new THREE.Color(sunHex);
      (material.uniforms.uZenithColor.value as THREE_NS.Vector3).set(zc.r, zc.g, zc.b);
      (material.uniforms.uHorizonColor.value as THREE_NS.Vector3).set(hc.r, hc.g, hc.b);
      (material.uniforms.uSunColor.value as THREE_NS.Vector3).set(sc.r, sc.g, sc.b);
    },
    dispose() {
      try { geom.dispose(); } catch { /* idempotent */ }
      try { material.dispose(); } catch { /* idempotent */ }
    },
  };
}

export const _skyShader = skyShader;

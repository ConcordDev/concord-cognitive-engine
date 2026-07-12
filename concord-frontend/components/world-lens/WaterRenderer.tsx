'use client';

import React, { useEffect, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export interface RiverConfig {
  /** Width of the river in meters */
  width: number;
  /** Flow direction angle in radians */
  flowDirection: number;
  /** Flow speed multiplier */
  flowSpeed: number;
  /** River center X position (western edge) */
  centerX: number;
  /** River length along Z axis */
  length: number;
}

export interface CreekPathPoint {
  x: number;
  z: number;
}

interface WaterRendererProps {
  riverConfig: RiverConfig;
  creekPath: CreekPathPoint[];
  /** 0-24 hour cycle */
  timeOfDay: number;
  quality: 'low' | 'medium' | 'high' | 'ultra';
}

// ── Shader Sources ───────────────────────────────────────────────

const WATER_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uWaveAmplitude;
  uniform float uWaveFrequency;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vDepth;

  // Simplex-like noise for wave displacement (2 octaves)
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vUv = uv;

    vec3 pos = position;

    // Two octaves of simplex-style noise for surface displacement
    float wave1 = noise(pos.xz * uWaveFrequency + uTime * 0.3) * uWaveAmplitude;
    float wave2 = noise(pos.xz * uWaveFrequency * 2.0 + uTime * 0.5) * uWaveAmplitude * 0.5;
    pos.y += wave1 + wave2;

    vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;

    // Depth: how far from edge (for opacity/color gradient)
    vDepth = uv.x; // 0 at bank, 1 at center

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const WATER_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uFoamColor;
  uniform float uOpacityDeep;
  uniform float uOpacityShallow;
  uniform float uFoamThreshold;
  uniform float uReflectionStrength;
  uniform sampler2D uNormalMap;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vDepth;

  void main() {
    // Animated normal map for ripple distortion
    vec2 uvOffset1 = vUv * 4.0 + vec2(uTime * 0.02, uTime * 0.015);
    vec2 uvOffset2 = vUv * 6.0 - vec2(uTime * 0.01, uTime * 0.025);

    // Color gradient: deep blue center to greenish-brown at banks
    float depthFactor = smoothstep(0.0, 0.5, vDepth);
    vec3 waterColor = mix(uShallowColor, uDeepColor, depthFactor);

    // Foam near shoreline
    float foamFactor = 1.0 - smoothstep(0.0, uFoamThreshold, vDepth);
    waterColor = mix(waterColor, uFoamColor, foamFactor * 0.6);

    // Fresnel-like reflection approximation
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
    waterColor += vec3(0.3, 0.35, 0.4) * fresnel * uReflectionStrength;

    // Opacity: transparent at edges, opaque at depth
    float opacity = mix(uOpacityShallow, uOpacityDeep, depthFactor);
    opacity = max(opacity, foamFactor * 0.9);

    // Subtle sparkle
    float sparkle = pow(max(0.0, sin(vWorldPosition.x * 10.0 + uTime * 2.0) *
                                  sin(vWorldPosition.z * 10.0 + uTime * 1.5)), 16.0);
    waterColor += vec3(1.0) * sparkle * 0.15;

    gl_FragColor = vec4(waterColor, opacity);
  }
`;

// ── Fog Layer Shader ────────────────────────────────────────────

const FOG_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FOG_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uDensity;
  uniform vec3 uFogColor;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float n = noise(vUv * 3.0 + uTime * 0.05);
    float alpha = n * uDensity * 0.4;
    // Fade at edges
    float edgeFade = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
    edgeFade *= smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
    alpha *= edgeFade;
    gl_FragColor = vec4(uFogColor, alpha);
  }
`;

// ── Component ────────────────────────────────────────────────────

// The normal-map's ripple pattern is procedural and time-invariant — only
// the bucket-selected colors (deep/shallow/fog) depend on time of day, and
// they're selected from four discrete bands, not a continuous function of
// `timeOfDay`. Deriving a coarse bucket lets the effect's dependency array
// skip rebuilding the whole water mesh (geometry, foam, creek ribbon, and
// the normal-map texture) for every fractional `timeOfDay` tick — it only
// needs to rebuild at the four band transitions per day/night cycle.
export function timeOfDayBucket(timeOfDay: number): 'dawn' | 'dusk' | 'night' | 'day' {
  if (timeOfDay >= 5 && timeOfDay < 8) return 'dawn';
  if (timeOfDay >= 17 && timeOfDay < 20) return 'dusk';
  if (timeOfDay < 5 || timeOfDay >= 20) return 'night';
  return 'day';
}

export default function WaterRenderer({
  riverConfig,
  creekPath,
  timeOfDay,
  quality,
}: WaterRendererProps) {
  const waterGroupRef = useRef<unknown>(null);
  const uniformsRef = useRef<Record<string, { value: unknown }>>({});
  // Tracks the normal-map DataTexture from the most recent buildWater() call
  // so the cleanup below can dispose it (see the disposal note near its
  // creation for why the standard geometry/material traverse never reaches it).
  const normalMapTexRef = useRef<{ dispose: () => void } | null>(null);

  const timeBucket = timeOfDayBucket(timeOfDay);

  useEffect(() => {
    let disposed = false;

    async function buildWater() {
      const THREE = await import('three');
      if (disposed) return;

      const waterGroup = new THREE.Group();
      waterGroup.name = 'water_system';

      // ── Quality settings ──────────────────────────────────────
      const segmentMap = { low: 32, medium: 64, high: 128, ultra: 256 };
      const segments = segmentMap[quality];
      const enableReflections = quality !== 'low';

      // ── Time-of-day color adjustments ──────────────────────────
      const isDawn = timeBucket === 'dawn';
      const isDusk = timeBucket === 'dusk';
      const isNight = timeBucket === 'night';

      let deepColor = new THREE.Color(0x1a3a5c);
      let shallowColor = new THREE.Color(0x4a6b3a);
      let fogColor = new THREE.Color(0xccccdd);
      let fogDensity = 0;

      if (isDawn) {
        deepColor = new THREE.Color(0x2a4a6c);
        shallowColor = new THREE.Color(0x6a7b5a);
        fogColor = new THREE.Color(0xeeddbb);
        fogDensity = 0.6;
      } else if (isDusk) {
        deepColor = new THREE.Color(0x3a2a4c);
        shallowColor = new THREE.Color(0x7a5b4a);
        fogColor = new THREE.Color(0xdd9977);
        fogDensity = 0.5;
      } else if (isNight) {
        deepColor = new THREE.Color(0x0a1a2c);
        shallowColor = new THREE.Color(0x1a2b1a);
        fogDensity = 0;
      }

      // ── Create normal map texture for ripples ──────────────────
      const normalMapSize = quality === 'ultra' ? 512 : quality === 'high' ? 256 : 128;
      const normalData = new Uint8Array(normalMapSize * normalMapSize * 4);
      for (let i = 0; i < normalMapSize * normalMapSize; i++) {
        // Procedural normal map with subtle ripple pattern
        const x = (i % normalMapSize) / normalMapSize;
        const y = Math.floor(i / normalMapSize) / normalMapSize;
        const nx = Math.sin(x * Math.PI * 8) * 0.1;
        const ny = Math.cos(y * Math.PI * 6) * 0.1;
        normalData[i * 4] = Math.floor((nx + 0.5) * 255);
        normalData[i * 4 + 1] = Math.floor((ny + 0.5) * 255);
        normalData[i * 4 + 2] = 255; // Z always up
        normalData[i * 4 + 3] = 255;
      }
      const normalMapTex = new THREE.DataTexture(normalData, normalMapSize, normalMapSize, THREE.RGBAFormat);
      normalMapTex.wrapS = THREE.RepeatWrapping;
      normalMapTex.wrapT = THREE.RepeatWrapping;
      normalMapTex.needsUpdate = true;

      // Guard against the (rare) race where the effect was cleaned up while
      // `await import('three')` above was pending: the top-of-function
      // `disposed` check already returned early in that case, but re-check
      // here too since `buildWater` keeps running synchronously past this
      // point — an orphaned texture created after teardown would otherwise
      // never reach `normalMapTexRef` and would leak silently.
      if (disposed) {
        normalMapTex.dispose();
        return;
      }
      normalMapTexRef.current = normalMapTex;

      // ── Shared uniforms ────────────────────────────────────────
      const uniforms = {
        uTime: { value: 0 },
        uWaveAmplitude: { value: 0.8 },
        uWaveFrequency: { value: 0.05 },
        uDeepColor: { value: deepColor },
        uShallowColor: { value: shallowColor },
        uFoamColor: { value: new THREE.Color(0xeeffee) },
        uOpacityDeep: { value: 0.85 },
        uOpacityShallow: { value: 0.3 },
        uFoamThreshold: { value: 0.08 },
        uReflectionStrength: { value: enableReflections ? 0.6 : 0.1 },
        uNormalMap: { value: normalMapTex },
      };
      uniformsRef.current = uniforms;

      // ── Hudson River water plane ───────────────────────────────
      const riverGeom = new THREE.PlaneGeometry(
        riverConfig.width,
        riverConfig.length,
        segments,
        segments,
      );
      riverGeom.rotateX(-Math.PI / 2);

      const riverMaterial = new THREE.ShaderMaterial({
        vertexShader: WATER_VERTEX_SHADER,
        fragmentShader: WATER_FRAGMENT_SHADER,
        uniforms,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const riverMesh = new THREE.Mesh(riverGeom, riverMaterial);
      riverMesh.position.set(
        riverConfig.centerX,
        3, // Slightly above terrain at river level
        0,
      );
      riverMesh.userData = { isRiver: true };
      waterGroup.add(riverMesh);

      // ── Foam particles near shoreline ──────────────────────────
      const foamCount = quality === 'low' ? 200 : quality === 'medium' ? 500 : 1000;
      const foamGeom = new THREE.BufferGeometry();
      const foamPositions = new Float32Array(foamCount * 3);
      const foamSizes = new Float32Array(foamCount);
      const foamAlphas = new Float32Array(foamCount);

      for (let i = 0; i < foamCount; i++) {
        // Distribute foam along river banks
        const side = Math.random() > 0.5 ? 1 : -1;
        const bankX = riverConfig.centerX + side * (riverConfig.width / 2 - Math.random() * 10);
        const bankZ = (Math.random() - 0.5) * riverConfig.length;
        foamPositions[i * 3] = bankX;
        foamPositions[i * 3 + 1] = 3.2;
        foamPositions[i * 3 + 2] = bankZ;
        foamSizes[i] = 2 + Math.random() * 4;
        foamAlphas[i] = 0.3 + Math.random() * 0.5;
      }

      foamGeom.setAttribute('position', new THREE.BufferAttribute(foamPositions, 3));
      foamGeom.setAttribute('size', new THREE.BufferAttribute(foamSizes, 1));

      const foamMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 3,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        sizeAttenuation: true,
      });

      const foamPoints = new THREE.Points(foamGeom, foamMat);
      foamPoints.userData = { isFoam: true };
      waterGroup.add(foamPoints);

      // ── Fall Kill Creek ────────────────────────────────────────
      if (creekPath.length >= 2) {
        // Build creek as a tube-like water plane following spline path
        const splinePoints = creekPath.map(
          (p) => new THREE.Vector3(p.x, 5, p.z),
        );
        const spline = new THREE.CatmullRomCurve3(splinePoints);

        // Create a flat ribbon along the spline
        const creekWidth = 8; // 8m wide
        const creekSegments = Math.max(16, Math.floor(creekPath.length * 2));
        const creekVertices: number[] = [];
        const creekUvs: number[] = [];
        const creekIndices: number[] = [];

        for (let i = 0; i <= creekSegments; i++) {
          const t = i / creekSegments;
          const point = spline.getPointAt(t);
          const tangent = spline.getTangentAt(t).normalize();
          const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);

          const left = point.clone().add(normal.clone().multiplyScalar(-creekWidth / 2));
          const right = point.clone().add(normal.clone().multiplyScalar(creekWidth / 2));

          creekVertices.push(left.x, left.y, left.z);
          creekVertices.push(right.x, right.y, right.z);
          creekUvs.push(0, t);
          creekUvs.push(1, t);

          if (i < creekSegments) {
            const base = i * 2;
            creekIndices.push(base, base + 1, base + 2);
            creekIndices.push(base + 1, base + 3, base + 2);
          }
        }

        const creekGeom = new THREE.BufferGeometry();
        creekGeom.setAttribute('position', new THREE.Float32BufferAttribute(creekVertices, 3));
        creekGeom.setAttribute('uv', new THREE.Float32BufferAttribute(creekUvs, 2));
        creekGeom.setIndex(creekIndices);
        creekGeom.computeVertexNormals();

        // Creek-specific uniforms: smaller waves, visible riverbed
        const creekUniforms = {
          ...uniforms,
          uWaveAmplitude: { value: 0.2 },
          uWaveFrequency: { value: 0.12 },
          uOpacityDeep: { value: 0.6 },
          uOpacityShallow: { value: 0.2 },
          uFoamThreshold: { value: 0.15 },
          uDeepColor: { value: new THREE.Color(0x2a5a4c) },
          uShallowColor: { value: new THREE.Color(0x5a7b5a) },
        };

        const creekMaterial = new THREE.ShaderMaterial({
          vertexShader: WATER_VERTEX_SHADER,
          fragmentShader: WATER_FRAGMENT_SHADER,
          uniforms: creekUniforms,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        const creekMesh = new THREE.Mesh(creekGeom, creekMaterial);
        creekMesh.userData = { isCreek: true };
        waterGroup.add(creekMesh);

        // Creek foam particles at elevation changes
        const creekFoamCount = Math.floor(foamCount * 0.3);
        const creekFoamPositions = new Float32Array(creekFoamCount * 3);
        for (let i = 0; i < creekFoamCount; i++) {
          const t = Math.random();
          const p = spline.getPointAt(t);
          const tangent = spline.getTangentAt(t);
          const offset = (Math.random() - 0.5) * creekWidth * 0.8;
          creekFoamPositions[i * 3] = p.x + tangent.z * offset;
          creekFoamPositions[i * 3 + 1] = p.y + 0.3;
          creekFoamPositions[i * 3 + 2] = p.z - tangent.x * offset;
        }
        const creekFoamGeom = new THREE.BufferGeometry();
        creekFoamGeom.setAttribute('position', new THREE.BufferAttribute(creekFoamPositions, 3));
        const creekFoamMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: 1.5,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          sizeAttenuation: true,
        });
        const creekFoam = new THREE.Points(creekFoamGeom, creekFoamMat);
        creekFoam.userData = { isCreekFoam: true };
        waterGroup.add(creekFoam);
      }

      // ── Dawn/dusk fog layer above water surface ────────────────
      if (fogDensity > 0) {
        const fogGeom = new THREE.PlaneGeometry(
          riverConfig.width * 1.5,
          riverConfig.length,
          16,
          16,
        );
        fogGeom.rotateX(-Math.PI / 2);

        const fogUniforms = {
          uTime: uniforms.uTime,
          uDensity: { value: fogDensity },
          uFogColor: { value: fogColor },
        };

        const fogMaterial = new THREE.ShaderMaterial({
          vertexShader: FOG_VERTEX_SHADER,
          fragmentShader: FOG_FRAGMENT_SHADER,
          uniforms: fogUniforms,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });

        const fogMesh = new THREE.Mesh(fogGeom, fogMaterial);
        fogMesh.position.set(riverConfig.centerX, 8, 0); // Above water surface
        fogMesh.userData = { isFog: true };
        waterGroup.add(fogMesh);
      }

      // ── Animation update function ──────────────────────────────
      waterGroup.userData.update = (delta: number, elapsed: number) => {
        uniforms.uTime.value = elapsed;

        // Animate foam particles drift
        const foamPos = foamGeom.getAttribute('position');
        for (let i = 0; i < foamCount; i++) {
          let z = foamPos.getZ(i);
          z += riverConfig.flowSpeed * delta * 5;
          if (z > riverConfig.length / 2) z -= riverConfig.length;
          foamPos.setZ(i, z);
        }
        foamPos.needsUpdate = true;
      };

      waterGroupRef.current = waterGroup;

      // Notify scene
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('concordia:water-ready', {
          detail: { waterGroup },
        }));
      }
    }

    buildWater();

    return () => {
      disposed = true;
      if (waterGroupRef.current) {
        const group = waterGroupRef.current as {
          traverse: (cb: (obj: unknown) => void) => void;
        };
        group.traverse((obj) => {
          const mesh = obj as {
            geometry?: { dispose: () => void };
            material?: { dispose: () => void } | { dispose: () => void }[];
          };
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => m.dispose());
          }
        });
      }
      // The ripple normal map is bound as a custom ShaderMaterial uniform
      // (`uNormalMap`), not a standard `.map`/`.normalMap` material property,
      // so `material.dispose()` — and the traverse above — never reaches it.
      // `buildWater()` allocates a fresh DataTexture (up to 512×512 RGBA)
      // every run; without this it leaked GPU texture memory on every
      // rebuild (mirrors BuildingRenderer3D.tsx / SkyWeatherRenderer.tsx's
      // explicit-texture-dispose pattern, extended to non-standard uniforms).
      if (normalMapTexRef.current) {
        normalMapTexRef.current.dispose();
        normalMapTexRef.current = null;
      }
    };
  }, [riverConfig, creekPath, timeBucket, quality]);

  return (
    <div
      data-component="water-renderer"
      data-time={timeOfDay}
      data-quality={quality}
      style={{ display: 'none' }}
      aria-hidden
    />
  );
}

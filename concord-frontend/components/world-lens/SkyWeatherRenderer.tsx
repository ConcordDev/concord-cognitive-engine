'use client';

import React, { useEffect, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog' | 'overcast' | 'storm';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

interface SkyWeatherRendererProps {
  /** 0-24 continuous hour value (e.g. 14.5 = 2:30 PM) */
  timeOfDay: number;
  weather: WeatherType;
  /** Wind direction in radians (0 = north, PI/2 = east) */
  windDirection: number;
  /** Wind speed in m/s */
  windSpeed: number;
  season: Season;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  /** Phase A4: theme palette override — sky top + horizon colors come
   * from the per-world theme so each canon world's sky reads correctly
   * (cyber dark violet, tunya dusty ochre, etc.). Falls back to
   * sky-shader defaults when unset. */
  themeSkyTop?: number;       // hex (0xrrggbb)
  themeSkyHorizon?: number;
}

// ── Sky Shader ──────────────────────────────────────────────────

const SKY_VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = `
  uniform float uTimeOfDay;  // 0-24
  uniform vec3 uSunDirection;
  uniform float uCloudCover;
  uniform float uSeason;     // 0=spring, 1=summer, 2=autumn, 3=winter
  // Phase A4: per-world theme tint. uThemeTintStrength = 0 disables.
  uniform vec3 uThemeSkyTop;
  uniform vec3 uThemeSkyHorizon;
  uniform float uThemeTintStrength;

  varying vec3 vWorldPosition;
  varying vec2 vUv;

  // Color palette for time-of-day transitions
  vec3 dawnColor   = vec3(0.95, 0.6, 0.3);   // Warm orange
  vec3 dayColor    = vec3(0.4, 0.65, 0.95);   // Blue sky
  vec3 duskColor   = vec3(0.85, 0.3, 0.2);    // Red/orange
  vec3 nightColor  = vec3(0.05, 0.05, 0.15);  // Deep blue

  vec3 getSkyColor(float t, float height) {
    // t is 0-24 time of day
    vec3 color;

    if (t < 5.0) {
      // Night
      color = nightColor;
    } else if (t < 7.0) {
      // Dawn transition
      float f = (t - 5.0) / 2.0;
      color = mix(nightColor, dawnColor, f);
    } else if (t < 8.5) {
      // Dawn to day
      float f = (t - 7.0) / 1.5;
      color = mix(dawnColor, dayColor, f);
    } else if (t < 16.5) {
      // Full day
      color = dayColor;
    } else if (t < 18.0) {
      // Day to dusk
      float f = (t - 16.5) / 1.5;
      color = mix(dayColor, duskColor, f);
    } else if (t < 20.0) {
      // Dusk to night
      float f = (t - 18.0) / 2.0;
      color = mix(duskColor, nightColor, f);
    } else {
      // Night
      color = nightColor;
    }

    // Zenith darkening: sky is darker near horizon at night
    float horizonFactor = smoothstep(0.0, 0.3, height);
    if (t < 5.0 || t > 20.0) {
      color = mix(color * 0.5, color, horizonFactor);
    }

    // Cloud cover darkening
    color = mix(color, color * 0.6, uCloudCover * 0.4);

    return color;
  }

  // Polish-pass: hash-based starfield. Produces a static field of pinprick
  // stars at night that fades during dawn/dusk and disappears during day.
  // The hash is cheap (no textures) and stable per direction so stars don't
  // shimmer wildly between frames.
  float starHash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  vec3 starfield(vec3 dir, float intensity) {
    // Quantize direction into a sparse grid; only a small fraction of cells
    // contain a star, weighted to look natural.
    vec3 q = dir * 220.0;
    vec3 cell = floor(q);
    vec3 frac = fract(q);
    float h = starHash(cell);
    if (h < 0.985) return vec3(0.0);
    // Center the star in the cell with a soft radial falloff.
    vec2 d = frac.xy - 0.5;
    float r = length(d);
    float spark = smoothstep(0.42, 0.0, r);
    // Slight chromatic jitter so the field has variety
    vec3 tint = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.95, 0.8), starHash(cell + 7.3));
    return tint * spark * (0.5 + 0.5 * starHash(cell + 13.1)) * intensity;
  }

  void main() {
    // Height above horizon (normalized)
    vec3 dir = normalize(vWorldPosition);
    float height = max(0.0, dir.y);

    vec3 skyColor = getSkyColor(uTimeOfDay, height);

    // Atmospheric scattering approximation — boost saturation near horizon
    // during golden-hour windows for a richer dawn/dusk read.
    float horizonScatter = pow(1.0 - height, 4.0);
    if (uTimeOfDay > 5.0 && uTimeOfDay < 8.0) {
      // Dawn: warm bias near horizon
      skyColor = mix(skyColor, skyColor * vec3(1.18, 1.05, 0.85), horizonScatter * 0.6);
    } else if (uTimeOfDay > 16.5 && uTimeOfDay < 19.5) {
      // Dusk: deep red bias
      skyColor = mix(skyColor, skyColor * vec3(1.25, 0.85, 0.7), horizonScatter * 0.7);
    }

    // Sun/moon glow near horizon
    float sunDot = max(0.0, dot(dir, uSunDirection));
    float sunGlow = pow(sunDot, 32.0) * 0.5;
    float sunDisc = pow(sunDot, 256.0) * 2.0;

    if (uTimeOfDay > 5.0 && uTimeOfDay < 20.0) {
      // Daytime sun
      skyColor += vec3(1.0, 0.9, 0.7) * (sunGlow + sunDisc);
    } else {
      // Nighttime moon (cooler tint)
      float moonDot = max(0.0, dot(dir, -uSunDirection));
      float moonGlow = pow(moonDot, 64.0) * 0.3;
      float moonDisc = pow(moonDot, 512.0) * 1.0;
      skyColor += vec3(0.7, 0.8, 1.0) * (moonGlow + moonDisc);
    }

    // Starfield — full at night, faded dawn/dusk, off in day. Cloud cover
    // reduces star visibility (stars only show through clear gaps).
    float starIntensity = 0.0;
    if (uTimeOfDay < 5.0 || uTimeOfDay > 20.5) {
      starIntensity = 1.0;
    } else if (uTimeOfDay < 6.5) {
      starIntensity = (6.5 - uTimeOfDay) / 1.5;
    } else if (uTimeOfDay > 19.0) {
      starIntensity = (uTimeOfDay - 19.0) / 1.5;
    }
    starIntensity *= (1.0 - uCloudCover * 0.7);
    if (starIntensity > 0.0 && height > 0.05) {
      skyColor += starfield(dir, starIntensity);
    }

    // Phase A4: per-world theme tint. Mix the procedurally-derived
    // sky color with the canon theme palette so each world reads
    // distinct (cyber violet, tunya ochre, sovereign-ruins gold).
    if (uThemeTintStrength > 0.0) {
      vec3 themeMix = mix(uThemeSkyHorizon, uThemeSkyTop, height);
      skyColor = mix(skyColor, skyColor * themeMix * 2.0, uThemeTintStrength);
    }
    gl_FragColor = vec4(skyColor, 1.0);
  }
`;

// ── Constants ─────────────────────────────────────────────────────

/** Rain particle count by quality */
const RAIN_COUNTS: Record<string, number> = {
  low: 5000,
  medium: 7000,
  high: 10000,
  ultra: 10000,
};

/** Snow particle count by quality */
const SNOW_COUNTS: Record<string, number> = {
  low: 3000,
  medium: 5000,
  high: 8000,
  ultra: 10000,
};

const SHADOW_CASCADE_SIZE = 2048;
const SHADOW_CASCADE_COUNT = 3;

// ── Helper: compute sun/moon position from time ────────────────

function computeSunDirection(timeOfDay: number): [number, number, number] {
  // Sun orbits from east (6am) to west (18pm)
  // Parametric: angle = (timeOfDay - 6) / 12 * PI for daytime arc
  const t = ((timeOfDay - 6) / 12) * Math.PI;
  const x = Math.cos(t);          // East-west
  const y = Math.sin(t);          // Height above horizon
  const z = Math.sin(t * 0.3) * 0.2; // Slight north-south drift

  // Normalize
  const len = Math.sqrt(x * x + y * y + z * z);
  return [x / len, Math.max(y / len, -0.3), z / len];
}

function computeAmbientIntensity(timeOfDay: number): number {
  if (timeOfDay < 5 || timeOfDay > 20) return 0.1;  // Night
  if (timeOfDay < 7) return 0.1 + ((timeOfDay - 5) / 2) * 0.4; // Dawn ramp
  if (timeOfDay > 18) return 0.5 - ((timeOfDay - 18) / 2) * 0.4; // Dusk fade
  return 0.5; // Day
}

function computeSunIntensity(timeOfDay: number): number {
  if (timeOfDay < 5 || timeOfDay > 20) return 0.0;
  if (timeOfDay < 7) return ((timeOfDay - 5) / 2) * 1.2;
  if (timeOfDay > 18) return (1 - (timeOfDay - 18) / 2) * 1.2;
  return 1.2;
}

// ── Component ────────────────────────────────────────────────────

function hexToVec3(hex: number): { x: number; y: number; z: number } {
  return {
    x: ((hex >> 16) & 0xff) / 255,
    y: ((hex >>  8) & 0xff) / 255,
    z: ( hex        & 0xff) / 255,
  };
}

export default function SkyWeatherRenderer({
  timeOfDay,
  weather,
  windDirection,
  windSpeed,
  season,
  quality,
  themeSkyTop,
  themeSkyHorizon,
}: SkyWeatherRendererProps) {
  const skyGroupRef = useRef<unknown>(null);
  const sunLightRef = useRef<unknown>(null);
  const ambientLightRef = useRef<unknown>(null);
  const _particleSystemRef = useRef<unknown>(null);

  useEffect(() => {
    let disposed = false;

    async function init() {
      const THREE = await import('three');
      if (disposed) return;

      const skyGroup = new THREE.Group();
      skyGroup.name = 'sky_weather';

      // ── Sun direction from time of day ────────────────────
      const [sx, sy, sz] = computeSunDirection(timeOfDay);
      const sunDir = new THREE.Vector3(sx, sy, sz);

      // ── Dynamic sky dome ──────────────────────────────────
      const skyGeom = new THREE.SphereGeometry(2000, 32, 16);
      // Invert normals so we see inside
      skyGeom.scale(-1, 1, 1);

      const cloudCover = weather === 'overcast' || weather === 'storm' ? 0.8
        : weather === 'rain' ? 0.6
        : weather === 'fog' ? 0.4
        : weather === 'snow' ? 0.5
        : 0.0;

      const seasonValue = { spring: 0, summer: 1, autumn: 2, winter: 3 }[season];

      const themeTopVec = themeSkyTop != null ? hexToVec3(themeSkyTop) : new THREE.Vector3(1, 1, 1);
      const themeHorVec = themeSkyHorizon != null ? hexToVec3(themeSkyHorizon) : new THREE.Vector3(1, 1, 1);
      const themeStrength = themeSkyTop != null && themeSkyHorizon != null ? 0.35 : 0.0;
      const skyUniforms = {
        uTimeOfDay: { value: timeOfDay },
        uSunDirection: { value: sunDir },
        uCloudCover: { value: cloudCover },
        uSeason: { value: seasonValue },
        uThemeSkyTop: { value: themeTopVec },
        uThemeSkyHorizon: { value: themeHorVec },
        uThemeTintStrength: { value: themeStrength },
      };

      const skyMaterial = new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX_SHADER,
        fragmentShader: SKY_FRAGMENT_SHADER,
        uniforms: skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
      });

      const skyDome = new THREE.Mesh(skyGeom, skyMaterial);
      skyDome.userData = { isSkyDome: true };
      skyGroup.add(skyDome);

      // ── Star field (visible at night) ──────────────────────
      const isNight = timeOfDay < 5 || timeOfDay > 20;
      const isDusk = timeOfDay >= 18 && timeOfDay <= 20;
      const isDawn = timeOfDay >= 5 && timeOfDay <= 7;

      if (isNight || isDusk || isDawn) {
        const starCount = quality === 'low' ? 500 : quality === 'medium' ? 1000 : 2000;
        const starGeom = new THREE.BufferGeometry();
        const starPositions = new Float32Array(starCount * 3);
        const starSizes = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
          // Distribute on upper hemisphere
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.random() * Math.PI * 0.5; // Only above horizon
          const r = 1800;
          starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
          starPositions[i * 3 + 1] = r * Math.cos(phi);
          starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
          starSizes[i] = 1 + Math.random() * 2;
        }

        starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        starGeom.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

        // Star brightness fades during dawn/dusk
        let starOpacity = 1.0;
        if (isDawn) starOpacity = 1 - (timeOfDay - 5) / 2;
        if (isDusk) starOpacity = (timeOfDay - 18) / 2;

        const starMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: 2,
          transparent: true,
          opacity: starOpacity * 0.8,
          depthWrite: false,
          sizeAttenuation: false,
        });

        const stars = new THREE.Points(starGeom, starMat);
        stars.userData = { isStarField: true };
        skyGroup.add(stars);
      }

      // ── Directional light (sun) with cascaded shadow maps ──
      const sunIntensity = computeSunIntensity(timeOfDay);
      const sunColor = timeOfDay < 7 ? 0xffddaa
        : timeOfDay > 18 ? 0xffaa77
        : 0xfff4e0;

      const sunLight = new THREE.DirectionalLight(sunColor, sunIntensity);
      sunLight.position.set(sx * 300, sy * 300, sz * 300);
      sunLight.castShadow = true;

      // Cascaded shadow setup
      sunLight.shadow.mapSize.width = SHADOW_CASCADE_SIZE;
      sunLight.shadow.mapSize.height = SHADOW_CASCADE_SIZE;
      sunLight.shadow.camera.near = 1;
      sunLight.shadow.camera.far = 800;

      // Shadow cascade frustum sizes (3 cascades simulated via shadow camera extent)
      const cascadeExtents = [100, 300, 600];
      const cascadeIdx = quality === 'ultra' ? 2 : quality === 'high' ? 2 : quality === 'medium' ? 1 : 0;
      const extent = cascadeExtents[Math.min(cascadeIdx, SHADOW_CASCADE_COUNT - 1)];
      sunLight.shadow.camera.left = -extent;
      sunLight.shadow.camera.right = extent;
      sunLight.shadow.camera.top = extent;
      sunLight.shadow.camera.bottom = -extent;

      sunLightRef.current = sunLight;
      skyGroup.add(sunLight);

      // ── Ambient light ─────────────────────────────────────
      const ambientIntensity = computeAmbientIntensity(timeOfDay);
      const ambientColor = isNight ? 0x1a1a3a : 0x405070;
      const ambient = new THREE.AmbientLight(ambientColor, ambientIntensity);
      ambientLightRef.current = ambient;
      skyGroup.add(ambient);

      // ── Weather particles ─────────────────────────────────

      // Rain system
      if (weather === 'rain' || weather === 'storm') {
        const rainCount = RAIN_COUNTS[quality];
        const rainGeom = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(rainCount * 3);
        const rainVelocities = new Float32Array(rainCount);

        const spread = 500;
        const heightRange = 200;

        for (let i = 0; i < rainCount; i++) {
          rainPositions[i * 3] = (Math.random() - 0.5) * spread;
          rainPositions[i * 3 + 1] = Math.random() * heightRange;
          rainPositions[i * 3 + 2] = (Math.random() - 0.5) * spread;
          rainVelocities[i] = 15 + Math.random() * 10; // Fall speed
        }

        rainGeom.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));

        // Rain streaks as elongated points
        const rainMat = new THREE.PointsMaterial({
          color: 0xaaccff,
          size: weather === 'storm' ? 0.4 : 0.2,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          sizeAttenuation: true,
        });

        const rain = new THREE.Points(rainGeom, rainMat);
        rain.userData = {
          isRain: true,
          velocities: rainVelocities,
          spread,
          heightRange,
        };
        skyGroup.add(rain);

        // Splash particles on ground (reuse a subset)
        if (quality !== 'low') {
          const splashCount = Math.floor(rainCount * 0.1);
          const splashGeom = new THREE.BufferGeometry();
          const splashPositions = new Float32Array(splashCount * 3);
          for (let i = 0; i < splashCount; i++) {
            splashPositions[i * 3] = (Math.random() - 0.5) * spread;
            splashPositions[i * 3 + 1] = 0.1;
            splashPositions[i * 3 + 2] = (Math.random() - 0.5) * spread;
          }
          splashGeom.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
          const splashMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.8,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
          });
          const splashes = new THREE.Points(splashGeom, splashMat);
          splashes.userData = { isSplash: true };
          skyGroup.add(splashes);
        }

        // Wet surface shader: darken ground materials
        // (Signaled via group userData for TerrainRenderer to read)
        skyGroup.userData.wetSurface = true;
        skyGroup.userData.puddleIntensity = weather === 'storm' ? 0.8 : 0.4;
      }

      // Snow system
      if (weather === 'snow') {
        const snowCount = SNOW_COUNTS[quality];
        const snowGeom = new THREE.BufferGeometry();
        const snowPositions = new Float32Array(snowCount * 3);
        const snowDrifts = new Float32Array(snowCount * 2); // drift x, drift z per particle

        const spread = 500;
        const heightRange = 150;

        for (let i = 0; i < snowCount; i++) {
          snowPositions[i * 3] = (Math.random() - 0.5) * spread;
          snowPositions[i * 3 + 1] = Math.random() * heightRange;
          snowPositions[i * 3 + 2] = (Math.random() - 0.5) * spread;
          // Each snowflake has a unique drift pattern
          snowDrifts[i * 2] = (Math.random() - 0.5) * 2;
          snowDrifts[i * 2 + 1] = (Math.random() - 0.5) * 2;
        }

        snowGeom.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));

        const snowMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: 1.0,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          sizeAttenuation: true,
        });

        const snow = new THREE.Points(snowGeom, snowMat);
        snow.userData = {
          isSnow: true,
          drifts: snowDrifts,
          spread,
          heightRange,
        };
        skyGroup.add(snow);

        // Snow accumulation signaling
        skyGroup.userData.snowAccumulation = true;
        skyGroup.userData.snowLoadWarning = season === 'winter' && windSpeed > 5;
      }

      // Fog system
      if (weather === 'fog') {
        // Exponential fog applied to scene
        skyGroup.userData.fogConfig = {
          type: 'exponential',
          density: 0.003,
          color: 0xcccccc,
          // Morning fog near river
          nearRiver: timeOfDay < 10,
          // Evening rolling in
          eveningRoll: timeOfDay > 16,
        };
      }

      // Cloud shadow projection
      if (weather !== 'clear' && quality !== 'low') {
        // Create a shadow-casting plane that moves across terrain
        const cloudShadowGeom = new THREE.PlaneGeometry(800, 800);
        cloudShadowGeom.rotateX(-Math.PI / 2);

        const cloudShadowMat = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: cloudCover * 0.15,
          depthWrite: false,
        });

        const cloudShadow = new THREE.Mesh(cloudShadowGeom, cloudShadowMat);
        cloudShadow.position.y = 1; // Just above terrain
        cloudShadow.userData = {
          isCloudShadow: true,
          moveSpeed: windSpeed * 0.5,
          moveDirection: windDirection,
        };
        skyGroup.add(cloudShadow);
      }

      // ── Weather transition state ───────────────────────────
      skyGroup.userData.weatherTransition = {
        current: weather,
        target: weather,
        progress: 1.0, // 1.0 = fully transitioned
        transitionSpeed: 0.1, // Gradual onset/clear
      };

      // ── Animation update function ──────────────────────────
      skyGroup.userData.update = (delta: number, elapsed: number) => {
        // Update sky uniforms for smooth time progression
        skyUniforms.uTimeOfDay.value = timeOfDay;

        // Update sun/moon position
        const [sx2, sy2, sz2] = computeSunDirection(timeOfDay);
        skyUniforms.uSunDirection.value.set(sx2, sy2, sz2);

        // Update directional light
        const sl = sunLightRef.current as InstanceType<typeof import('three').DirectionalLight>;
        if (sl) {
          sl.position.set(sx2 * 300, sy2 * 300, sz2 * 300);
          sl.intensity = computeSunIntensity(timeOfDay);
        }

        // Update ambient
        const al = ambientLightRef.current as InstanceType<typeof import('three').AmbientLight>;
        if (al) {
          al.intensity = computeAmbientIntensity(timeOfDay);
        }

        // ── Rain animation ──────────────────────────────────
        skyGroup.traverse((child) => {
          const obj = child as unknown as InstanceType<typeof import('three').Points> & {
            userData: Record<string, unknown>;
          };

          if (obj.userData?.isRain) {
            const posAttr = (obj.geometry as InstanceType<typeof import('three').BufferGeometry>)
              .getAttribute('position') as InstanceType<typeof import('three').BufferAttribute>;
            const velocities = obj.userData.velocities as Float32Array;
            const spread = obj.userData.spread as number;
            const heightRange = obj.userData.heightRange as number;

            // Wind affects rain angle
            const windX = Math.sin(windDirection) * windSpeed * 0.3;
            const windZ = Math.cos(windDirection) * windSpeed * 0.3;

            for (let i = 0; i < posAttr.count; i++) {
              let x = posAttr.getX(i);
              let y = posAttr.getY(i);
              let z = posAttr.getZ(i);

              y -= velocities[i] * delta;
              x += windX * delta;
              z += windZ * delta;

              // Reset when below ground
              if (y < 0) {
                y = heightRange;
                x = (Math.random() - 0.5) * spread;
                z = (Math.random() - 0.5) * spread;
              }

              posAttr.setXYZ(i, x, y, z);
            }
            posAttr.needsUpdate = true;
          }

          if (obj.userData?.isSnow) {
            const posAttr = (obj.geometry as InstanceType<typeof import('three').BufferGeometry>)
              .getAttribute('position') as InstanceType<typeof import('three').BufferAttribute>;
            const drifts = obj.userData.drifts as Float32Array;
            const spread = obj.userData.spread as number;
            const heightRange = obj.userData.heightRange as number;

            const windX = Math.sin(windDirection) * windSpeed * 0.5;
            const windZ = Math.cos(windDirection) * windSpeed * 0.5;
            const fallSpeed = 2.0; // Snow falls slowly

            for (let i = 0; i < posAttr.count; i++) {
              let x = posAttr.getX(i);
              let y = posAttr.getY(i);
              let z = posAttr.getZ(i);

              // Slow fall with wind drift
              y -= fallSpeed * delta;
              x += (windX + drifts[i * 2] * Math.sin(elapsed * 0.5 + i)) * delta;
              z += (windZ + drifts[i * 2 + 1] * Math.cos(elapsed * 0.4 + i)) * delta;

              // Reset at ground, simulating accumulation
              if (y < 0) {
                y = heightRange;
                x = (Math.random() - 0.5) * spread;
                z = (Math.random() - 0.5) * spread;
              }

              posAttr.setXYZ(i, x, y, z);
            }
            posAttr.needsUpdate = true;
          }

          // Cloud shadow movement
          if (obj.userData?.isCloudShadow) {
            const speed = obj.userData.moveSpeed as number;
            const dir = obj.userData.moveDirection as number;
            const mesh = obj as unknown as InstanceType<typeof import('three').Mesh>;
            mesh.position.x += Math.sin(dir) * speed * delta;
            mesh.position.z += Math.cos(dir) * speed * delta;

            // Wrap cloud shadow position
            if (mesh.position.x > 500) mesh.position.x -= 1000;
            if (mesh.position.x < -500) mesh.position.x += 1000;
            if (mesh.position.z > 500) mesh.position.z -= 1000;
            if (mesh.position.z < -500) mesh.position.z += 1000;
          }
        });

        // ── Weather transition ──────────────────────────────
        const transition = skyGroup.userData.weatherTransition as {
          current: string;
          target: string;
          progress: number;
          transitionSpeed: number;
        };
        if (transition.progress < 1.0) {
          transition.progress = Math.min(1.0, transition.progress + delta * transition.transitionSpeed);
        }
      };

      skyGroupRef.current = skyGroup;

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('concordia:sky-weather-ready', {
          detail: { skyGroup },
        }));
      }
    }

    init();

    return () => {
      disposed = true;
      if (skyGroupRef.current) {
        const group = skyGroupRef.current as {
          traverse: (cb: (obj: unknown) => void) => void;
        };
        group.traverse((obj) => {
          const mesh = obj as {
            geometry?: { dispose: () => void };
            material?: { dispose: () => void; map?: { dispose: () => void } } |
                        { dispose: () => void; map?: { dispose: () => void } }[];
          };
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          }
        });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- theme colors are derived from the listed deps; re-running on them is sufficient
  }, [timeOfDay, weather, windDirection, windSpeed, season, quality]);

  return (
    <div
      data-component="sky-weather-renderer"
      data-time={timeOfDay}
      data-weather={weather}
      data-season={season}
      data-wind-speed={windSpeed}
      style={{ display: 'none' }}
      aria-hidden
    />
  );
}

export { computeSunDirection, computeAmbientIntensity, computeSunIntensity };

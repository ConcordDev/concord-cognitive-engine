'use client';

/**
 * InstancedGrass — Sprint D / W2
 *
 * GPU-instanced grass blades around the player camera. Vertex-shader
 * displacement computes wind sway from a Perlin-like sin field plus
 * brush response when the player position is near. Density scales with
 * quality preset.
 *
 * Mounted by ConcordiaScene next to the terrain renderer.
 */

import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

interface Props {
  /** Grass density 0..1. Default 0.6. */
  density?: number;
  /** Tile half-width in metres. Default 80m. */
  tileHalf?: number;
  /** Per-tile blade count (before density multiplier). */
  bladesPerTile?: number;
  /** World-space player position (for brush response). */
  playerPos?: { x: number; y: number; z: number };
  /** Wind direction in radians. */
  windDirection?: number;
  /** Base blade colour (used as bottom of vertex gradient). */
  bottomColor?: string;
  /** Tip colour. */
  tipColor?: string;
}

const VERT = /* glsl */`
  uniform float uTime;
  uniform vec2  uPlayer;
  uniform vec2  uWindDir;
  uniform float uWindStrength;

  attribute vec3 instancePos;
  attribute float instanceScale;
  attribute float instancePhase;

  varying vec3 vColor;
  varying float vTipMix;

  void main() {
    // Place the blade in the world.
    vec3 pos = position * instanceScale;

    // Scaled height of the vertex (0 at base, 1 at tip) for the sway curve.
    float heightFactor = max(0.0, position.y);
    vTipMix = heightFactor;

    // Procedural wind: low-freq base + high-freq jitter, modulated by direction.
    float baseWind = sin(uTime * 1.4 + instancePhase + instancePos.x * 0.15 + instancePos.z * 0.10);
    float jitter   = sin(uTime * 5.0 + instancePhase * 3.0) * 0.20;
    float sway = (baseWind + jitter) * uWindStrength * heightFactor;

    pos.x += uWindDir.x * sway;
    pos.z += uWindDir.y * sway;

    // Brush response: bend away from the player when within 1.5m.
    vec2 toPlayer = uPlayer - instancePos.xz;
    float pdist = length(toPlayer);
    if (pdist < 1.5 && pdist > 0.0001) {
      vec2 away = -toPlayer / pdist;
      float bend = (1.0 - pdist / 1.5) * 0.6 * heightFactor;
      pos.x += away.x * bend;
      pos.z += away.y * bend;
    }

    vec4 worldPos = vec4(pos + instancePos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPos;

    // Pass tipMix to fragment for colour gradient.
    vColor = vec3(0.0);
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uBottom;
  uniform vec3 uTip;
  varying float vTipMix;
  void main() {
    vec3 col = mix(uBottom, uTip, vTipMix);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export default function InstancedGrass({
  density = 0.6,
  tileHalf = 80,
  bladesPerTile = 4000,
  playerPos = { x: 0, y: 0, z: 0 },
  windDirection = 0,
  bottomColor = '#385828',
  tipColor = '#7a9a55',
}: Props) {
  const { gl } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const startTime = useRef(performance.now() / 1000);

  // Build a single tall thin blade geometry once. Three vertices stacked.
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array([
      -0.04, 0,    0,
       0.04, 0,    0,
       0,    0.55, 0,
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex([0, 1, 2]);
    return g;
  }, []);

  // Build per-instance attributes (positions, scales, phases).
  const blades = Math.max(100, Math.floor(bladesPerTile * density));
  const instanceData = useMemo(() => {
    const positions = new Float32Array(blades * 3);
    const scales = new Float32Array(blades);
    const phases = new Float32Array(blades);
    for (let i = 0; i < blades; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * tileHalf;
      positions[i * 3 + 0] = Math.cos(ang) * r;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(ang) * r;
      scales[i] = 0.7 + Math.random() * 0.6;
      phases[i] = Math.random() * Math.PI * 2;
    }
    return { positions, scales, phases };
  }, [blades, tileHalf]);

  // Material with custom shader.
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime:         { value: 0 },
        uPlayer:       { value: new THREE.Vector2(0, 0) },
        uWindDir:      { value: new THREE.Vector2(Math.cos(windDirection), Math.sin(windDirection)) },
        uWindStrength: { value: 0.18 },
        uBottom:       { value: new THREE.Color(bottomColor) },
        uTip:          { value: new THREE.Color(tipColor) },
      },
      side: THREE.DoubleSide,
    });
    return m;
  }, [bottomColor, tipColor, windDirection]);

  // Build the InstancedBufferGeometry attaching instance attributes.
  const instGeometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', geometry.getAttribute('position'));
    g.setIndex(geometry.getIndex());
    g.setAttribute('instancePos', new THREE.InstancedBufferAttribute(instanceData.positions, 3));
    g.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(instanceData.scales, 1));
    g.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(instanceData.phases, 1));
    g.instanceCount = blades;
    return g;
  }, [geometry, instanceData, blades]);

  useEffect(() => {
    return () => {
      instGeometry.dispose();
      material.dispose();
      geometry.dispose();
    };
  }, [instGeometry, material, geometry]);

  useFrame(() => {
    const now = performance.now() / 1000 - startTime.current;
    material.uniforms.uTime.value = now;
    material.uniforms.uPlayer.value.set(playerPos.x, playerPos.z);
    // Recentre tile under camera.
    if (meshRef.current) {
      meshRef.current.position.set(
        Math.round(playerPos.x / 5) * 5,
        playerPos.y,
        Math.round(playerPos.z / 5) * 5,
      );
    }
    void gl;
  });

  return (
    <mesh ref={meshRef} frustumCulled={false}>
      <primitive object={instGeometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

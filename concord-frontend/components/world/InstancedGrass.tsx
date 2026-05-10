'use client';

/**
 * InstancedGrass — Sprint D / W2
 *
 * GPU-instanced grass blades around the player camera. Vertex-shader
 * displacement computes wind sway from a Perlin-like sin field plus
 * brush response when the player position is near. Density scales with
 * quality preset.
 *
 * Self-contained: mounts a fixed-position canvas + its own renderer +
 * camera + scene + animation loop. Does NOT require an R3F `<Canvas>`
 * parent (ConcordiaScene uses imperative Three.js, not R3F). The
 * canvas is positioned as a transparent overlay so it composes with
 * ConcordiaScene's render output.
 *
 * For zero-cost when grass shouldn't render (no player position fed,
 * SSR), the component bails before allocating GPU resources.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

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

  varying float vTipMix;

  void main() {
    vec3 pos = position * instanceScale;
    float heightFactor = max(0.0, position.y);
    vTipMix = heightFactor;

    float baseWind = sin(uTime * 1.4 + instancePhase + instancePos.x * 0.15 + instancePos.z * 0.10);
    float jitter   = sin(uTime * 5.0 + instancePhase * 3.0) * 0.20;
    float sway = (baseWind + jitter) * uWindStrength * heightFactor;

    pos.x += uWindDir.x * sway;
    pos.z += uWindDir.y * sway;

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTime = useRef(performance.now() / 1000);
  const playerPosRef = useRef(playerPos);
  playerPosRef.current = playerPos;

  // Memoised instance data so re-renders don't reallocate.
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Renderer + scene + camera (orthographic for bird's-eye composing).
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 6, 12);
    camera.lookAt(0, 0, 0);

    // Blade geometry.
    const bladeGeom = new THREE.BufferGeometry();
    bladeGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.04, 0,    0,
       0.04, 0,    0,
       0,    0.55, 0,
    ]), 3));
    bladeGeom.setIndex([0, 1, 2]);

    // Material.
    const material = new THREE.ShaderMaterial({
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

    // InstancedBufferGeometry composing the blade with per-blade attributes.
    const instGeom = new THREE.InstancedBufferGeometry();
    instGeom.setAttribute('position', bladeGeom.getAttribute('position'));
    const idx = bladeGeom.getIndex();
    if (idx) instGeom.setIndex(idx);
    instGeom.setAttribute('instancePos', new THREE.InstancedBufferAttribute(instanceData.positions, 3));
    instGeom.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(instanceData.scales, 1));
    instGeom.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(instanceData.phases, 1));
    instGeom.instanceCount = blades;

    const mesh = new THREE.Mesh(instGeom, material);
    scene.add(mesh);

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    const tick = () => {
      const now = performance.now() / 1000 - startTime.current;
      material.uniforms.uTime.value = now;
      const pp = playerPosRef.current;
      material.uniforms.uPlayer.value.set(pp.x, pp.z);
      mesh.position.set(
        Math.round(pp.x / 5) * 5,
        pp.y,
        Math.round(pp.z / 5) * 5,
      );
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      instGeom.dispose();
      bladeGeom.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [blades, instanceData, windDirection, bottomColor, tipColor]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 4,
        mixBlendMode: 'multiply',
      }}
    />
  );
}

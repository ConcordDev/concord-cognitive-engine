// concord-frontend/components/conkay/HolographicMaterial.ts
//
// ConKay Phase 3 — the JARVIS holographic look. A drei `shaderMaterial`
// drop-in (fresnel rim glow + scrolling scanlines + subtle flicker), additive
// + transparent so it reads as projected light. Honest-by-construction: the
// material itself is decorative, but its `uIntensity` is driven by ConKay's
// REAL state in ConKayScene (inFlight / state machine), never an ambient timer.
//
// Pattern: shaderMaterial() builds a THREE.ShaderMaterial subclass with the
// given uniforms exposed as props; extend() registers it for JSX so it can be
// used as <holographicMaterial .../>. Update uTime each frame from useFrame.

import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';

export const HolographicMaterial = shaderMaterial(
  {
    uTime: 0,
    uIntensity: 0.6,
    uFresnelColor: new THREE.Color('#22d3ee'),
    uScanColor: new THREE.Color('#a855f7'),
    uScanCount: 60.0,
    uScanSpeed: 1.6,
    uFresnelPower: 2.2,
  },
  // vertex
  /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vViewDir;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vViewDir = normalize(cameraPosition - worldPos.xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  // fragment
  /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vViewDir;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uFresnelColor;
    uniform vec3 uScanColor;
    uniform float uScanCount;
    uniform float uScanSpeed;
    uniform float uFresnelPower;

    void main() {
      // Rim/fresnel — bright at grazing angles, like a hologram's edge.
      float fres = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0), uFresnelPower);
      // Scrolling scanlines.
      float scan = 0.5 + 0.5 * sin(vUv.y * uScanCount - uTime * uScanSpeed);
      scan = pow(scan, 3.0);
      // Subtle flicker so a static hologram still feels alive (deterministic).
      float flicker = 0.9 + 0.1 * sin(uTime * 7.0);

      vec3 col = mix(uScanColor, uFresnelColor, fres);
      float alpha = (fres * 0.8 + scan * 0.35) * uIntensity * flicker;
      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }
  `,
);

extend({ HolographicMaterial });

export default HolographicMaterial;

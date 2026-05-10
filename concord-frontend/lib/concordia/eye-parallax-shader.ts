/**
 * Eye parallax shader — Sprint D / BB2
 *
 * Separate eye sphere mesh per character with parallax-occlusion iris
 * depth, fresnel highlight, and scattering on sclera. Single biggest
 * "alive vs dead-eyed" tell.
 *
 * Mounts on the head bone. Two eye spheres per character.
 */

import * as THREE from 'three';

export const EYE_VERT = /* glsl */`
  varying vec3 vViewDir;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 viewPos4 = viewMatrix * worldPos;
    vViewPos = viewPos4.xyz;
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-viewPos4.xyz);
    vUv = uv;
    gl_Position = projectionMatrix * viewPos4;
  }
`;

export const EYE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uIrisColor;
  uniform vec3 uScleraColor;
  uniform vec3 uPupilColor;
  uniform float uIrisRadius;
  uniform float uPupilRadius;
  uniform float uParallaxDepth;
  uniform float uTime;
  varying vec3 vViewDir;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewPos;

  void main() {
    // Treat the front surface as a curved cornea — UV centred at (0.5, 0.5).
    vec2 d = vUv - vec2(0.5);
    float r = length(d);

    // Parallax: shift iris UV based on view angle inside the cornea bubble.
    vec2 viewOffset = vViewDir.xy * uParallaxDepth * 0.06;
    vec2 irisUv = d - viewOffset;
    float irisR = length(irisUv);

    // Sclera (white of the eye) outside iris radius.
    vec3 col;
    if (irisR > uIrisRadius) {
      // Slight warm tint near the iris boundary; pure white toward edges.
      float blend = smoothstep(uIrisRadius, uIrisRadius * 1.6, irisR);
      col = mix(uScleraColor, uScleraColor * 0.95 + vec3(0.10, 0.05, 0.05), 1.0 - blend);
    } else if (irisR > uPupilRadius) {
      // Iris — radial striations + slight noise.
      float t = irisR / uIrisRadius;
      float angle = atan(irisUv.y, irisUv.x);
      float striations = 0.5 + 0.5 * sin(angle * 30.0);
      vec3 irisCol = mix(uIrisColor * 1.4, uIrisColor * 0.6, striations * 0.5);
      irisCol = mix(irisCol, uIrisColor, t);
      col = irisCol;
    } else {
      col = uPupilColor;
    }

    // Fresnel highlight — bright spot on edges.
    float fres = pow(1.0 - max(0.0, dot(vNormal, vViewDir)), 3.0);
    col += vec3(0.7) * fres * 0.4;

    // Specular highlight — small bright spot near top-left of iris (key light).
    vec2 spec = d - vec2(-0.08, 0.10);
    float specMask = smoothstep(0.05, 0.0, length(spec));
    col += vec3(1.0) * specMask * 0.6;

    // Subtle wetness sheen modulation.
    col *= 0.95 + 0.10 * sin(uTime * 0.4 + vUv.x * 6.0);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface EyeAppearance {
  irisColor:   string;
  scleraColor?: string;
  pupilColor?:  string;
  /** Iris radius in UV space (default 0.32). */
  irisRadius?:   number;
  /** Pupil radius in UV space (default 0.10). */
  pupilRadius?:  number;
}

export interface EyeMesh {
  group:    THREE.Group;
  leftEye:  THREE.Mesh;
  rightEye: THREE.Mesh;
  /** Caller advances time uniform per frame for the wetness sheen. */
  tick:     (dt: number) => void;
}

/**
 * Build a pair of eye spheres ready to attach to the Head bone.
 * Caller positions the returned group at the head's eye-line offset.
 */
export function createEyePair(appearance: EyeAppearance, eyeRadius: number = 0.022): EyeMesh {
  const irisHex = parseInt(appearance.irisColor.replace(/^#/, ''), 16);
  const scleraHex = parseInt((appearance.scleraColor ?? '#f0e8e0').replace(/^#/, ''), 16);
  const pupilHex = parseInt((appearance.pupilColor ?? '#0a0a0a').replace(/^#/, ''), 16);
  const irisRadius = appearance.irisRadius ?? 0.32;
  const pupilRadius = appearance.pupilRadius ?? 0.10;

  const buildEye = () => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: EYE_VERT,
      fragmentShader: EYE_FRAG,
      uniforms: {
        uIrisColor:    { value: new THREE.Color(irisHex) },
        uScleraColor:  { value: new THREE.Color(scleraHex) },
        uPupilColor:   { value: new THREE.Color(pupilHex) },
        uIrisRadius:   { value: irisRadius },
        uPupilRadius:  { value: pupilRadius },
        uParallaxDepth:{ value: 1.0 },
        uTime:         { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius, 16, 12), mat);
    return mesh;
  };

  const left = buildEye();
  const right = buildEye();
  left.position.set(0.022, 0, 0.082);
  right.position.set(-0.022, 0, 0.082);

  const group = new THREE.Group();
  group.add(left);
  group.add(right);

  let timeAcc = 0;
  const tick = (dt: number) => {
    timeAcc += dt;
    (left.material as THREE.ShaderMaterial).uniforms.uTime.value = timeAcc;
    (right.material as THREE.ShaderMaterial).uniforms.uTime.value = timeAcc;
  };

  return { group, leftEye: left, rightEye: right, tick };
}

export const EYE_CONSTANTS = Object.freeze({
  DEFAULT_IRIS_RADIUS: 0.32,
  DEFAULT_PUPIL_RADIUS: 0.10,
});

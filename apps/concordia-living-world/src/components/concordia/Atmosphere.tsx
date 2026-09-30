import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Theme } from "@/game/content";
import { heightAt } from "@/game/life";
import { qualityOpts } from "@/game/quality";
import type { Sim } from "@/game/sim";
import { fogDensity, sunFromHour } from "@/game/sun";
import { useOverlay } from "@/game/store";

function AtmosphereSky({
  theme,
  sunPos,
  sunColor,
  night,
  dusk,
}: {
  theme: Theme;
  sunPos: [number, number, number];
  sunColor: string;
  night: boolean;
  dusk: boolean;
}) {
  const geo = useMemo(() => new THREE.SphereGeometry(1600, 28, 18), []);
  const mat = useMemo(() => {
    const top = night ? "#0b1220" : dusk ? "#c87848" : theme.skyTop;
    const mid = night ? "#1a2438" : dusk ? "#f0a060" : theme.skyHorizon;
    const bot = night ? "#121018" : dusk ? "#e88850" : theme.fog;
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(top) },
        mid: { value: new THREE.Color(mid) },
        bot: { value: new THREE.Color(bot) },
        lamp: { value: new THREE.Color(dusk ? sunColor : theme.lamp) },
        sunDir: { value: new THREE.Vector3(...sunPos).normalize() },
        sunCol: { value: new THREE.Color(sunColor) },
        night: { value: night ? 1 : 0 },
      },
      vertexShader: `varying vec3 vP; varying vec3 vW; void main(){ vP = position; vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 lamp;
        uniform vec3 sunDir; uniform vec3 sunCol; uniform float night;
        varying vec3 vP; varying vec3 vW;
        void main(){
          float h = clamp(vW.y * 0.5 + 0.42, 0.0, 1.0);
          vec3 col = mix(bot, mid, smoothstep(0.0, 0.4, h));
          col = mix(col, top, pow(smoothstep(0.28, 1.0, h), 0.85));
          float sun = pow(max(0.0, dot(vW, sunDir)), 48.0);
          float halo = pow(max(0.0, dot(vW, sunDir)), 6.0);
          col += sunCol * sun * (night > 0.5 ? 0.35 : 1.15);
          col += sunCol * halo * (night > 0.5 ? 0.08 : 0.28);
          float hz = pow(max(0.0, 1.0 - abs(h - 0.3) * 3.4), 2.2);
          col += lamp * hz * 0.16;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }, [theme.skyTop, theme.skyHorizon, theme.fog, theme.lamp, sunPos, sunColor, night, dusk]);
  useLayoutEffect(() => {
    const u = (mat as THREE.ShaderMaterial).uniforms;
    u.sunDir.value.set(...sunPos).normalize();
    u.sunCol.value.set(sunColor);
  }, [mat, sunPos, sunColor]);
  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
}

function RendererLook({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useLayoutEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl, exposure]);
  return null;
}

function FollowSun({
  simRef,
  color,
  intensity,
  offset,
  mapSize,
  enabled,
}: {
  simRef: MutableRefObject<Sim>;
  color: string;
  intensity: number;
  offset: [number, number, number];
  mapSize: number;
  enabled: boolean;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const p = simRef.current.player;
    const gy = heightAt(simRef.current.worldId, p.x, p.z);
    l.position.set(p.x + offset[0], gy + offset[1], p.z + offset[2]);
    target.position.set(p.x, gy + 0.35, p.z);
    target.updateMatrixWorld();
    l.target = target;
  });
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        color={color}
        intensity={intensity}
        castShadow={enabled}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-camera-far={140}
        shadow-camera-near={4}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-bias={-0.00016}
        shadow-normalBias={0.035}
      />
    </>
  );
}

function FollowFill({ simRef, color, intensity }: { simRef: MutableRefObject<Sim>; color: string; intensity: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const sim = simRef.current;
    const p = sim.player;
    const gy = heightAt(sim.worldId, p.x, p.z);
    const fx = -Math.sin(sim.camYaw);
    const fz = -Math.cos(sim.camYaw);
    l.position.set(p.x - fx * 5.5, gy + 3.1, p.z - fz * 5.5);
  });
  return <directionalLight ref={light} color={color} intensity={intensity} />;
}

export function Atmosphere({
  theme,
  simRef,
}: {
  theme: Theme;
  simRef: MutableRefObject<Sim>;
}) {
  const hour = useOverlay((s) => s.hour);
  const weather = useOverlay((s) => s.weather);
  const quality = useOverlay((s) => s.quality);
  const q = qualityOpts(quality);
  const sun = useMemo(() => sunFromHour(hour, theme), [hour, theme]);
  const density = fogDensity(weather, theme.style, sun.night);
  const fogCol = sun.night ? "#1a2230" : sun.dusk ? "#e8a070" : theme.fog;

  return (
    <>
      <RendererLook exposure={sun.exposure} />
      <AtmosphereSky theme={theme} sunPos={sun.position} sunColor={sun.color} night={sun.night} dusk={sun.dusk} />
      <fogExp2 attach="fog" args={[fogCol, density]} />
      <ambientLight intensity={sun.ambient} />
      <hemisphereLight args={[sun.night ? "#6a7a98" : theme.ambient, theme.ground, sun.hemi]} />
      <FollowSun
        simRef={simRef}
        color={sun.color}
        intensity={sun.intensity}
        offset={sun.position}
        mapSize={Math.min(q.map, 1024)}
        enabled={q.shadows}
      />
      <FollowFill simRef={simRef} color={sun.night ? "#8aa0c8" : "#e8f2ff"} intensity={sun.night ? 0.22 : 0.38} />
    </>
  );
}

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Theme, WorldId } from "@/game/content";
import { worldKit } from "@/game/worlds";
import { ToonMesh, toonRamp } from "./Toon";
import { LifeField } from "./LifeField";
import type { Sim } from "@/game/sim";

function SkyDome({ theme }: { theme: Theme }) {
  const geo = useMemo(() => new THREE.SphereGeometry(2200, 24, 16), []);
  const mat = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(theme.skyTop) },
        bot: { value: new THREE.Color(theme.skyHorizon) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h = clamp(vP.y / 700.0 * 0.5 + 0.45, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, h), 1.0); }`,
    });
  }, [theme.skyTop, theme.skyHorizon]);
  return <mesh geometry={geo} material={mat} />;
}

function Landmark({
  kind,
  x,
  z,
  rot = 0,
  s = 1,
  theme,
}: {
  kind: string;
  x: number;
  z: number;
  rot?: number;
  s?: number;
  theme: Theme;
}) {
  const stone = theme.building;
  const dark = theme.building2;
  const lamp = theme.lamp;
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={s}>
      {kind === "tree" ? (
        <>
          <ToonMesh color="#6a4a28" position={[0, 0.9, 0]} scale={[0.38, 1.8, 0.38]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
          </ToonMesh>
          <ToonMesh color="#4f6a38" position={[0, 2.3, 0]} scale={[2.1, 1.8, 2.1]}>
            <sphereGeometry args={[0.5, 10, 8]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "mesa" ? (
        <ToonMesh color={stone} position={[0, 1.1, 0]} scale={[2.4, 2.2, 2.4]}>
          <cylinderGeometry args={[0.5, 0.62, 1, 8]} />
        </ToonMesh>
      ) : null}
      {kind === "arch" ? (
        <>
          <ToonMesh color={stone} position={[-1.1, 1.6, 0]} scale={[0.45, 3.2, 0.55]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={stone} position={[1.1, 1.6, 0]} scale={[0.45, 3.2, 0.55]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={dark} position={[0, 3.3, 0]} scale={[2.8, 0.45, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "pillar" ? (
        <>
          <ToonMesh color={stone} position={[0, 1.6, 0]} scale={[0.55, 3.2, 0.55]}>
            <cylinderGeometry args={[0.5, 0.55, 1, 8]} />
          </ToonMesh>
          <ToonMesh color={dark} position={[0.18, 0.35, 0.1]} rotation={[0, 0, 0.5]} scale={[0.4, 0.7, 0.4]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "column" ? (
        <ToonMesh color={stone} position={[0, 1.8, 0]} scale={[0.5, 3.6, 0.5]}>
          <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
        </ToonMesh>
      ) : null}
      {kind === "statue" ? (
        <>
          <ToonMesh color={dark} position={[0, 0.25, 0]} scale={[1.1, 0.5, 1.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={stone} position={[0, 1.15, 0]} scale={[0.55, 1.3, 0.4]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={stone} position={[0, 2.05, 0]} scale={[0.42, 0.42, 0.42]}>
            <sphereGeometry args={[0.5, 8, 6]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "banner" ? (
        <>
          <ToonMesh color="#5a4a32" position={[0, 1.6, 0]} scale={[0.12, 3.2, 0.12]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
          </ToonMesh>
          <mesh position={[0.55, 2.4, 0]}>
            <planeGeometry args={[1.1, 1.4]} />
            <meshBasicMaterial color={lamp} side={THREE.DoubleSide} transparent opacity={0.85} />
          </mesh>
        </>
      ) : null}
      {kind === "wall" ? (
        <ToonMesh color={stone} position={[0, 1.4, 0]} scale={[6.5, 2.8, 0.45]}>
          <boxGeometry args={[1, 1, 1]} />
        </ToonMesh>
      ) : null}
      {kind === "gate" ? (
        <>
          <ToonMesh color={stone} position={[-1.7, 1.8, 0]} scale={[0.55, 3.6, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={stone} position={[1.7, 1.8, 0]} scale={[0.55, 3.6, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={dark} position={[0, 3.7, 0]} scale={[4.1, 0.5, 0.9]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "tower" ? (
        <>
          <ToonMesh color={dark} position={[0, 2.4, 0]} scale={[1.4, 4.8, 1.4]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <mesh position={[0, 3.2, 0.72]}>
            <planeGeometry args={[1.05, 2.4]} />
            <meshBasicMaterial color={lamp} transparent opacity={0.45} />
          </mesh>
        </>
      ) : null}
      {kind === "rack" ? (
        <>
          <ToonMesh color="#4a3828" position={[0, 0.7, 0]} scale={[1.6, 1.4, 0.35]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={lamp} outline={false} position={[-0.3, 1.15, 0.05]} rotation={[0, 0, 0.3]} scale={[0.08, 1.1, 0.08]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={lamp} outline={false} position={[0.25, 1.1, 0.05]} rotation={[0, 0, -0.2]} scale={[0.08, 1.05, 0.08]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "fire" ? (
        <>
          <ToonMesh color="#3a2a1c" position={[0, 0.2, 0]} scale={[0.9, 0.4, 0.9]}>
            <cylinderGeometry args={[0.5, 0.55, 1, 8]} />
          </ToonMesh>
          <mesh position={[0, 0.7, 0]}>
            <coneGeometry args={[0.28, 0.7, 6]} />
            <meshBasicMaterial color={lamp} />
          </mesh>
        </>
      ) : null}
      {kind === "wagon" ? (
        <>
          <ToonMesh color="#6a4a28" position={[0, 0.85, 0]} scale={[2.6, 1.1, 1.4]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color="#2a2018" position={[-0.9, 0.35, 0.7]} scale={[0.7, 0.7, 0.18]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 10]} />
          </ToonMesh>
          <ToonMesh color="#2a2018" position={[0.9, 0.35, 0.7]} scale={[0.7, 0.7, 0.18]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 10]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "cactus" ? (
        <>
          <ToonMesh color="#3a6a40" position={[0, 1.1, 0]} scale={[0.32, 2.2, 0.32]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
          </ToonMesh>
          <ToonMesh color="#3a6a40" position={[0.45, 1.35, 0]} rotation={[0, 0, 1.1]} scale={[0.22, 0.9, 0.22]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "shard" ? (
        <ToonMesh color={lamp} position={[0, 1.8, 0]} rotation={[0.3, 0.4, 0.2]} scale={[0.7, 3.6, 0.35]}>
          <boxGeometry args={[1, 1, 1]} />
        </ToonMesh>
      ) : null}
      {kind === "hut" ? (
        <>
          <ToonMesh color={dark} position={[0, 0.85, 0]} scale={[1.8, 1.7, 1.6]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color="#6a3a1c" position={[0, 1.95, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1.5, 0.7, 1.5]}>
            <coneGeometry args={[0.85, 1, 4]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "tent" ? (
        <ToonMesh color={stone} position={[0, 1.0, 0]} scale={[1.6, 2.0, 1.6]}>
          <coneGeometry args={[0.7, 1, 4]} />
        </ToonMesh>
      ) : null}
      {kind === "stall" ? (
        <>
          <ToonMesh color="#6a4a28" position={[0, 0.7, 0]} scale={[1.8, 0.2, 1.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={dark} position={[-0.8, 1.1, 0]} scale={[0.1, 1.6, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={dark} position={[0.8, 1.1, 0]} scale={[0.1, 1.6, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={lamp} outline={false} position={[0, 1.85, 0]} scale={[1.9, 0.08, 1.2]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "crate" ? (
        <ToonMesh color="#6a5030" position={[0, 0.4, 0]} scale={[0.85, 0.8, 0.85]}>
          <boxGeometry args={[1, 1, 1]} />
        </ToonMesh>
      ) : null}
      {kind === "boulder" ? (
        <ToonMesh color={dark} position={[0, 0.45, 0]} scale={[1.3, 0.9, 1.1]}>
          <dodecahedronGeometry args={[0.55, 0]} />
        </ToonMesh>
      ) : null}
      {kind === "shrine" ? (
        <>
          <ToonMesh color={stone} position={[0, 0.2, 0]} scale={[1.3, 0.4, 1.3]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
          </ToonMesh>
          <ToonMesh color={lamp} outline={false} position={[0, 0.9, 0]} scale={[0.35, 0.9, 0.35]}>
            <octahedronGeometry args={[0.5, 0]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "lamp" ? (
        <>
          <ToonMesh color="#4a3a28" position={[0, 1.3, 0]} scale={[0.1, 2.6, 0.1]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
          </ToonMesh>
          <mesh position={[0, 2.55, 0]}>
            <sphereGeometry args={[0.18, 8, 6]} />
            <meshBasicMaterial color={lamp} />
          </mesh>
        </>
      ) : null}
      {kind === "grave" ? (
        <ToonMesh color={stone} position={[0, 0.55, 0]} scale={[0.55, 1.1, 0.18]}>
          <boxGeometry args={[1, 1, 1]} />
        </ToonMesh>
      ) : null}
      {kind === "bone" ? (
        <ToonMesh color="#e8dcc0" outline={false} position={[0, 0.12, 0]} rotation={[0, 0, 0.4]} scale={[0.7, 0.12, 0.12]}>
          <capsuleGeometry args={[0.5, 1, 3, 6]} />
        </ToonMesh>
      ) : null}
      {kind === "rubble" ? (
        <>
          <ToonMesh color={dark} position={[0, 0.25, 0]} scale={[1.1, 0.5, 0.8]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={stone} position={[0.3, 0.45, 0.1]} rotation={[0.3, 0.4, 0]} scale={[0.5, 0.4, 0.45]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "crystal" ? (
        <ToonMesh color={lamp} outline={false} position={[0, 0.85, 0]} rotation={[0.15, 0.3, 0.1]} scale={[0.35, 1.6, 0.35]}>
          <octahedronGeometry args={[0.5, 0]} />
        </ToonMesh>
      ) : null}
      {kind === "dish" ? (
        <>
          <ToonMesh color={dark} position={[0, 0.7, 0]} scale={[0.18, 1.4, 0.18]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
          </ToonMesh>
          <mesh position={[0, 1.45, 0]} rotation={[0.7, 0, 0]}>
            <circleGeometry args={[0.7, 16]} />
            <meshBasicMaterial color={lamp} side={THREE.DoubleSide} transparent opacity={0.55} />
          </mesh>
        </>
      ) : null}
      {kind === "sign" ? (
        <>
          <ToonMesh color="#3a2a1c" position={[0, 0.9, 0]} scale={[0.1, 1.8, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <mesh position={[0, 1.7, 0.06]}>
            <planeGeometry args={[1.2, 0.7]} />
            <meshBasicMaterial color={lamp} />
          </mesh>
        </>
      ) : null}
      {kind === "fence" ? (
        <>
          <ToonMesh color="#5a4030" position={[-0.7, 0.55, 0]} scale={[0.1, 1.1, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color="#5a4030" position={[0.7, 0.55, 0]} scale={[0.1, 1.1, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color="#6a4a32" position={[0, 0.7, 0]} scale={[1.6, 0.1, 0.08]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
        </>
      ) : null}
      {kind === "fern" ? (
        <ToonMesh color="#3a6a38" outline={false} position={[0, 0.45, 0]} scale={[0.7, 0.9, 0.25]}>
          <coneGeometry args={[0.5, 1, 5]} />
        </ToonMesh>
      ) : null}
    </group>
  );
}

function HubPortal({ color }: { color: string }) {
  return (
    <group position={[0, 0, 0]}>
      <ToonMesh color="#cfc3a8" position={[-1.35, 1.7, 0]} scale={[0.38, 3.4, 0.38]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
      <ToonMesh color="#cfc3a8" position={[1.35, 1.7, 0]} scale={[0.38, 3.4, 0.38]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
      <ToonMesh color="#d8cbb0" position={[0, 3.5, 0]} scale={[3.2, 0.38, 0.5]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
      <mesh position={[0, 1.7, 0]}>
        <planeGeometry args={[2.2, 2.9]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function WeatherField({ weather, lamp }: { weather: string; lamp: string }) {
  const ref = useRef<THREE.Group>(null);
  const n = weather === "clear" ? 0 : 36;
  const pts = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        x: ((i * 47) % 28) - 14,
        y: (i % 7) * 0.7 + 1.2,
        z: ((i * 19) % 28) - 14,
      })),
    [],
  );
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const fall = weather === "rain" || weather === "ash" ? 7 : weather === "grove" ? 1.4 : 3;
    for (const c of g.children) {
      c.position.y -= dt * fall;
      if (weather === "wind" || weather === "drift") c.position.x += dt * 2.4;
      if (c.position.y < 0.1) {
        c.position.y = 6.5;
        c.position.x = ((c.position.x + 20) % 28) - 14;
      }
    }
  });
  if (!n) return null;
  const color = weather === "rain" ? "#9ab0c8" : weather === "ash" ? "#d8c8a8" : weather === "neon" ? lamp : weather === "grove" ? "#c8e070" : lamp;
  return (
    <group ref={ref}>
      {pts.slice(0, n).map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <boxGeometry args={weather === "rain" ? [0.03, 0.28, 0.03] : [0.08, 0.08, 0.08]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function DriftField({ pulse, lamp }: { pulse: number; lamp: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y += dt * 0.12;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i]!;
      c.position.y = 2.4 + Math.sin(pulse + i + g.rotation.y * 4) * 0.45;
    }
  });
  return (
    <group ref={ref}>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 9, 2.4, Math.sin(a) * 9]}>
            <octahedronGeometry args={[0.28, 0]} />
            <meshBasicMaterial color={lamp} />
          </mesh>
        );
      })}
    </group>
  );
}

export function WorldScene({
  worldId,
  theme,
  pulse,
  weather,
  simRef,
}: {
  worldId: WorldId;
  theme: Theme;
  pulse: number;
  weather?: string;
  simRef: MutableRefObject<Sim>;
}) {
  const kit = worldKit(worldId);
  const ramp = useMemo(() => toonRamp("#1a140c", theme.building2, theme.building), [theme.building, theme.building2]);
  const sunPos = useMemo(() => [40, 55, 30] as [number, number, number], []);
  const groundR = 42;
  const wx = weather ?? kit.weather;

  return (
    <>
      <SkyDome theme={theme} />
      <fog attach="fog" args={[theme.fog, 18, theme.fogFar]} />
      <hemisphereLight args={[theme.ambient, "#2a2018", 0.9]} />
      <directionalLight color={theme.sun} intensity={1.25} position={sunPos} />
      <pointLight color={theme.lamp} intensity={1.3} distance={18} position={[0, 3.4, 0]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[groundR, 40]} />
        <meshToonMaterial color={theme.ground} gradientMap={ramp} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[1.6, 2.2, 28]} />
        <meshBasicMaterial color={theme.lamp} transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>

      {kit.landmarks.map((l, i) => (
        <Landmark key={i} kind={l.kind} x={l.x} z={l.z} rot={l.rot} s={l.s} theme={theme} />
      ))}

      <HubPortal color={theme.lamp} />
      <WeatherField weather={wx} lamp={theme.lamp} />
      {worldId === "lattice-crucible" ? <DriftField pulse={pulse} lamp={theme.lamp} /> : null}
      <LifeField worldId={worldId} theme={theme} simRef={simRef} />
    </>
  );
}

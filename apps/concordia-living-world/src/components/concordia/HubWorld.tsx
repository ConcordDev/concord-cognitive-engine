import { useMemo } from "react";
import * as THREE from "three";
import { GATES, RING_RADIUS, COURT_RADIUS, ARENA, WALL_RADIUS, type Theme } from "@/game/content";
import { HUB_LAYOUT } from "@/game/layout";
import { ToonMesh, toonRamp } from "./Toon";

function SkyDome({ theme }: { theme: Theme }) {
  const geo = useMemo(() => new THREE.SphereGeometry(220, 24, 16), []);
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
      fragmentShader: `uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h = clamp(vP.y / 80.0 * 0.5 + 0.45, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, h), 1.0); }`,
    });
  }, [theme.skyTop, theme.skyHorizon]);
  return <mesh geometry={geo} material={mat} />;
}

function plateTex(text: string, tint: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = "rgba(14,12,9,0.78)";
  g.beginPath();
  if (g.roundRect) g.roundRect(12, 20, 488, 88, 18);
  else g.rect(12, 20, 488, 88);
  g.fill();
  g.strokeStyle = tint;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = "#f4ecda";
  g.font = "600 40px Outfit, Segoe UI, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function Gate({
  angle,
  color,
  name,
  active,
}: {
  angle: number;
  color: string;
  name: string;
  active: boolean;
}) {
  const x = Math.cos(angle) * RING_RADIUS;
  const z = Math.sin(angle) * RING_RADIUS;
  const rot = -angle + Math.PI / 2;
  const tex = useMemo(() => plateTex(name, color), [name, color]);
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <ToonMesh color="#cfc3a8" position={[-1.65, 2.2, 0]} scale={[0.58, 4.4, 0.58]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
      <ToonMesh color="#cfc3a8" position={[1.65, 2.2, 0]} scale={[0.58, 4.4, 0.58]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
      <ToonMesh color="#d8cbb0" position={[0, 4.4, 0]} scale={[4.0, 0.52, 0.78]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
      <mesh position={[0, 2.25, 0]}>
        <planeGeometry args={[2.7, 3.7]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={active ? 0.58 : 0.28}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 5.15, 0.12]}>
        <planeGeometry args={[4.4, 1.1]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, 5.15, -0.12]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[4.4, 1.1]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

function Building({
  b,
  theme,
}: {
  b: (typeof HUB_LAYOUT.buildings)[number];
  theme: Theme;
}) {
  const color = b.variant % 2 === 0 ? theme.building : theme.building2;
  const hMul = theme.style === "neon" ? 1.7 : theme.style === "noir" ? 0.7 : theme.style === "arcology" ? 1.4 : 1;
  const wMul = theme.style === "neon" ? 0.72 : theme.style === "noir" ? 1.15 : 1;
  const h = b.h * hMul;
  const ww = b.w * wMul;
  const dd = b.d * wMul;
  const win = theme.style === "neon" ? theme.lamp : theme.style === "noir" ? "#c8a060" : "#8a9aaa";
  return (
    <group position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
      <ToonMesh color={color} position={[0, h / 2, 0]} scale={[ww, h, dd]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
      {theme.style === "neon" ? (
        <mesh position={[0, h * 0.55, dd * 0.51]}>
          <planeGeometry args={[ww * 0.7, h * 0.7]} />
          <meshBasicMaterial color={theme.lamp} transparent opacity={0.38} />
        </mesh>
      ) : (
        <>
          <ToonMesh
            color="#8a7a58"
            outline={false}
            position={[0, h + 0.38, 0]}
            scale={[ww * 1.08, 0.52, dd * 1.08]}
          >
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          {[0, 1, 2].map((row) =>
            [-0.28, 0.28].map((col) => (
              <mesh key={`${row}${col}`} position={[col * ww, 1.35 + row * 1.15, dd * 0.51 + 0.01]}>
                <planeGeometry args={[0.42, 0.52]} />
                <meshBasicMaterial color={win} transparent opacity={0.55} />
              </mesh>
            )),
          )}
          <mesh position={[0, 0.72, dd * 0.51 + 0.01]}>
            <planeGeometry args={[0.55, 1.35]} />
            <meshBasicMaterial color="#3a3024" />
          </mesh>
        </>
      )}
    </group>
  );
}

function Tree({ x, z, s }: { x: number; z: number; s: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <ToonMesh color="#6a4a28" position={[0, 0.75, 0]} scale={[0.32, 1.5, 0.32]}>
        <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
      </ToonMesh>
      <ToonMesh color="#4f6a38" position={[0, 1.95, 0]} scale={[1.7, 1.45, 1.7]}>
        <sphereGeometry args={[0.5, 10, 8]} />
      </ToonMesh>
      <ToonMesh color="#3f5a2c" outline={false} position={[0.45, 1.7, 0.2]} scale={[1.1, 0.9, 1.1]}>
        <sphereGeometry args={[0.5, 8, 6]} />
      </ToonMesh>
    </group>
  );
}

function Lamp({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <ToonMesh color="#5a4a32" position={[0, 1.1, 0]} scale={[0.16, 2.2, 0.16]}>
        <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
      </ToonMesh>
      <mesh position={[0, 2.28, 0]}>
        <sphereGeometry args={[0.22, 8, 6]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function Stall({ x, z, rot, theme }: { x: number; z: number; rot: number; theme: Theme }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <ToonMesh color="#6a4a28" position={[0, 0.55, 0]} scale={[2.2, 1.1, 1.4]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
      <ToonMesh color={theme.building2} position={[0, 1.55, 0]} rotation={[0, 0, 0.12]} scale={[2.5, 0.12, 1.7]}>
        <boxGeometry args={[1, 1, 1]} />
      </ToonMesh>
    </group>
  );
}

export function HubWorld({ theme, pulse }: { theme: Theme; pulse: number }) {
  const ramp = useMemo(() => toonRamp("#2a1e14", "#8a6e48", "#f2e2b8"), []);
  const sunPos = useMemo(() => {
    const el = 0.62;
    const az = 2.4;
    return [Math.cos(az) * 90, Math.sin(el) * 70, Math.sin(az) * 90] as [number, number, number];
  }, []);

  return (
    <>
      <SkyDome theme={theme} />
      <fog attach="fog" args={[theme.fog, 48, theme.fogFar]} />
      <hemisphereLight args={[theme.ambient, "#3a3020", 0.95]} />
      <directionalLight
        color={theme.sun}
        intensity={1.4}
        position={sunPos}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={120}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <mesh position={sunPos}>
        <sphereGeometry args={[4.2, 12, 12]} />
        <meshBasicMaterial color={theme.sun} />
      </mesh>
      <pointLight color={theme.lamp} intensity={1.6} distance={22} position={[0, 3.2, 0]} />
      <pointLight color={theme.lamp} intensity={1.1} distance={16} position={[21, 3, 0]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[WALL_RADIUS + 6, 48]} />
        <meshToonMaterial color={theme.ground} gradientMap={ramp} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[18, 0.03, 0]} receiveShadow>
        <planeGeometry args={[20, 3.4]} />
        <meshToonMaterial color="#7a6c46" gradientMap={ramp} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow>
        <ringGeometry args={[RING_RADIUS - 1.6, RING_RADIUS + 1.6, 64]} />
        <meshToonMaterial color="#7e7048" gradientMap={ramp} side={THREE.DoubleSide} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
        <circleGeometry args={[COURT_RADIUS, 40]} />
        <meshToonMaterial color="#d8c9a4" gradientMap={ramp} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0]}>
        <ringGeometry args={[COURT_RADIUS - 0.55, COURT_RADIUS, 48]} />
        <meshBasicMaterial color="#8a7a58" side={THREE.DoubleSide} />
      </mesh>

      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 + pulse * 0.08;
        return (
          <mesh key={`petal-${i}`} position={[Math.cos(a) * 1.15, 0.22, Math.sin(a) * 1.15]} rotation={[0.4, a, 0]}>
            <sphereGeometry args={[0.22, 8, 6]} />
            <meshBasicMaterial color={i % 2 ? "#c45a6a" : "#e8d080"} />
          </mesh>
        );
      })}

      <ToonMesh color="#cfc3a8" position={[0, 0.5, 0]} scale={[1.8, 0.28, 1.8]}>
        <cylinderGeometry args={[0.5, 0.5, 1, 16]} />
      </ToonMesh>
      <mesh position={[0, 0.95, 0]}>
        <sphereGeometry args={[0.32, 10, 8]} />
        <meshBasicMaterial color="#e8d8a0" />
      </mesh>

      {GATES.map((g) => (
        <Gate
          key={g.id}
          angle={g.angle}
          color={g.color}
          name={g.name}
          active={theme.id !== "concordia-hub" ? g.worldId === theme.id : true}
        />
      ))}

      {HUB_LAYOUT.buildings.map((b, i) => (
        <Building key={i} b={b} theme={theme} />
      ))}
      {HUB_LAYOUT.trees.map((t, i) => (
        <Tree key={i} x={t.x} z={t.z} s={t.s} />
      ))}
      {HUB_LAYOUT.lamps.map((l, i) => (
        <Lamp key={i} x={l.x} z={l.z} color={theme.lamp} />
      ))}
      {HUB_LAYOUT.stalls.map((s, i) => (
        <Stall key={i} x={s.x} z={s.z} rot={s.rot} theme={theme} />
      ))}

      <group position={[ARENA.x, 0, ARENA.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
          <circleGeometry args={[ARENA.r, 28]} />
          <meshToonMaterial color="#c2a878" gradientMap={ramp} />
        </mesh>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return (
            <ToonMesh
              key={i}
              color="#b7a88a"
              position={[Math.cos(a) * ARENA.r, 0.45, Math.sin(a) * ARENA.r]}
              scale={[0.55, 0.9, 0.55]}
            >
              <boxGeometry args={[1, 1, 1]} />
            </ToonMesh>
          );
        })}
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.8, 0]}>
        <ringGeometry args={[WALL_RADIUS - 0.6, WALL_RADIUS + 0.4, 64]} />
        <meshToonMaterial color="#c8bca0" gradientMap={ramp} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <ToonMesh
            key={i}
            color="#d0c4a8"
            position={[Math.cos(a) * WALL_RADIUS, 3.2, Math.sin(a) * WALL_RADIUS]}
            scale={[2.2, 6.4, 2.2]}
          >
            <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
          </ToonMesh>
        );
      })}
    </>
  );
}

'use client';

/**
 * SkyDome3D — a real Three.js celestial dome, the T3-scale feature build
 * this lens's own doc entry had deferred ("full Three.js celestial dome").
 * Renders the EXACT SAME real ephemeris data the existing 2D azimuthal
 * sky chart (`SkyChartWorkbench.tsx#SkyDome`) already fetches from the
 * `astronomy.sky-chart` macro — no new backend call, no invented star
 * positions. The alt/az → 3D projection below is a direct geometric
 * generalization of that component's verified 2D projection (same
 * azimuth reference frame: `a = (az - 90) * DEG2RAD`, North at the same
 * reference direction), just adding the altitude-driven height component
 * onto a hemisphere instead of collapsing everything to a flat disk.
 *
 * Viewed as a real 3D object you can orbit around (like a planetarium
 * dome model), not a first-person "stand inside it" rig — a deliberate,
 * simpler, equally-real scope choice for a first pass.
 */

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';

export interface Sky3DStar {
  name: string;
  magnitude: number;
  altitude: number;
  azimuth: number;
  visible: boolean;
}
export interface Sky3DConstellation {
  name: string;
  segments: [string, string][];
}
export interface Sky3DData {
  sun: { altitude: number; azimuth: number; isDaytime: boolean };
  moon: { altitude: number; azimuth: number; illumination: number; visible: boolean };
  stars: Sky3DStar[];
  constellationLines: Sky3DConstellation[];
}

export const DEG2RAD = Math.PI / 180;
export const DOME_RADIUS = 20;

/** Same azimuth reference frame as the 2D SkyDome's `project()` — North
 * at the same angular reference, altitude 90° (zenith) straight up.
 * Exported for direct unit testing — a wrong sign or axis here would
 * silently misplace every star, so this is the correctness-critical part
 * of the component and the part actually worth pinning (mounting the
 * real @react-three/fiber Canvas tree in jsdom has no real WebGL context
 * to render into, and no existing precedent exists in this codebase for
 * doing so meaningfully). */
export function altAzToVec3(altitude: number, azimuth: number, radius = DOME_RADIUS): THREE.Vector3 {
  const alt = Math.max(0, altitude) * DEG2RAD;
  const az = (azimuth - 90) * DEG2RAD;
  const horizR = Math.cos(alt) * radius;
  return new THREE.Vector3(horizR * Math.cos(az), Math.sin(alt) * radius, horizR * Math.sin(az));
}

function HorizonRing() {
  const points = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let deg = 0; deg <= 360; deg += 5) {
      const v = altAzToVec3(0, deg);
      pts.push([v.x, v.y, v.z]);
    }
    return pts;
  }, []);
  return <Line points={points} color="#3f3f5f" lineWidth={1} />;
}

function CardinalLabels() {
  // Cheap text via small colored markers rather than pulling in @react-three/drei's
  // <Text> (an extra font-loading dependency) for 4 short labels — a real,
  // if minimal, cardinal-direction cue.
  const dirs: [string, number, string][] = [['N', 0, '#f87171'], ['E', 90, '#facc15'], ['S', 180, '#60a5fa'], ['W', 270, '#34d399']];
  return (
    <>
      {dirs.map(([, az, color]) => {
        const v = altAzToVec3(2, az, DOME_RADIUS + 1);
        return <mesh key={az} position={v}><sphereGeometry args={[0.3, 8, 8]} /><meshBasicMaterial color={color} /></mesh>;
      })}
    </>
  );
}

function Stars({ stars }: { stars: Sky3DStar[] }) {
  const visible = stars.filter((s) => s.visible);
  return (
    <>
      {visible.map((s) => {
        const v = altAzToVec3(s.altitude, s.azimuth);
        // Same magnitude->size relationship as the 2D chart (brighter =
        // lower/negative magnitude = larger), just as a 3D sphere radius.
        const size = Math.max(0.08, 0.34 - s.magnitude * 0.07);
        return (
          <mesh key={s.name} position={v}>
            <sphereGeometry args={[size, 6, 6]} />
            <meshBasicMaterial color="#fef9c3" />
          </mesh>
        );
      })}
    </>
  );
}

function ConstellationLines({ stars, constellations }: { stars: Sky3DStar[]; constellations: Sky3DConstellation[] }) {
  const starByName = useMemo(() => new Map(stars.map((s) => [s.name, s])), [stars]);
  const segments = useMemo(() => {
    const out: [THREE.Vector3, THREE.Vector3][] = [];
    for (const c of constellations) {
      for (const [a, b] of c.segments) {
        const sa = starByName.get(a);
        const sb = starByName.get(b);
        if (!sa || !sb || sa.altitude <= 0 || sb.altitude <= 0) continue;
        out.push([altAzToVec3(sa.altitude, sa.azimuth), altAzToVec3(sb.altitude, sb.azimuth)]);
      }
    }
    return out;
  }, [starByName, constellations]);

  return (
    <>
      {segments.map(([a, b], i) => (
        <Line key={i} points={[a, b]} color="#4f46e5" lineWidth={1} transparent opacity={0.55} />
      ))}
    </>
  );
}

function SunMoon({ data }: { data: Sky3DData }) {
  return (
    <>
      {data.sun.altitude > 0 && (
        <mesh position={altAzToVec3(data.sun.altitude, data.sun.azimuth)}>
          <sphereGeometry args={[0.8, 12, 12]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>
      )}
      {data.moon.visible && (
        <mesh position={altAzToVec3(data.moon.altitude, data.moon.azimuth)}>
          <sphereGeometry args={[0.65, 12, 12]} />
          <meshBasicMaterial color="#e4e4e7" />
        </mesh>
      )}
    </>
  );
}

export function SkyDome3D({ data, showLines }: { data: Sky3DData; showLines: boolean }) {
  const [hint, setHint] = useState(true);

  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-[#05050a]" style={{ height: 380 }}>
      <Canvas camera={{ position: [0, 22, 34], fov: 55 }} onPointerDown={() => setHint(false)}>
        <color attach="background" args={['#05050a']} />
        <ambientLight intensity={0.6} />
        <HorizonRing />
        <CardinalLabels />
        <Stars stars={data.stars} />
        {showLines && <ConstellationLines stars={data.stars} constellations={data.constellationLines} />}
        <SunMoon data={data} />
        <OrbitControls
          enablePan={false}
          minDistance={15}
          maxDistance={60}
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />
      </Canvas>
      {hint && (
        <p className="pointer-events-none absolute bottom-1.5 left-1.5 text-[10px] text-zinc-500">
          Drag to orbit · scroll to zoom
        </p>
      )}
    </div>
  );
}

export default SkyDome3D;

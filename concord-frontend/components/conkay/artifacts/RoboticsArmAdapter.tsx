'use client';

// concord-frontend/components/conkay/artifacts/RoboticsArmAdapter.tsx
//
// Unit F9 (K5) — the `robotics-arm` adapter. `robotics.forwardKinematics` /
// `robotics.inverseKinematics` return a REAL solved 2D planar joint chain
// (server/domains/robotics.js); the normalizer lifted each joint to z=0. Here we
// render that STATIC solved pose in real interactive 3D: a polyline through the
// joints + a sphere at every joint + a distinct end-effector marker + (for IK) a
// wireframe target marker showing the goal the solver was aiming at. Every number
// is the solver's own output — nothing is re-simulated and nothing is invented.
//
// It is a SOLVED POSE, not an animation — there is deliberately no useFrame / no
// timer here. Replaying the CCD iterations is future work; showing the final pose
// truthfully is the honest thing to render now. OrbitControls gives real orbit.

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import type { ConkayRoboticsArtifact, ConkayVec3 } from '@/lib/conkay/artifact-kinds';

type Triple = [number, number, number];
const asTriple = (p: ConkayVec3): Triple => [p.x, p.y, p.z];

export function RoboticsArmAdapter({ artifact }: { artifact: ConkayRoboticsArtifact }) {
  // Frame the camera to fit the real chain (+ the IK target, when present) — the
  // macro's link lengths default to ~100mm, so coordinates can be large; derive
  // a bounding sphere from the actual points rather than guessing a scale.
  const { points3, endEffector3, target3, center, camDist } = useMemo(() => {
    const points3 = artifact.points.map(asTriple);
    const endEffector3 = asTriple(artifact.endEffector);
    const target3 = artifact.target ? asTriple(artifact.target) : null;
    const all = target3 ? [...points3, target3] : points3;
    const c: Triple = [0, 0, 0];
    for (const p of all) {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    c[0] /= all.length;
    c[1] /= all.length;
    c[2] /= all.length;
    let extent = 0;
    for (const p of all) {
      extent = Math.max(extent, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    }
    const camDist = Math.max(extent * 2.6, 1);
    return { points3, endEffector3, target3, center: c, camDist };
  }, [artifact.points, artifact.endEffector, artifact.target]);

  // Marker radius scales with the chain size so joints read at any reach.
  const jointR = Math.max(camDist * 0.012, 0.02);

  return (
    <div data-testid="ck-adapter-robotics-arm" className="relative h-[340px] w-full overflow-hidden rounded-lg bg-black">
      <Canvas camera={{ position: [center[0], center[1], center[2] + camDist], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[camDist, camDist, camDist]} intensity={0.8} />

        {/* Link polyline through the solved joints. */}
        <Line points={points3} color="#38bdf8" lineWidth={3} />

        {/* A sphere at every joint. */}
        {points3.map((p, i) => (
          <mesh key={`joint_${i}`} position={p}>
            <sphereGeometry args={[jointR, 16, 12]} />
            <meshStandardMaterial color={i === 0 ? '#a3a3a3' : '#0ea5e9'} roughness={0.5} metalness={0.2} />
          </mesh>
        ))}

        {/* Distinct end-effector marker. */}
        <mesh position={endEffector3}>
          <sphereGeometry args={[jointR * 1.7, 20, 16]} />
          <meshStandardMaterial color="#f5d90a" emissive="#f5d90a" emissiveIntensity={0.35} roughness={0.4} />
        </mesh>

        {/* IK target — a wireframe marker at the GOAL. Kept visually distinct from
            the solved end-effector: when the target is unreachable the two won't
            coincide, which is the honest reading of the solve. */}
        {target3 && (
          <mesh position={target3}>
            <sphereGeometry args={[jointR * 1.9, 16, 12]} />
            <meshBasicMaterial color="#f472b6" wireframe />
          </mesh>
        )}

        <OrbitControls target={center} enablePan={false} />
      </Canvas>

      {/* Honest facts, straight from the solver — labels, not fabricated telemetry. */}
      <div
        data-testid="ck-adapter-robotics-facts"
        className="pointer-events-none absolute left-2 top-2 flex flex-col gap-0.5 rounded-md bg-black/50 px-2 py-1 text-[10px] text-cyan-200"
      >
        <span>{artifact.solver} · {artifact.dof} DOF</span>
        {artifact.maxReach != null && <span>reach {artifact.maxReach}</span>}
        {artifact.solver === 'IK' && (
          <span className={artifact.converged ? 'text-emerald-300' : 'text-amber-300'}>
            {artifact.converged ? 'converged' : 'not converged'}
            {artifact.iterations != null ? ` · ${artifact.iterations} iter` : ''}
            {artifact.error != null ? ` · err ${artifact.error}` : ''}
          </span>
        )}
        {artifact.solver === 'IK' && artifact.reachable === false && (
          <span className="text-rose-300">target out of reach</span>
        )}
      </div>
    </div>
  );
}

export default RoboticsArmAdapter;

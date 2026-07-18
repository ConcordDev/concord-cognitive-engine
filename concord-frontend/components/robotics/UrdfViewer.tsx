'use client';

/**
 * UrdfViewer — a real URDF (Unified Robot Description Format) 3D viewer.
 *
 * Honesty contract:
 *  - A robot only ever appears here from a user-supplied URDF document (or
 *    the explicitly-labeled bundled example). There is no synthetic "demo
 *    robot" fallback — an empty/invalid input renders an honest prompt/
 *    error state, never a fabricated model.
 *  - Joints move by REAL forward kinematics (`computeUrdfFk`, real matrix
 *    composition over the parsed joint tree) driven by the slider values —
 *    never a canned/faked animation curve.
 *  - The clearance panel runs a REAL geometric bounding-volume pass
 *    (`computeGeometricClearance`) and is labeled "geometric clearance
 *    (bounding-volume approximation)" everywhere it appears. It is
 *    explicitly NOT a physics/dynamics solve — no physics engine
 *    (cannon/rapier/etc.) is used anywhere in this component. Full
 *    rigid-body dynamics is a separate, larger, deferred capability.
 *  - <mesh> geometry references are parsed (filename/scale) but this build
 *    has no mesh loader, so they render as a labeled wireframe placeholder
 *    and are honestly excluded from the clearance check (their real
 *    extents are unknown — never fabricated).
 */

import { useMemo, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { Box, Boxes, AlertTriangle, RotateCcw, FileCode2 } from 'lucide-react';
import { parseUrdf } from '@/lib/robotics/urdf-parser';
import { computeUrdfFk, type Pose } from '@/lib/robotics/urdf-fk';
import { computeGeometricClearance, type ClearanceReport } from '@/lib/robotics/urdf-clearance';
import type { UrdfJoint, UrdfLink, UrdfRobot, UrdfVisual } from '@/lib/robotics/urdf-types';

const EXAMPLE_URDF = `<?xml version="1.0"?>
<robot name="example_2dof_arm">
  <link name="base_link">
    <visual>
      <geometry><cylinder radius="0.08" length="0.06"/></geometry>
      <material name="base"><color rgba="0.35 0.38 0.42 1"/></material>
    </visual>
  </link>
  <link name="upper_arm">
    <visual>
      <origin xyz="0.2 0 0" rpy="0 0 0"/>
      <geometry><box size="0.4 0.06 0.06"/></geometry>
      <material name="arm"><color rgba="0.13 0.6 0.75 1"/></material>
    </visual>
  </link>
  <link name="forearm">
    <visual>
      <origin xyz="0.15 0 0" rpy="0 0 0"/>
      <geometry><box size="0.3 0.05 0.05"/></geometry>
      <material name="arm2"><color rgba="0.9 0.6 0.15 1"/></material>
    </visual>
  </link>
  <link name="end_effector">
    <visual>
      <geometry><sphere radius="0.04"/></geometry>
      <material name="ee"><color rgba="0.9 0.2 0.25 1"/></material>
    </visual>
  </link>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/>
    <child link="upper_arm"/>
    <origin xyz="0 0 0.05" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="10" velocity="1"/>
  </joint>
  <joint name="elbow" type="revolute">
    <parent link="upper_arm"/>
    <child link="forearm"/>
    <origin xyz="0.4 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-2.5" upper="2.5" effort="8" velocity="1"/>
  </joint>
  <joint name="wrist" type="prismatic">
    <parent link="forearm"/>
    <child link="end_effector"/>
    <origin xyz="0.3 0 0" rpy="0 0 0"/>
    <axis xyz="1 0 0"/>
    <limit lower="0" upper="0.15" effort="4" velocity="0.5"/>
  </joint>
</robot>
`;

function poseToMatrix4(pose: Pose): THREE.Matrix4 {
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = pose.rotation;
  const [px, py, pz] = pose.position;
  // Matrix4.set() takes ROW-MAJOR arguments regardless of three's internal
  // column-major storage — this is a direct, exact transcription of our
  // Pose{position, rotation} into three's transform, not a re-derivation.
  return new THREE.Matrix4().set(
    r0, r1, r2, px,
    r3, r4, r5, py,
    r6, r7, r8, pz,
    0, 0, 0, 1
  );
}

function colorForVisual(v: UrdfVisual, flagged: boolean): string {
  if (flagged) return '#ef4444';
  if (v.color) {
    const [r, g, b] = v.color;
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }
  return '#7dd3fc';
}

/** One visual primitive, positioned at linkPose * visual.origin. */
function VisualMesh({ link, visual, linkPose, flagged }: { link: UrdfLink; visual: UrdfVisual; linkPose: Pose; flagged: boolean }) {
  const matrix = useMemo(() => {
    // Compose linkPose with the visual's own origin the same way
    // urdf-clearance.ts does, so what's rendered matches what's measured.
    const originRot = new THREE.Matrix4();
    const [rx, ry, rz] = visual.origin.rpy;
    originRot.makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'ZYX'));
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...visual.origin.xyz),
      new THREE.Quaternion().setFromRotationMatrix(originRot),
      new THREE.Vector3(1, 1, 1)
    );
    return poseToMatrix4(linkPose).multiply(local);
  }, [linkPose, visual]);

  if (!visual.geometry) return null;
  const color = colorForVisual(visual, flagged);
  const opacity = flagged ? 0.85 : 1;

  if (visual.geometry.kind === 'mesh') {
    return (
      <group matrix={matrix} matrixAutoUpdate={false}>
        <mesh>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshBasicMaterial color="#a1a1aa" wireframe />
        </mesh>
        <Html center distanceFactor={3} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <span className="text-[9px] px-1 py-0.5 rounded bg-black/70 text-amber-300 border border-amber-500/30">
            mesh: {visual.geometry.filename.split('/').pop() || visual.geometry.filename || '(unnamed)'} — not rendered
          </span>
        </Html>
      </group>
    );
  }

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      {visual.geometry.kind === 'box' && (
        <mesh>
          <boxGeometry args={visual.geometry.size} />
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.15} transparent opacity={opacity} />
        </mesh>
      )}
      {visual.geometry.kind === 'sphere' && (
        <mesh>
          <sphereGeometry args={[visual.geometry.radius, 24, 24]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} transparent opacity={opacity} />
        </mesh>
      )}
      {visual.geometry.kind === 'cylinder' && (
        // three's CylinderGeometry stands along local Y; URDF's cylinder axis
        // is local Z (the same convention urdf-clearance.ts uses for its
        // bounding box), so rotate -90deg about X to align them.
        <group rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[visual.geometry.radius, visual.geometry.radius, visual.geometry.length, 20]} />
            <meshStandardMaterial color={color} roughness={0.45} metalness={0.15} transparent opacity={opacity} />
          </mesh>
        </group>
      )}
      <axesHelper args={[0.05]} />
      {link.name === link.name /* keep link referenced for future per-link decorations */ && null}
    </group>
  );
}

function RobotScene({
  robot,
  poses,
  flaggedLinks,
}: {
  robot: UrdfRobot;
  poses: Map<string, Pose>;
  flaggedLinks: Set<string>;
}) {
  return (
    <group>
      {robot.links.map((link) => {
        const pose = poses.get(link.name);
        if (!pose) return null;
        const flagged = flaggedLinks.has(link.name);
        return (
          <group key={link.name}>
            {link.visuals.length === 0 ? (
              <group matrix={poseToMatrix4(pose)} matrixAutoUpdate={false}>
                <mesh>
                  <sphereGeometry args={[0.015, 8, 8]} />
                  <meshBasicMaterial color={flagged ? '#ef4444' : '#52525b'} />
                </mesh>
              </group>
            ) : (
              link.visuals.map((v, i) => (
                <VisualMesh key={i} link={link} visual={v} linkPose={pose} flagged={flagged} />
              ))
            )}
          </group>
        );
      })}
    </group>
  );
}

function sliderRangeFor(joint: UrdfJoint): [number, number] {
  if (joint.limit) return [joint.limit.lower, joint.limit.upper];
  // `continuous` joints are unlimited by spec; a full-turn slider is an
  // honest UI convenience, not a claim about the joint's real limit.
  return [-Math.PI, Math.PI];
}

export function UrdfViewer() {
  const [urdfText, setUrdfText] = useState('');
  const [jointValues, setJointValues] = useState<Record<string, number>>({});
  const [ignoreAdjacent, setIgnoreAdjacent] = useState(true);

  const parsed = useMemo(() => (urdfText.trim() ? parseUrdf(urdfText) : null), [urdfText]);

  const loadExample = useCallback(() => {
    setUrdfText(EXAMPLE_URDF);
    setJointValues({});
  }, []);

  const robot = parsed && parsed.ok ? parsed.robot : null;

  const movableJoints = useMemo(
    () => (robot ? robot.joints.filter((j) => j.type === 'revolute' || j.type === 'continuous' || j.type === 'prismatic') : []),
    [robot]
  );

  const poses = useMemo(() => (robot ? computeUrdfFk(robot, jointValues) : new Map<string, Pose>()), [robot, jointValues]);

  const clearance: ClearanceReport | null = useMemo(
    () => (robot ? computeGeometricClearance(robot, poses, { ignoreAdjacent }) : null),
    [robot, poses, ignoreAdjacent]
  );

  const flaggedLinks = useMemo(() => {
    const s = new Set<string>();
    if (!clearance) return s;
    for (const p of clearance.pairs) if (p.intersects) { s.add(p.linkA); s.add(p.linkB); }
    for (const g of clearance.groundContacts) s.add(g.link);
    return s;
  }, [clearance]);

  const resetJoints = useCallback(() => setJointValues({}), []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Boxes className="w-4 h-4 text-neon-cyan" /> URDF Viewer — 3D Robot Model
        </h3>
        <div className="flex gap-1.5">
          <button onClick={loadExample}
            className="px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 bg-white/5 text-gray-300 hover:bg-white/10">
            <FileCode2 className="w-3 h-3" /> Load example URDF
          </button>
          {movableJoints.length > 0 && (
            <button onClick={resetJoints}
              className="px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 bg-white/5 text-gray-300 hover:bg-white/10">
              <RotateCcw className="w-3 h-3" /> Reset joints
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        {/* Left: URDF input + 3D canvas */}
        <div className="space-y-3">
          <textarea
            value={urdfText}
            onChange={(e) => { setUrdfText(e.target.value); setJointValues({}); }}
            placeholder={'Paste a URDF <robot> XML document here — no robot renders until you supply one. Or click "Load example URDF" above.'}
            spellCheck={false}
            className="w-full h-28 rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[11px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-neon-cyan/50"
          />

          {!urdfText.trim() && (
            <div className="panel p-6 text-center text-sm text-gray-400 flex flex-col items-center gap-2">
              <Box className="w-8 h-8 text-gray-600" />
              No URDF loaded. A real robot needs a real URDF document — this viewer never invents one. Paste your own above, or load the labeled example.
            </div>
          )}

          {urdfText.trim() && parsed && !parsed.ok && (
            <div className="panel p-3 text-sm text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Could not parse this URDF: {parsed.error}</span>
            </div>
          )}

          {robot && (
            <>
              {parsed && parsed.ok && parsed.warnings.length > 0 && (
                <div className="panel p-2 text-[11px] text-amber-300/90 space-y-0.5">
                  {parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
              <div className="panel p-2 bg-black/40 h-96 overflow-hidden rounded-lg">
                <Canvas camera={{ fov: 50, near: 0.01, far: 100, position: [0.9, 0.7, 1.1] }}>
                  <ambientLight intensity={0.7} />
                  <directionalLight position={[3, 4, 2]} intensity={0.9} />
                  <Grid args={[4, 4]} cellColor="#27272a" sectionColor="#3f3f46" position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} infiniteGrid fadeDistance={6} />
                  <RobotScene robot={robot} poses={poses} flaggedLinks={flaggedLinks} />
                  <OrbitControls />
                </Canvas>
              </div>
              <p className="text-[11px] text-gray-500">
                {robot.links.length} links · {robot.joints.length} joints · Z-up, meters. Grid = ground plane (z=0).
                Red = a link flagged by the geometric clearance check below.
              </p>
            </>
          )}
        </div>

        {/* Right: joint sliders + clearance panel */}
        <div className="space-y-3">
          {robot && movableJoints.length > 0 && (
            <div className="panel p-3">
              <span className="text-xs text-gray-400 uppercase tracking-wide">Joints ({movableJoints.length})</span>
              <div className="space-y-2 mt-2 max-h-56 overflow-y-auto pr-1">
                {movableJoints.map((j) => {
                  const [lo, hi] = sliderRangeFor(j);
                  const v = jointValues[j.name] ?? 0;
                  const unit = j.type === 'prismatic' ? 'm' : '°';
                  const display = j.type === 'prismatic' ? v.toFixed(3) : (v * 180 / Math.PI).toFixed(1);
                  return (
                    <div key={j.name} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span className="font-mono">{j.name}</span>
                        <span className="font-mono">{display}{unit}</span>
                      </div>
                      <input type="range" min={lo} max={hi} step={(hi - lo) / 200 || 0.01} value={v}
                        onChange={(e) => setJointValues((prev) => ({ ...prev, [j.name]: parseFloat(e.target.value) }))}
                        className="w-full accent-cyan-400" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {clearance && (
            <div className="panel p-3 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 uppercase tracking-wide text-[11px]">Geometric clearance</span>
                <label className="flex items-center gap-1 text-[10px] text-gray-500">
                  <input type="checkbox" checked={ignoreAdjacent} onChange={(e) => setIgnoreAdjacent(e.target.checked)} />
                  ignore joint-adjacent pairs
                </label>
              </div>
              <p className="text-[10px] text-gray-500 leading-snug">
                Bounding-volume approximation, not a physics/dynamics solve — a real AABB overlap test over the
                FK-posed link geometry. No collision-response engine is used; a false "clear" from a tight-fitting
                rotated shape is possible (the box superset is conservative), a false "intersect" is not.
              </p>

              <div className="flex items-center justify-between">
                <span className="text-gray-400">Intersecting pairs</span>
                <span className={clearance.intersectingPairCount > 0 ? 'text-red-400 font-mono' : 'text-green-400 font-mono'}>
                  {clearance.intersectingPairCount} / {clearance.pairs.length}
                </span>
              </div>
              {clearance.pairs.filter((p) => p.intersects).map((p, i) => (
                <div key={i} className="text-red-300 font-mono text-[10px]">⚠ {p.linkA} ↔ {p.linkB}</div>
              ))}

              <div className="flex items-center justify-between">
                <span className="text-gray-400">Ground contacts</span>
                <span className={clearance.groundContacts.length > 0 ? 'text-red-400 font-mono' : 'text-green-400 font-mono'}>
                  {clearance.groundContacts.length}
                </span>
              </div>
              {clearance.groundContacts.map((g, i) => (
                <div key={i} className="text-red-300 font-mono text-[10px]">⚠ {g.link} penetrates {g.penetration.toFixed(3)}m</div>
              ))}

              {clearance.uncheckedLinks.length > 0 && (
                <div className="pt-1 border-t border-white/10">
                  <span className="text-gray-500 text-[10px]">Not checked (mesh geometry, extents unknown): {clearance.uncheckedLinks.join(', ')}</span>
                </div>
              )}
            </div>
          )}

          <div className="panel p-2 text-[10px] text-gray-500 leading-snug">
            Full rigid-body physics/collision <em>response</em> (mass, contact forces, dynamics) needs a physics
            engine and is a separate, deferred capability — not built here by design.
          </div>
        </div>
      </div>
    </div>
  );
}

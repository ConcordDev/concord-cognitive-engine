// concord-frontend/lib/robotics/urdf-types.ts
//
// Shared type shapes for the URDF (Unified Robot Description Format) viewer.
// URDF is a real, standard XML format used by ROS/Gazebo/rviz — these types
// mirror the subset this viewer honestly supports: rigid links with visual
// primitives (box/cylinder/sphere) or a named-but-unrendered mesh reference,
// and single-scalar joints (revolute/continuous/prismatic/fixed). Multi-DOF
// joint types (floating, planar) are accepted for parsing but their extra
// degrees of freedom are not driven by this viewer — see urdf-fk.ts.

export type Vec3 = [number, number, number];

export interface UrdfOrigin {
  xyz: Vec3;
  /** Roll, pitch, yaw in radians — URDF's fixed-axis (extrinsic XYZ) convention. */
  rpy: Vec3;
}

export type UrdfGeometry =
  | { kind: 'box'; size: Vec3 }
  | { kind: 'cylinder'; radius: number; length: number }
  | { kind: 'sphere'; radius: number }
  // A mesh reference names an external file this build has no loader for.
  // Never fabricate its extents — the viewer renders a labeled placeholder
  // and the clearance check honestly excludes it (see urdf-clearance.ts).
  | { kind: 'mesh'; filename: string; scale: Vec3 };

export interface UrdfVisual {
  name?: string;
  origin: UrdfOrigin;
  geometry: UrdfGeometry | null;
  color?: [number, number, number, number];
}

export interface UrdfLink {
  name: string;
  visuals: UrdfVisual[];
}

export type UrdfJointType = 'revolute' | 'continuous' | 'prismatic' | 'fixed' | 'floating' | 'planar';

export interface UrdfJointLimit {
  lower: number;
  upper: number;
  effort: number;
  velocity: number;
}

export interface UrdfJoint {
  name: string;
  type: UrdfJointType;
  parent: string;
  child: string;
  origin: UrdfOrigin;
  axis: Vec3;
  limit: UrdfJointLimit | null;
}

export interface UrdfRobot {
  name: string;
  links: UrdfLink[];
  joints: UrdfJoint[];
}

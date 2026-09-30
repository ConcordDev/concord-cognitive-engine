'use client';

export interface Node3D {
  id: string;
  x: number;
  y: number;
  z: number;
}
export interface Member {
  id: string;
  nodeI: string;
  nodeJ: string;
  area: number;
  momentI: number;
  elasticModulus: number;
  allowableStress?: number;
  material?: string;
}
export interface Load {
  nodeId: string;
  Fx?: number;
  Fy?: number;
  Fz?: number;
  Mx?: number;
  My?: number;
  Mz?: number;
}
export interface Support {
  nodeId: string;
  type: 'fixed' | 'pinned' | 'roller';
  fixedDOF?: string[];
}
export interface FEAModel {
  nodes: Node3D[];
  members: Member[];
  loads: Load[];
  supports: Support[];
}

export const MATERIALS: Record<string, { E: number; allowable: number; density: number; label: string }> = {
  'A36 Steel': { E: 29e6, allowable: 21600, density: 0.284, label: 'A36 Steel (36 ksi)' },
  'A992 Steel': { E: 29e6, allowable: 30000, density: 0.284, label: 'A992 Steel (50 ksi)' },
  '6061-T6 Aluminum': { E: 10e6, allowable: 19000, density: 0.098, label: '6061-T6 Aluminum' },
  'Grade 60 Rebar': { E: 29e6, allowable: 40000, density: 0.284, label: 'Grade 60 Rebar' },
  '3000 psi Concrete': { E: 3122019, allowable: 1350, density: 0.087, label: '3000 psi Concrete' },
  'Douglas Fir': { E: 1.9e6, allowable: 1500, density: 0.019, label: 'Douglas Fir (lumber)' },
};

export interface LibMaterial {
  id: string;
  label: string;
  category: string;
  E: number;
  yield: number;
  ultimate: number;
  density: number;
  poisson: number;
  cte: number;
  thermalK: number;
  costPerKg: number;
}

export interface SavedLoadCase {
  id: string;
  name: string;
  loads: Load[];
  supports: Support[];
  gravity: boolean;
  note: string;
  updatedAt: string;
}

export type EngView =
  | 'geometry'
  | 'model'
  | 'loads'
  | 'materials'
  | 'analysis'
  | 'bom'
  | 'tolerance'
  | 'calcs'
  | 'results'
  | 'feed'
  | 'actions';

export const DEFAULT_FEA_MODEL: FEAModel = {
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0 },
    { id: 'N2', x: 0, y: 12, z: 0 },
    { id: 'N3', x: 20, y: 12, z: 0 },
    { id: 'N4', x: 20, y: 0, z: 0 },
  ],
  members: [
    { id: 'M1', nodeI: 'N1', nodeJ: 'N2', area: 8.25, momentI: 82.8, elasticModulus: 29e6, allowableStress: 21600, material: 'A36 Steel' },
    { id: 'M2', nodeI: 'N2', nodeJ: 'N3', area: 11.8, momentI: 171, elasticModulus: 29e6, allowableStress: 21600, material: 'A36 Steel' },
    { id: 'M3', nodeI: 'N4', nodeJ: 'N3', area: 8.25, momentI: 82.8, elasticModulus: 29e6, allowableStress: 21600, material: 'A36 Steel' },
  ],
  loads: [
    { nodeId: 'N2', Fy: -10000 },
    { nodeId: 'N3', Fy: -10000 },
  ],
  supports: [
    { nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
    { nodeId: 'N4', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
  ],
};

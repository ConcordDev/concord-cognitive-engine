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
  | 'physics'
  | 'results'
  | 'feed'
  | 'actions';

/**
 * The model starts EMPTY. It used to be pre-filled with a sample portal
 * frame, so "Run FEA" solved a structure the user never built and the
 * result looked like theirs. Now the user adds their own nodes, members,
 * supports and loads before anything is solved.
 */
export const EMPTY_FEA_MODEL: FEAModel = {
  nodes: [],
  members: [],
  loads: [],
  supports: [],
};

/** Why a model can't be solved yet, or null when it can. */
export function feaModelGap(model: FEAModel): string | null {
  if (model.nodes.length < 2) return 'add at least two nodes';
  if (model.members.length < 1) return 'add a member between two nodes';
  if (model.supports.length < 1) return 'fix at least one support';
  if (model.loads.length < 1) return 'add a load';
  return null;
}

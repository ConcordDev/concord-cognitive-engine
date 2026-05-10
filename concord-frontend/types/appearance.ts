// concord-frontend/types/appearance.ts
//
// Sprint C / Track C3 — single source of truth for the AppearanceConfig
// union shared by AvatarSystem3D, WalkerNpcInjector, ProcgenSettlementNpcs,
// and the aquatic-mesh-builder.

import type { AquaticTopology } from '../lib/concordia/aquatic-mesh-builder';

export type HumanoidBodyType = 'slim' | 'average' | 'stocky' | 'tall' | 'legend';
export type Topology = 'humanoid' | AquaticTopology;

export interface AppearanceConfig {
  bodyType: HumanoidBodyType;
  skinTone: number;
  hairStyle: number;
  hairColor: number;
  outfit: number;
  faceShape: number;
  /** Sprint C / C3 — when set, AvatarSystem3D dispatches to the aquatic
   *  mesh builder. Default omitted = humanoid. */
  topology?: Topology;
  /** Sprint C / C2 — bioluminescent flag for aquatic creatures. */
  bioluminescent?: boolean;
}

'use client';

export interface Kingdom {
  id: string;
  world_id: string;
  name: string;
  /** Opaque public id — never a raw account uuid. */
  ruler_id: string | null;
  ruler_display_name: string | null;
  ruler_faction_id: string | null;
  claim_strength: number;
  founded_at: number;
  region_polygon: number[][];
}

export interface Decree {
  id: string;
  decree_kind: string;
  parameters_json: string;
  alignment_score: number;
  activation_state: string;
  expires_at: number | null;
}

export interface Resident {
  /** Opaque public id — never a raw account uuid. */
  id: string;
  display_name: string;
  role: string;
  joined_at: number;
}

export interface DecreeKindMeta {
  refusalKind: string;
  description: string;
  affinityGenres: string[];
}

export type KingdomView = 'list' | 'detail' | 'create' | 'history' | 'realm' | 'dynasty';

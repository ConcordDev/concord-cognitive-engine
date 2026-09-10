'use client';

export interface Kingdom {
  id: string;
  world_id: string;
  name: string;
  ruler_user_id: string | null;
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
  user_id: string;
  role: string;
  joined_at: number;
}

export interface DecreeKindMeta {
  refusalKind: string;
  description: string;
  affinityGenres: string[];
}

export type KingdomView = 'list' | 'detail' | 'create' | 'history' | 'realm' | 'dynasty';

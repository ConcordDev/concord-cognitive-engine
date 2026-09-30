export interface Courtship {
  partner_kind: string;
  partner_id: string;
  affinity: number;
  status: string;
  started_at?: number;
  last_interaction?: number;
}

export interface Marriage {
  id: string;
  partner_kind: string;
  partner_id: string;
  married_at: number;
  status?: string;
  dissolved_at?: number | null;
  dissolved_reason?: string | null;
}

/** Matches the real player_children columns (migration 206). */
export interface Child {
  id: string;
  parent_user_id: string;
  other_parent_id?: string;
  name: string;
  maturity: string;
  born_at: number;
}

export type LoadState = 'loading' | 'error' | 'ready';

export const DEFAULT_ENGAGE_THRESHOLD = 0.7;
export const DEFAULT_MARRY_THRESHOLD = 0.85;

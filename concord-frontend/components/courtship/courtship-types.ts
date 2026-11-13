export interface Courtship {
  partner_kind: string;
  partner_id: string;
  partner_name?: string | null;
  partner_handle?: string | null;
  affinity: number;
  status: string;
  started_at?: number;
  last_interaction?: number;
}

export interface Marriage {
  id: string;
  partner_kind: string;
  partner_id: string;
  partner_name?: string | null;
  partner_handle?: string | null;
  married_at: number;
  status?: string;
  dissolved_at?: number | null;
  dissolved_reason?: string | null;
}

/**
 * FIX-courtship-003: how a partner is named on screen. The server
 * resolves a player's public name (partner_name); an NPC's id is its
 * world-visible name; a player who does not resolve gets a neutral
 * label — never the raw account id, never a bare "player:".
 */
export function partnerLabel(row: {
  partner_kind?: string;
  partner_id?: string | null;
  partner_name?: string | null;
  partner_handle?: string | null;
}): string {
  if (row.partner_name && row.partner_name.trim()) return row.partner_name;
  if (row.partner_handle && row.partner_handle.trim()) return `@${row.partner_handle}`;
  if (row.partner_kind && row.partner_kind !== 'player' && row.partner_id) return String(row.partner_id);
  return 'A Concord member';
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

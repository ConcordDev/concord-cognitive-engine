export interface Courtship {
  partner_kind: string;
  partner_id: string;
  /** Resolved NPC display name (server-side, world_npcs); null for player partners and unresolved NPCs. */
  partnerName?: string | null;
  affinity: number;
  status: string;
  started_at?: number;
  last_interaction?: number;
}

export interface Marriage {
  id: string;
  partner_kind: string;
  partner_id: string;
  /** Resolved NPC display name (server-side, world_npcs); null for player partners and unresolved NPCs. */
  partnerName?: string | null;
  married_at: number;
  status?: string;
  dissolved_at?: number | null;
  dissolved_reason?: string | null;
}

/** An in-flight pregnancy as the server's courtship.pregnancies read returns it. */
export interface Pregnancy {
  pregnancyId: string;
  partnerKind: string;
  partnerId: string;
  partnerName?: string | null;
  dueAt: number; // unix seconds, from the engine's conceive
  conceivedAt: number; // unix seconds, from the player_pregnancies row
}

/** A pending proposal notice (courtship.notices) — carries the opaque proposal id only. */
export interface CourtshipNotice {
  id: string;
  kind: string;
  proposalId?: string;
  created_at?: number;
}

/** An NPC spouse wed to the caller (courtship.spouses), named server-side. */
export interface Spouse {
  npcId: string;
  partnerName?: string | null;
}

/**
 * The label a surface shows for a partner (courtship full build, S2): the
 * resolved NPC name when the server knows one; a neutral word otherwise.
 * A raw account/NPC id is NEVER rendered as if it were a name.
 */
export function partnerLabel(kind: string, name: string | null | undefined): string {
  if (name) return name;
  return kind === 'npc' ? 'An NPC of Concordia' : 'Another player';
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

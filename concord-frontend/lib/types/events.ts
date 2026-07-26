/**
 * Typed payloads for every socket event the backend emits.
 * Import these to get type safety when subscribing to events.
 */

import type { DTU } from './dtu';
import type { AttentionAllocation, FocusOverride, SystemAlert, Promotion } from './system';

// ── DTU Lifecycle ───────────────────────────────────────────────

export interface DTUCreatedPayload {
  id: string;
  tier: string;
  domain?: string;
  source?: string;
  summary?: string;
}

export interface DTUUpdatedPayload {
  id: string;
  changes: Partial<DTU>;
}

export interface DTUDeletedPayload {
  id: string;
}

export interface DTUPromotedPayload {
  id: string;
  fromTier: string;
  toTier: string;
}

// ── Entity Lifecycle ────────────────────────────────────────────

export interface EntityDeathPayload {
  entityId: string;
  name: string;
  cause: string;
  age: number;
}

export interface BodyInstantiatedPayload {
  entityId: string;
  species: string;
  name: string;
}

export interface BodyDestroyedPayload {
  entityId: string;
  name: string;
  reason: string;
}

// ── Pain / Qualia ───────────────────────────────────────────────

export interface PainRecordedPayload {
  entityId: string;
  source: string;
  intensity: number;
  domain: string;
}

export interface PainProcessedPayload {
  entityId: string;
  painId: string;
  action: string;
}

export interface WoundCreatedPayload {
  entityId: string;
  woundId: string;
  source: string;
  severity: number;
}

export interface WoundHealedPayload {
  entityId: string;
  woundId: string;
}

export interface AffectPainSignalPayload {
  entityId: string;
  painLevel: number;
  mood: string;
}

// ── Repair Cortex ───────────────────────────────────────────────

export interface RepairDTULoggedPayload {
  dtuId: string;
  error: string;
  context: string;
}

// ── Meta-derivation ─────────────────────────────────────────────

export interface MetaDerivedPayload {
  invariantId: string;
  summary: string;
  dtuIds: string[];
}

export interface MetaConvergencePayload {
  id: string;
  domains: string[];
  confidence: number;
}

export interface MetaCommittedPayload {
  invariantId: string;
  committedAt: string;
}

// ── System ──────────────────────────────────────────────────────

export type SystemAlertPayload = SystemAlert;

export interface QueueNotificationPayload {
  count: number;
  latest: { id: string; title: string; type: string };
}

// ── Council ─────────────────────────────────────────────────────

export interface CouncilProposalPayload {
  proposalId: string;
  dtuId: string;
  summary: string;
}

export interface CouncilVotePayload {
  proposalId: string;
  voterId: string;
  vote: 'approve' | 'reject' | 'abstain';
}

// ── Marketplace ─────────────────────────────────────────────────

export interface MarketListingPayload {
  listingId: string;
  name: string;
  price: number;
}

export interface MarketTradePayload {
  tradeId: string;
  buyerId: string;
  listingId: string;
}

// ── Collaboration ───────────────────────────────────────────────

export interface CollabChangePayload {
  sessionId: string;
  userId: string;
  change: unknown;
}

export interface CollabLockPayload {
  sessionId: string;
  dtuId: string;
  userId: string;
}

export interface CollabSessionCreatedPayload {
  sessionId: string;
  name: string;
}

export interface CollabUserJoinedPayload {
  sessionId: string;
  userId: string;
  username: string;
}

// ── New Cognitive Systems ───────────────────────────────────────

export interface AttentionAllocationPayload {
  allocation: AttentionAllocation[];
  focusOverride: FocusOverride | null;
}

export interface ForgettingCycleCompletePayload {
  forgottenCount: number;
  tombstoneCount: number;
  threshold: number;
  duration: number;
}

export interface DreamCapturedPayload {
  id: string;
  title: string;
  convergence: boolean;
}

export type PromotionApprovedPayload = Promotion;

export type PromotionRejectedPayload = Promotion;

export interface AppPublishedPayload {
  appId: string;
  name: string;
  version: string;
}

// ── Music / Studio ──────────────────────────────────────────────

export interface MusicTogglePayload {
  playing: boolean;
  track?: string;
}

// ── Whiteboard ──────────────────────────────────────────────────

export interface WhiteboardUpdatedPayload {
  whiteboardId: string;
  userId: string;
  change: unknown;
}

// ── Master event payload map ────────────────────────────────────

export interface SocketEventMap {
  // DTU lifecycle
  'dtu:created': DTUCreatedPayload;
  'dtu:updated': DTUUpdatedPayload;
  'dtu:deleted': DTUDeletedPayload;
  'dtu:promoted': DTUPromotedPayload;
  // Entity lifecycle
  'entity:death': EntityDeathPayload;
  'body:instantiated': BodyInstantiatedPayload;
  'body:destroyed': BodyDestroyedPayload;
  // Pain/qualia
  'pain:recorded': PainRecordedPayload;
  'pain:processed': PainProcessedPayload;
  'pain:wound_created': WoundCreatedPayload;
  'pain:wound_healed': WoundHealedPayload;
  'affect:pain_signal': AffectPainSignalPayload;
  // Repair cortex
  'repair:dtu_logged': RepairDTULoggedPayload;
  // Meta-derivation
  'lattice:meta:derived': MetaDerivedPayload;
  'lattice:meta:convergence': MetaConvergencePayload;
  'meta:committed': MetaCommittedPayload;
  // System
  'system:alert': SystemAlertPayload;
  'queue:notifications:new': QueueNotificationPayload;
  // Council
  'council:proposal': CouncilProposalPayload;
  'council:vote': CouncilVotePayload;
  // Marketplace
  'market:listing': MarketListingPayload;
  'market:trade': MarketTradePayload;
  // Collaboration
  'collab:change': CollabChangePayload;
  'collab:lock': CollabLockPayload;
  'collab:unlock': CollabLockPayload;
  'collab:session:created': CollabSessionCreatedPayload;
  'collab:user:joined': CollabUserJoinedPayload;
  // New systems
  'attention:allocation': AttentionAllocationPayload;
  'forgetting:cycle_complete': ForgettingCycleCompletePayload;
  'dream:captured': DreamCapturedPayload;
  'promotion:approved': PromotionApprovedPayload;
  'promotion:rejected': PromotionRejectedPayload;
  'app:published': AppPublishedPayload;
  // Music/studio
  'music:toggle': MusicTogglePayload;
  // Whiteboard
  'whiteboard:updated': WhiteboardUpdatedPayload;
  // Resonance
  'resonance:update': Record<string, unknown>;
}

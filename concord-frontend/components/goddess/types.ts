// Shared types for the goddess lens interactive surface.

export interface Dispatch {
  id: number;
  world_id?: string;
  tone: string;
  ecosystem_score: number | null;
  refusal_strength: number | null;
  drift_kind: string | null;
  body: string;
  composed_at: number;
}

export interface DispatchStub {
  id: number;
  tone: string;
  body: string;
  composed_at: number;
}

export interface CommuneNote {
  kind: string;
  note: string;
  at: string;
  mine: boolean;
}

export interface ReactionsResult {
  dispatchId: number;
  total: number;
  byKind: Record<string, number>;
  notes: CommuneNote[];
  mine: { kind: string; note: string; at: string } | null;
}

export interface CorrelatedEvent {
  id: number;
  title?: string;
  event_type?: string;
  event_time?: number | string;
  ts?: number;
  offsetSeconds: number;
}

export interface CorrelateResult {
  dispatch: Dispatch;
  candidate: CorrelatedEvent | null;
  nearby: CorrelatedEvent[];
  windowSeconds?: number;
  reason?: string;
}

export interface Subscription {
  id: string;
  tone: string;
  worldId: string;
  createdAt: string;
  lastSeenDispatchId: number;
}

export interface SubscriptionNotification extends DispatchStub {
  subscriptionId: string;
}

export const TONE_COLOR: Record<string, string> = {
  exalted: 'border-amber-400 text-amber-100 bg-amber-950/40',
  warm: 'border-emerald-400 text-emerald-100 bg-emerald-950/40',
  neutral: 'border-zinc-500 text-zinc-200 bg-zinc-900/40',
  cold: 'border-cyan-400 text-cyan-100 bg-cyan-950/40',
  mourning: 'border-purple-400 text-purple-100 bg-purple-950/40',
};

export const KNOWN_TONES = ['exalted', 'warm', 'neutral', 'cold', 'mourning'] as const;

export const COMMUNE_KINDS = [
  { id: 'heard', label: 'Heard' },
  { id: 'blessed', label: 'Blessed' },
  { id: 'grieved', label: 'Grieved' },
  { id: 'questioned', label: 'Questioned' },
  { id: 'vowed', label: 'Vowed' },
] as const;

/**
 * Live build stream client (conversational-loop item 3). The server sends the orchestrator's events as
 * Server-Sent Events with ids; EventSource resumes from the last id on its own after a dropped connection, and
 * the reducer drops anything it has already seen, so a reconnect never duplicates or reorders the timeline.
 */

export type LiveEventType = 'start' | 'evaluated' | 'iteration' | 'done';

export interface LiveSnapshot { kind: 'stl'; file: string | null; sha256: string | null; triangles?: number | null; note?: string }

export interface LiveCandidate {
  rule: string; variable: string; value: string | number; label: string;
  gain: number; dMassKg: number; perKg: number; fixes: string[]; regressions: string[];
}

export interface LiveEvent {
  id: number;
  type: LiveEventType;
  initialState?: Record<string, unknown>;
  label?: string;
  iteration?: number;
  failingChecks?: string[];
  candidates?: LiveCandidate[];
  change?: { rule: string; variable: string; value: string | number; label: string; reason: string; pickNote?: string } | null;
  rerunNodes?: string[];
  envelopes?: Record<string, number>;
  designHash?: string;
  binding?: { rule: string; variable: string | null; why: string }[];
  snapshot?: LiveSnapshot | null;
  outcome?: {
    kind: 'all-pass' | 'proven-infeasible' | 'iteration-budget' | 'wall-time-budget';
    warnings?: string[]; failing?: string[];
    binding?: { rule: string; variable: string | null; why: string }[];
    requirementOptions?: { option: string; applied: boolean }[];
  };
  receiptSha256?: string;
}

export const LIVE_EVENT_TYPES: LiveEventType[] = ['start', 'evaluated', 'iteration', 'done'];

export function liveStreamUrl(id: string): string {
  return `/api/conkay/demo/designs/${encodeURIComponent(id)}/live`;
}

export function liveFileUrl(id: string, file: string): string {
  return `/api/conkay/demo/designs/${encodeURIComponent(id)}/live/files/${encodeURIComponent(file)}`;
}

export interface LiveState { events: LiveEvent[]; lastId: number; done: boolean }
export const LIVE_INITIAL: LiveState = { events: [], lastId: 0, done: false };

/** Append an event once, in id order; a replayed id (after a reconnect) is ignored. */
export function liveReducer(state: LiveState, e: LiveEvent): LiveState {
  if (!e || typeof e.id !== 'number' || e.id <= state.lastId) return state;
  return { events: [...state.events, e], lastId: e.id, done: state.done || e.type === 'done' };
}

/** The newest snapshot named by the events so far. */
export function latestSnapshot(events: LiveEvent[]): LiveSnapshot | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].snapshot?.file) return events[i].snapshot ?? null;
  return null;
}

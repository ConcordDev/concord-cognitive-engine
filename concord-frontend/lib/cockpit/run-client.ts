// Client for cockpit runs (CKPT-17). Everything drawn comes from a server
// response or a server event; nothing here is timer-driven.
import { csrfFetch } from '@/lib/api/csrf-fetch';
import { createSseParser } from '@/lib/chat/reply-reconcile';

export type RunStatus = 'planned' | 'running' | 'awaiting_confirm' | 'verifying' | 'paused' | 'done' | 'failed' | 'cancelled';
export interface PublicRun {
  id: string; goal: string; status: RunStatus; statusReason: string | null; chatSessionId: string | null;
  usage: { toolCalls: number; modelCalls: number; humanInterventions: number };
}
export interface PublicStep {
  id: string; seq: number; label: string; goal: string; status: string; required: boolean;
  attempts: number; hasReceipt: boolean; summary: string | null; error: string | null;
}
export interface ConfirmCardData {
  runId: string; stepId: string; kind: 'confirm' | 'question' | 'help' | 'maybe_done';
  label: string; goal: string; risk: string; changes: string[]; args: { name: string; value: string }[];
}
export type CockpitEvent =
  | { type: 'cockpit:run'; runId: string; status: RunStatus; statusReason?: string | null; done: number; total: number }
  | { type: 'cockpit:step'; runId: string; seq: number; total: number; status: string; label: string; receiptId: string | null }
  | ({ type: 'cockpit:confirm' } & ConfirmCardData);
export interface RunView { run: PublicRun | null; steps: PublicStep[]; confirm: ConfirmCardData | null; error: string | null }

export const TERMINAL: readonly RunStatus[] = ['done', 'failed', 'cancelled'];
export const EMPTY_VIEW: RunView = { run: null, steps: [], confirm: null, error: null };

export function isCockpitEvent(x: unknown): x is CockpitEvent {
  if (!x || typeof x !== 'object') return false;
  const t = (x as { type?: unknown }).type;
  return t === 'cockpit:run' || t === 'cockpit:step' || t === 'cockpit:confirm';
}

async function json(res: Response): Promise<Record<string, unknown>> {
  try { return (await res.json()) as Record<string, unknown>; } catch { return {}; }
}

export async function fetchRun(runId: string): Promise<{ ok: true; run: PublicRun; steps: PublicStep[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/cockpit/runs/${encodeURIComponent(runId)}`, { credentials: 'include' });
    const body = await json(res);
    if (!res.ok || body.ok === false) return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` };
    return { ok: true, run: body.run as PublicRun, steps: (body.steps as PublicStep[]) || [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' };
  }
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await csrfFetch(path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await json(res);
    if (!res.ok || data.ok === false) return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' };
  }
}

export function sendDecision(runId: string, body: {
  stepId: string; decision: 'approve' | 'reject' | 'answer' | 'mark_done' | 'run_again';
  editedArgs?: Record<string, unknown>; dontAskAgain?: boolean; answer?: string;
}) {
  return post(`/api/cockpit/runs/${encodeURIComponent(runId)}/decision`, body);
}

export function runAction(runId: string, action: 'pause' | 'resume' | 'cancel') {
  return post(`/api/cockpit/runs/${encodeURIComponent(runId)}/${action}`);
}

/** Opens GET /api/cockpit/runs/:id/events. Returns a close function. onError is called once if the stream ends before a terminal status. */
export function openRunEvents(runId: string, onEvent: (e: CockpitEvent) => void, onError: (reason: string) => void): () => void {
  const ctl = new AbortController();
  let closed = false;
  let terminal = false;
  let errored = false;
  const fail = (reason: string) => { if (!closed && !terminal && !errored) { errored = true; onError(reason); } };
  (async () => {
    try {
      const res = await fetch(`/api/cockpit/runs/${encodeURIComponent(runId)}/events`, { credentials: 'include', signal: ctl.signal });
      if (!res.ok || !res.body) { fail(`HTTP ${res.status}`); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const sse = createSseParser((data) => {
        if (!isCockpitEvent(data)) return;
        onEvent(data);
        if (data.type === 'cockpit:run' && TERMINAL.includes(data.status)) terminal = true;
      });
      while (!terminal) {
        const { done, value } = await reader.read();
        if (done) break;
        sse.push(decoder.decode(value, { stream: true }));
      }
      sse.push(decoder.decode());
      sse.end();
      if (terminal) { try { await reader.cancel(); } catch { /* already closed */ } }
      fail('stream_ended');
    } catch (e) {
      fail(e instanceof Error ? e.message : 'stream_error');
    }
  })();
  return () => { closed = true; ctl.abort(); };
}

/** Pure: fold one event into the state the card draws. */
export function reduceRun(state: RunView, e: CockpitEvent): RunView {
  if (e.type === 'cockpit:run') {
    const run = state.run ? { ...state.run, status: e.status, statusReason: e.statusReason ?? null } : state.run;
    return { ...state, run, confirm: e.status === 'awaiting_confirm' ? state.confirm : null };
  }
  if (e.type === 'cockpit:step') {
    const prev = state.steps.find((s) => s.seq === e.seq);
    const next: PublicStep = {
      id: prev?.id ?? `seq-${e.seq}`, seq: e.seq, label: e.label, goal: prev?.goal ?? e.label, status: e.status,
      required: prev?.required ?? true, attempts: prev?.attempts ?? 0, hasReceipt: !!e.receiptId || !!prev?.hasReceipt,
      summary: prev?.summary ?? null, error: prev?.error ?? null,
    };
    const steps = prev ? state.steps.map((s) => (s.seq === e.seq ? next : s)) : [...state.steps, next].sort((a, b) => a.seq - b.seq);
    const clears = e.status !== 'awaiting_confirm' && state.confirm && (!prev || prev.id === state.confirm.stepId);
    return { ...state, steps, confirm: clears ? null : state.confirm };
  }
  if (e.type === 'cockpit:confirm') {
    const { type: _t, ...card } = e; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...state, confirm: card as ConfirmCardData };
  }
  return state;
}

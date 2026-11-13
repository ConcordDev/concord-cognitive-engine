import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  reduceRun, isCockpitEvent, openRunEvents, EMPTY_VIEW,
  type CockpitEvent, type RunView, type PublicRun,
} from '@/lib/cockpit/run-client';

const run: PublicRun = { id: 'run_1', goal: 'g', status: 'running', statusReason: null, chatSessionId: null, usage: { toolCalls: 0, modelCalls: 0, humanInterventions: 0 } };
const base: RunView = { ...EMPTY_VIEW, run };
const stepEv = (seq: number, status: string, receiptId: string | null = null): CockpitEvent =>
  ({ type: 'cockpit:step', runId: 'run_1', seq, total: 3, status, label: `Step ${seq}`, receiptId });
const confirmEv: CockpitEvent = { type: 'cockpit:confirm', runId: 'run_1', stepId: 'stp_2', kind: 'confirm', label: 'Save', goal: 'g', risk: 'write', changes: ['x'], args: [] };

describe('reduceRun', () => {
  it('folds run, steps and a confirm into the view', () => {
    let v = reduceRun(base, { type: 'cockpit:run', runId: 'run_1', status: 'running', done: 0, total: 3 });
    v = reduceRun(v, stepEv(1, 'done'));
    v = reduceRun(v, stepEv(2, 'running'));
    v = reduceRun(v, stepEv(3, 'pending'));
    v = reduceRun(v, confirmEv);
    expect(v.steps.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(v.confirm?.stepId).toBe('stp_2');
  });
  it('a done step event clears the confirm for that step', () => {
    let v: RunView = { ...base, steps: [{ id: 'stp_2', seq: 2, label: 'Save', goal: 'g', status: 'awaiting_confirm', required: true, attempts: 1, hasReceipt: false, summary: null, error: null }], confirm: confirmEv as never };
    v = reduceRun(v, stepEv(2, 'done', 'stp_2'));
    expect(v.confirm).toBeNull();
    expect(v.steps[0].hasReceipt).toBe(true);
  });
  it('a run event that is not awaiting_confirm clears the confirm', () => {
    const v = reduceRun({ ...base, confirm: confirmEv as never }, { type: 'cockpit:run', runId: 'run_1', status: 'running', done: 1, total: 3 });
    expect(v.confirm).toBeNull();
  });
  it('an unknown event returns the same object', () => {
    const odd = { type: 'cockpit:nope' } as unknown as CockpitEvent;
    expect(reduceRun(base, odd)).toBe(base);
  });
});

describe('isCockpitEvent', () => {
  it('rejects tokens and null', () => {
    expect(isCockpitEvent({ type: 'token' })).toBe(false);
    expect(isCockpitEvent(null)).toBe(false);
    expect(isCockpitEvent({ type: 'cockpit:step' })).toBe(true);
  });
});

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }), cancel: async () => {} }) } };
}
const line = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

describe('openRunEvents', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('delivers events up to the terminal run event and never errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamOf([line(stepEv(1, 'done')), line(stepEv(2, 'done')), line({ type: 'cockpit:run', runId: 'run_1', status: 'done', done: 2, total: 2 })])));
    const got: CockpitEvent[] = []; const errs: string[] = [];
    openRunEvents('run_1', (e) => got.push(e), (r) => errs.push(r));
    await vi.waitFor(() => expect(got.length).toBe(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(errs).toEqual([]);
  });
  it('a stream that ends early reports once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamOf([line(stepEv(1, 'done'))])));
    const errs: string[] = [];
    openRunEvents('run_1', () => {}, (r) => errs.push(r));
    await vi.waitFor(() => expect(errs.length).toBe(1));
  });
  it('closing silences the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamOf([])));
    const errs: string[] = [];
    const close = openRunEvents('run_1', () => {}, (r) => errs.push(r));
    close();
    await new Promise((r) => setTimeout(r, 20));
    expect(errs).toEqual([]);
  });
});

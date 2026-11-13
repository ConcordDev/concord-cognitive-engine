import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RunCard } from './RunCard';

const mkStep = (i: number, status: string, over: Record<string, unknown> = {}) => ({
  id: `stp_${i}`, seq: i, label: `Step ${i}`, goal: `Step ${i}`, status, required: true, attempts: 1, hasReceipt: false, summary: null, error: null, ...over,
});
const runBody = (status: string, steps: unknown[]) => ({ ok: true, run: { id: 'run_1', goal: 'Size the beam', status, statusReason: null, chatSessionId: null, usage: { toolCalls: 0, modelCalls: 0, humanInterventions: 0 } }, steps });

/** A response whose event stream delivers `chunks` and then stays open. */
function openStream(chunks: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({ read: () => (i < chunks.length ? Promise.resolve({ done: false, value: enc.encode(chunks[i++]) }) : new Promise(() => {})), cancel: async () => {} }) } };
}
const jsonRes = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('RunCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a skeleton, then the counts', async () => {
    stubFetch((url) => (url.endsWith('/events') ? openStream([]) : jsonRes(200, runBody('running', [1, 2, 3, 4, 5].map((i) => mkStep(i, i <= 2 ? 'done' : 'pending'))))));
    render(<RunCard runId="run_1" />);
    expect(screen.getByLabelText('Loading task')).not.toBeNull();
    expect(await screen.findByText('2 of 5')).not.toBeNull();
  });

  it('shows a failed step\'s error and no tool ids', async () => {
    stubFetch(() => jsonRes(200, runBody('failed', [mkStep(1, 'done'), mkStep(2, 'failed', { error: 'The page would not load' })])));
    const { container } = render(<RunCard runId="run_1" />);
    expect(await screen.findByText('The page would not load')).not.toBeNull();
    expect(container.textContent).not.toMatch(/web_search|lens:/);
  });

  it('Cancel posts to the cancel route', async () => {
    const fn = stubFetch((url) => {
      if (url.endsWith('/events')) return openStream([]);
      if (url.endsWith('/cancel')) return jsonRes(200, { ok: true });
      return jsonRes(200, runBody('running', [mkStep(1, 'running')]));
    });
    render(<RunCard runId="run_1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => String(u).endsWith('/cancel') && (i as RequestInit)?.method === 'POST')).toBe(true));
  });

  it('a refused decision restores the confirm card and shows the alert', async () => {
    const confirm = { type: 'cockpit:confirm', runId: 'run_1', stepId: 'stp_1', kind: 'confirm', label: 'Save a note', goal: 'g', risk: 'write', changes: ['x'], args: [{ name: 'Title', value: 'A' }] };
    stubFetch((url) => {
      if (url.endsWith('/events')) return openStream([`data: ${JSON.stringify(confirm)}\n\n`]);
      if (url.endsWith('/decision')) return jsonRes(409, { ok: false, error: 'not_waiting' });
      return jsonRes(200, runBody('awaiting_confirm', [mkStep(1, 'awaiting_confirm')]));
    });
    render(<RunCard runId="run_1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not_waiting');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeNull();
  });

  it('negative control: a failed load shows the error line and no steps', async () => {
    stubFetch(() => jsonRes(404, { ok: false, error: 'not_found' }));
    render(<RunCard runId="run_1" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not_found');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('no cockpit component uses setInterval', () => {
    for (const f of ['RunCard.tsx', 'ConfirmCard.tsx', 'ReceiptLink.tsx']) {
      expect(fs.readFileSync(path.join(__dirname, f), 'utf8')).not.toContain('setInterval(');
    }
    expect(fs.readFileSync(path.join(__dirname, '../../lib/cockpit/useCockpitRun.ts'), 'utf8')).not.toContain('setInterval(');
  });
});

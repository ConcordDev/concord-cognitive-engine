/**
 * ContractRedline — real-time multi-party collaborative contract redlining.
 *
 * Pins from the frontend side that the component REUSES the existing
 * primitives rather than inventing new ones:
 *   - binds `useYjsDoc` to the `law:contract` scope reported by
 *     `law.contract-redline-init` (server/lib/yjs-realtime.js's generic
 *     CRDT layer — the same hook Collab's doc workspace uses)
 *   - lazily mints a collab "shadow" doc via `collab.docCreate` only when
 *     none is linked yet, then persists it via `law.contract-redline-link`
 *     so re-opening the tab reuses the same doc (never re-creates one)
 *   - presence heartbeats go through `collab.cursorUpdate` (never a new
 *     endpoint), and redline suggestions post through `collab.addComment`
 *     tagged `elementId: 'redline'` — a convention on the real comment
 *     schema, not a new comment type
 *   - tracked-changes accept/reject renders a real summary derived from
 *     `law.contract-diff`'s ops, never a fabricated count
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/hooks/useYjsDoc', () => ({
  useYjsDoc: () => ({ doc: null, synced: false, socketReady: false, resetVersion: 0 }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, { get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]) });
});

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ContractRedline } from '@/components/law/ContractRedline';

function ok<T>(result: T) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

function defaultImpl(overrides: Partial<Record<string, (params: Record<string, unknown>) => unknown>> = {}) {
  return (domain: string, action: string, params: Record<string, unknown> = {}) => {
    const key = `${domain}.${action}`;
    if (overrides[key]) return ok(overrides[key]!(params));
    switch (key) {
      case 'law.contract-redline-init':
        return ok({ contractId: 'ctr_1', scope: 'law:contract', body: '[Confidentiality]\nKeep it secret.', collabDocId: null });
      case 'collab.docCreate':
        return ok({ id: 'doc_shadow_1', title: 'Redline — MSA', ownerId: 'me', text: '', createdAt: Date.now() });
      case 'law.contract-redline-link':
        return ok({ collabDocId: params.collabDocId });
      case 'collab.cursorUpdate':
        return ok({ presence: [{ userId: 'user_b', name: 'Bob', color: '#60a5fa', cursor: 0, selection: null, following: null, updatedAt: Date.now() }] });
      case 'collab.listComments':
        return ok({ threads: [], comments: [], total: 0 });
      case 'collab.addComment':
        return ok({ comment: { id: 'cmt_1', threadId: 'cmt_1', parentId: null, elementId: params.elementId ?? null, anchor: params.anchor ?? null, authorId: 'me', authorName: 'Me', text: params.text, mentions: [], resolved: false, createdAt: Date.now() } });
      case 'collab.resolveThread':
        return ok({ threadId: params.threadId, resolved: !params.reopen });
      case 'law.contract-version-list':
        return ok({ versions: [{ version: 1, label: 'v1', clauseCount: 1, savedBy: 'me', savedAt: new Date().toISOString(), charCount: 40 }], count: 1 });
      case 'law.contract-diff':
        return ok({
          from: 'v1', to: 'current',
          ops: [
            { op: 'same', text: '[Confidentiality]' },
            { op: 'remove', text: 'Keep it secret.' },
            { op: 'add', text: 'Keep it strictly confidential.' },
          ],
          added: 1, removed: 1, unchanged: 1,
        });
      default:
        return ok(null);
    }
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(defaultImpl());
});

afterEach(() => {
  cleanup();
});

describe('ContractRedline — reuses the Yjs + collab layers, never a parallel transport', () => {
  it('mints a shadow collab doc only when none is linked, then links it back onto the contract', async () => {
    render(<ContractRedline contractId="ctr_1" contractTitle="MSA" />);

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law', 'contract-redline-init', { id: 'ctr_1' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('collab', 'docCreate', expect.objectContaining({ title: expect.stringContaining('MSA') })));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law', 'contract-redline-link', { id: 'ctr_1', collabDocId: 'doc_shadow_1' }));

    // The seeded body renders in the draft editor — real backend content, not fabricated.
    await waitFor(() => expect(document.querySelector('textarea')?.value).toContain('Keep it secret.'));
  });

  it('reuses an already-linked collab doc instead of minting a second one', async () => {
    lensRunMock.mockImplementation(defaultImpl({
      'law.contract-redline-init': () => ({ contractId: 'ctr_1', scope: 'law:contract', body: 'x', collabDocId: 'doc_existing' }),
    }));
    render(<ContractRedline contractId="ctr_1" contractTitle="MSA" />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law', 'contract-redline-init', { id: 'ctr_1' }));

    const calledActions = lensRunMock.mock.calls.map((c) => `${c[0]}.${c[1]}`);
    expect(calledActions).not.toContain('collab.docCreate');
    expect(calledActions).not.toContain('law.contract-redline-link');
  });

  it('presence heartbeat goes through collab.cursorUpdate against the shadow doc and renders real rows', async () => {
    const { getByText } = render(<ContractRedline contractId="ctr_1" contractTitle="MSA" />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('collab', 'cursorUpdate', expect.objectContaining({ docId: 'doc_shadow_1' })));
    await waitFor(() => expect(getByText('Bob')).toBeInTheDocument());
  });

  it('posting a redline suggestion tags elementId:"redline" on the real collab.addComment call', async () => {
    const { getByPlaceholderText } = render(<ContractRedline contractId="ctr_1" contractTitle="MSA" />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law', 'contract-redline-init', { id: 'ctr_1' }));

    const input = await waitFor(() => getByPlaceholderText('Propose a change…'));
    fireEvent.change(input, { target: { value: 'Tighten the confidentiality language.' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('collab', 'addComment', expect.objectContaining({
      docId: 'doc_shadow_1', text: 'Tighten the confidentiality language.', elementId: 'redline',
    })));
  });

  it('tracked changes: Diff renders the REAL contract-diff ops, and accept/reject updates an honest review summary', async () => {
    const { getByText, findByText } = render(<ContractRedline contractId="ctr_1" contractTitle="MSA" />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law', 'contract-version-list', { id: 'ctr_1' }));

    fireEvent.click(await findByText('Diff'));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law', 'contract-diff', { id: 'ctr_1', fromVersion: 1 }));

    // Real diff text renders verbatim — not a fabricated summary.
    await waitFor(() => expect(getByText('Keep it strictly confidential.')).toBeInTheDocument());
    await waitFor(() => expect(getByText('Keep it secret.')).toBeInTheDocument());

    const summary = await findByText(/0 accepted · 0 rejected · 2 pending/);
    expect(summary).toBeInTheDocument();

    fireEvent.click(getByText('Accept all'));
    await waitFor(() => expect(within(document.body).getByText(/2 accepted · 0 rejected · 0 pending/)).toBeInTheDocument());

    fireEvent.click(getByText('Reject all'));
    await waitFor(() => expect(within(document.body).getByText(/0 accepted · 2 rejected · 0 pending/)).toBeInTheDocument());
  });
});

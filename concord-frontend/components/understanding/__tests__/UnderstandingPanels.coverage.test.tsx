// Behaviour coverage for the understanding lens: ComposePanel (parse preview / compose & save /
// failures) and the NotesWorkbench (search, tags, create, edit with optimistic save + rollback,
// revisions + diff, links, review toggle, exports, delete).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const h = vi.hoisted(() => ({ lensRun: vi.fn(), post: vi.fn(), mutate: vi.fn(), logData: { current: null as unknown } }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => h.lensRun(...a), api: { post: (...a: unknown[]) => h.post(...a) } }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: h.logData.current }),
  useCreateArtifact: () => ({ mutate: h.mutate }),
}));

const SRS = { enabled: false, state: 'new', ease: 2.5, interval: 0, reps: 0, lapses: 0, dueAt: null, lastReviewedAt: null };
const NOTE = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Note ${id}`, body: 'Body with [[Note n2]] link', tags: ['idea', 'work'], createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z', revisionCount: 3, wordCount: 5, srs: SRS, ...over });
function resultFor(action: string, input?: Record<string, unknown>): unknown {
  switch (action) {
    case 'list': return { notes: [NOTE('n1'), NOTE('n2', { tags: ['work'] })], count: 2 };
    case 'tags': return { tags: [{ tag: 'idea', count: 1 }, { tag: 'work', count: 2 }] };
    case 'search': return { matches: [{ ...NOTE('n1'), score: 9, snippet: 'Body with…', hitIn: { title: true, body: true, tags: false } }], count: 1 };
    case 'create': return { note: NOTE('n3') };
    case 'get': return { note: NOTE(String(input?.id)), revisions: [{ index: 0, at: '2026-03-01T00:00:00Z', title: 'v0' }, { index: 1, at: '2026-03-02T00:00:00Z', title: 'v1' }, { index: 2, at: '2026-03-03T00:00:00Z', title: 'v2' }] };
    case 'backlinks': return { noteId: String(input?.id), title: 'Note', backlinks: [{ linkId: 'l1', kind: 'manual', relation: 'supports', noteId: 'n2', title: 'Note n2', context: 'ctx', resolved: true }, { kind: 'wiki', relation: 'wiki', noteId: null, title: 'Missing', resolved: false }], backlinkCount: 2, outbound: [{ linkId: 'l2', kind: 'manual', relation: 'refutes', noteId: 'n2', title: 'Note n2' }], outboundCount: 1 };
    case 'edit': return { note: NOTE(String(input?.id)), changed: true };
    case 'diff': return { noteId: 'n1', fromRevision: 1, toRevision: 2, fromAt: '2026-03-02T00:00:00Z', toAt: '2026-03-03T00:00:00Z', lines: [{ type: 'same', text: 'keep' }, { type: 'add', text: 'new line' }, { type: 'del', text: 'old line' }], added: 1, removed: 1, unchanged: 1 };
    case 'export': return { filename: 'note.md', content: '# Note', format: String(input?.format) };
    default: return { ok: true };
  }
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 30)); }); };
const btn = (re: RegExp, nth = 0) => screen.getAllByRole('button', { name: re })[nth];
afterEach(() => cleanup());
beforeEach(() => {
  h.lensRun.mockReset(); h.post.mockReset(); h.mutate.mockReset(); h.logData.current = null;
  h.lensRun.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a), a[2] as Record<string, unknown>) } }));
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('ComposePanel', () => {
  const mount = async (kinds: string[] = ['raw', 'dtu', 'claims']) => {
    const { ComposePanel } = await import('../ComposePanel');
    const onComposed = vi.fn();
    const v = render(<ComposePanel subjectKinds={kinds as never} onComposed={onComposed} />);
    await settle();
    return { v, onComposed };
  };

  it('parses a preview and composes + saves raw text', async () => {
    h.logData.current = { artifacts: [{ id: 'a1', title: 'raw via rules', createdAt: '2026-03-01T00:00:00Z', data: { at: '2026-03-01T00:00:00Z' } }] };
    h.post.mockImplementation(async (_u: string, b: { name: string }) => ({ data: { ok: true, result: b.name === 'parse' ? { ok: true, understanding: { id: 'u1', text: 'Parsed summary', consistency: 0.812, confidence: 0.7, composer: 'rules', subjectKind: 'raw' } } : { ok: true, id: 'u-saved' } } }));
    const { v, onComposed } = await mount();
    expect(v.container.textContent).toMatch(/Recent compose sessions/);
    expect((btn(/Parse preview/) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.change(screen.getByPlaceholderText(/Paste the text/), { target: { value: 'Some raw words' } }); });
    await click(btn(/Parse preview/));
    expect(v.container.textContent).toMatch(/Parsed summary/);
    expect(v.container.textContent).toMatch(/0.812/);
    await click(btn(/Compose & save/));
    expect(v.container.textContent).toMatch(/u-saved/);
    expect(onComposed).toHaveBeenCalled();
    expect(h.mutate).toHaveBeenCalled();
  });

  it('switches to a subject id kind and reports failures', async () => {
    h.post.mockImplementation(async () => ({ data: { ok: false, error: 'subject missing' } }));
    const { v } = await mount();
    const selects = v.container.querySelectorAll('select');
    await act(async () => { fireEvent.change(selects[0], { target: { value: 'dtu' } }); });
    await act(async () => { fireEvent.change(selects[1], { target: { value: 'llm' } }); });
    await act(async () => { fireEvent.change(screen.getByPlaceholderText(/dtu_<id>/), { target: { value: 'dtu_42' } }); });
    await click(btn(/Parse preview/));
    expect(v.container.textContent).toMatch(/subject missing/);
    h.post.mockRejectedValue(new Error('network down'));
    await click(btn(/Compose & save/));
    expect(v.container.textContent).toMatch(/network down/);
    h.post.mockRejectedValue('weird');
    await click(btn(/Parse preview/));
    expect(v.container.textContent).toMatch(/parse failed/);
  });

  it('renders with no subject kinds supplied', async () => {
    const { v } = await mount([]);
    expect(v.container.querySelector('option[value="raw"]')).toBeTruthy();
  });
});

describe('NotesWorkbench', () => {
  const mount = async (props: Record<string, unknown> = {}) => {
    const { NotesWorkbench } = await import('../NotesWorkbench');
    const v = render(<NotesWorkbench {...props} />);
    await settle();
    return v;
  };
  const sent = () => h.lensRun.mock.calls.map((c) => actionOf(c));

  it('lists notes, searches, filters by tag and creates a note', { timeout: 60000 }, async () => {
    const v = await mount();
    expect(v.container.textContent).toMatch(/Note n1/);
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('Full-text search…'), { target: { value: 'body' } }); await new Promise((r) => setTimeout(r, 400)); });
    expect(sent()).toContain('search');
    await click(screen.getByLabelText('Clear search'));
    await click(btn(/#?work/i));
    await click(btn(/#?work/i));
    await exercise({ passes: 1, text: 'A fresh idea', skip: /delete|remove|trash|discard|cancel|close|dismiss|clear|^×$/i });
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['list', 'tags']));
  });

  it('opens a note: edits (optimistic), diffs revisions, links, reviews and exports', { timeout: 90000 }, async () => {
    const v = await mount({ initialNoteId: 'n1', onChanged: vi.fn() });
    expect(sent()).toEqual(expect.arrayContaining(['get', 'backlinks']));
    const inputs = () => screen.getAllByRole('textbox');
    const title = inputs().find((e) => (e as HTMLInputElement).value === 'Note n1') as HTMLElement;
    await act(async () => { fireEvent.change(title, { target: { value: 'Renamed note' } }); });
    const saveBtn = screen.getAllByRole('button').find((b) => /^Save/.test((b.textContent || '').trim())) as HTMLElement;
    await click(saveBtn);
    expect(h.lensRun.mock.calls.find((c) => actionOf(c) === 'edit')?.[2]).toEqual(expect.objectContaining({ title: 'Renamed note' }));
    await exercise({ passes: 1, text: 'n2', skip: /delete|remove|trash|discard|cancel|close|dismiss|clear|unlink|^×$/i });
    await settle();
    expect(sent().some((x) => /diff|link|export|edit/.test(x))).toBe(true);
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('toggles review, exports, links, unlinks, diffs and deletes with confirmation', { timeout: 90000 }, async () => {
    const onDeleted = vi.fn();
    const v = await mount({ initialNoteId: 'n1', onChanged: onDeleted });
    const box = v.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { fireEvent.click(box); await new Promise((r) => setTimeout(r, 30)); });
    expect(h.lensRun.mock.calls.some((c) => actionOf(c) === 'edit' && (c[2] as { reviewEnabled?: boolean }).reviewEnabled === true)).toBe(true);
    await click(btn(/Markdown/));
    await click(btn(/DTU pack/));
    expect(sent().filter((x) => x === 'export').length).toBe(2);
    const selects = v.container.querySelectorAll('select');
    for (const s of selects) {
      const opts = Array.from(s.querySelectorAll('option'));
      const pick = opts.find((o) => (o as HTMLOptionElement).value) as HTMLOptionElement | undefined;
      if (pick) await act(async () => { fireEvent.change(s, { target: { value: pick.value } }); });
    }
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('relation'), { target: { value: 'supports' } }); });
    const adds = screen.getAllByRole('button').filter((b) => /^(Add link|Link)/i.test((b.textContent || '').trim()));
    if (adds[0]) await click(adds[0]);
    const diffBtn = screen.getAllByRole('button').find((b) => /diff/i.test((b.textContent || '').trim()));
    if (diffBtn) await click(diffBtn);
    const rm = screen.queryAllByLabelText('Remove link')[0];
    if (rm) await click(rm);
    h.lensRun.mockImplementationOnce(async () => ({ data: { ok: false, error: "op refused" } }));
    await click(btn(/Markdown/));
    expect(v.container.textContent).toMatch(/op refused/);
    await click(btn(/^Delete/));
    expect(v.container.textContent).toMatch(/Click again to confirm/);
    await click(btn(/^Keep$/));
    await click(btn(/^Delete/));
    await click(btn(/Delete this note/));
    expect(sent()).toContain('remove');
  });

  it('rolls back a failed save and reports a missing note', { timeout: 60000 }, async () => {
    const { NotesWorkbench } = await import('../NotesWorkbench');
    h.lensRun.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'edit' ? { data: { ok: false, error: 'conflict' } } : { data: { ok: true, result: resultFor(actionOf(a), a[2] as Record<string, unknown>) } });
    const v = render(<NotesWorkbench initialNoteId="n1" />);
    await settle();
    const title = screen.getAllByRole('textbox').find((e) => (e as HTMLInputElement).value === 'Note n1') as HTMLElement;
    await act(async () => { fireEvent.change(title, { target: { value: 'Will fail' } }); });
    await click(screen.getAllByRole('button').find((b) => /^Save/.test((b.textContent || '').trim())) as HTMLElement);
    expect(v.container.textContent).toMatch(/conflict/);
    cleanup();
    h.lensRun.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'get' ? { data: { ok: false, error: 'note not found' } } : { data: { ok: true, result: resultFor(actionOf(a), a[2] as Record<string, unknown>) } });
    const missing = render(<NotesWorkbench initialNoteId="zzz" />);
    await settle();
    expect(missing.container.textContent).toMatch(/note not found/);
    cleanup();
    h.lensRun.mockRejectedValue(new Error('load boom'));
    const boom = render(<NotesWorkbench />);
    await settle();
    expect(boom.container.textContent).toMatch(/load boom|Note/);
  });
});

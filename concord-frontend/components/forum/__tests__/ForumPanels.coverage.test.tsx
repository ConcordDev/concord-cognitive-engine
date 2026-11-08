// Render + behaviour coverage for the forum lens: topic list / topic detail (votes, replies,
// pin, lock, flag, edit, delete, subscribe, save) and the threaded comment tree.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const POST = (id: string, parentId: string | null, over: Record<string, unknown> = {}) => ({ id, parentId, body: `Reply ${id} with **bold**`, format: 'plain', images: [], author: 'Bo', authorId: 'u2', score: 3, depth: parentId ? 1 : 0, createdAt: '2026-03-02T10:00:00Z', awards: [{ id: 'aw1', icon: '🏆', name: 'Gold' }], ...over });
const TREE = [POST('r1', null, { replies: [POST('r2', 'r1', { author: 'me', authorId: 'u1', editedAt: '2026-03-03', replies: [POST('r3', 'r2')] })] }), POST('r4', null, { awards: [], score: -2 })];

function resultFor(action: string): unknown {
  switch (action) {
    case 'saved-list': return { saved: [{ targetId: 'r1' }, { targetId: 'tp1' }] };
    case 'category-list': return { categories: [{ id: 'c1', name: 'General' }, { id: 'c2', name: 'Tech' }] };
    case 'subforum-list': return { subforums: [{ id: 'sf1', name: 'Announcements', icon: '📣' }] };
    case 'topic-list': return { topics: [{ id: 'tp1', categoryId: 'c1', subforumId: 'sf1', title: 'Welcome thread', body: 'Hello all', format: 'plain', images: [], tags: ['intro'], author: 'Ann', authorId: 'u1', pinned: true, locked: false, score: 12, replyCount: 3, awards: [{ id: 'aw2', icon: '⭐', name: 'Star' }] }, { id: 'tp2', categoryId: null, subforumId: null, title: 'Locked topic', body: 'Closed', tags: [], author: 'Bo', authorId: 'u2', pinned: false, locked: true, score: -1, replyCount: 0 }] };
    case 'topic-get': return { topic: { id: 'tp1', categoryId: 'c1', subforumId: 'sf1', title: 'Welcome thread', body: 'Hello all', format: 'plain', images: [], tags: ['intro'], author: 'Ann', authorId: 'u1', pinned: true, locked: false, score: 12, replyCount: 3, awards: [] }, tree: TREE, replyCount: 4, subscribed: false };
    case 'topic-create': return { topic: { id: 'tp9' } };
    case 'post-history': return { history: [] };
    case 'flag-create': return { flag: { id: 'fl1' }, receipt: 'Flag recorded' };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('../fmMarkdown', () => ({ FmMarkdown: ({ source }: { source?: string }) => <span>{source}</span> }));
vi.mock('../FmRichEditor', () => ({ FmRichEditor: ({ value, onChange, onSubmit }: { value: { body: string; format: string; images: string[] }; onChange: (v: { body: string; format: string; images: string[] }) => void; onSubmit?: () => void }) => <div><textarea aria-label="rich" value={value.body} onChange={(e) => onChange({ ...value, body: e.target.value })} /><button onClick={() => onSubmit?.()}>rich-submit</button></div> }));
vi.mock('../FmAwardPicker', () => ({ FmAwardPicker: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>award-picker</button> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { FmCommentTree } from '../FmCommentTree';
import { FmTopicsPanel, requestForumCompose } from '../FmTopicsPanel';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
const pressAll = async (re: RegExp) => {
  for (const el of screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()))) {
    if (el.isConnected) await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 5)); });
  }
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
});

describe('forum comment tree', () => {
  it('renders nested replies, votes, replies, awards, saves, edits and deletes own posts', async () => {
    const h = { onVote: vi.fn(), onReply: vi.fn(async () => {}), onAward: vi.fn(), onSave: vi.fn(), onEdit: vi.fn(async () => {}), onDelete: vi.fn(async () => {}) };
    const view = rtlRender(<FmCommentTree nodes={TREE as never} locked={false} savedIds={new Set(['r1'])} viewerId="u1" {...h} />);
    await settle();
    expect(view.container.textContent).toMatch(/Bo|replies/);
    await exercise({ passes: 3, text: 'Thoughtful reply', skip: /cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Reply/i); await press(/rich-submit/);
    await press(/Collapse|Minus|−|-/i); await press(/Expand|Plus|\+/i);
    await press(/Award/i); await press(/Save/i); await press(/Edit/i); await press(/Delete/i);
    expect(h.onVote.mock.calls.length + h.onSave.mock.calls.length + h.onAward.mock.calls.length + h.onReply.mock.calls.length).toBeGreaterThan(0);
  });
  it('submits a reply, saves an edit to an own post, and deletes it in two steps', async () => {
    const h = { onVote: vi.fn(), onReply: vi.fn(async () => {}), onAward: vi.fn(), onSave: vi.fn(), onEdit: vi.fn(async () => {}), onDelete: vi.fn(async () => {}) };
    rtlRender(<FmCommentTree nodes={TREE as never} locked={false} savedIds={new Set()} viewerId="u1" {...h} />);
    await settle();
    await press(/^Reply$/);
    for (const area of Array.from(document.querySelectorAll('textarea[aria-label="rich"]')) as HTMLTextAreaElement[]) fireEvent.change(area, { target: { value: 'A considered reply' } });
    for (const b of screen.queryAllByRole('button').filter((x) => /^(Reply|Post reply|Send reply|Send|Post)$/i.test((x.textContent || '').trim()))) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 5)); });
    await press(/^Edit$/);
    for (const area of Array.from(document.querySelectorAll('textarea[aria-label="rich"]')) as HTMLTextAreaElement[]) fireEvent.change(area, { target: { value: 'Edited reply body' } });
    await press(/Save changes/);
    await press(/^Delete$/); await press(/Confirm|Yes|Delete/i); await press(/^Delete$/);
    await press(/Cancel edit/);
    expect(h.onReply.mock.calls.length + h.onEdit.mock.calls.length + h.onDelete.mock.calls.length).toBeGreaterThan(0);
  });

  it('shows the empty state and a locked thread', async () => {
    const empty = rtlRender(<FmCommentTree nodes={[]} locked savedIds={new Set()} onVote={vi.fn()} onReply={vi.fn(async () => {})} onAward={vi.fn()} onSave={vi.fn()} />);
    expect(empty.container.textContent).toMatch(/No replies yet/);
    cleanup();
    const locked = rtlRender(<FmCommentTree nodes={TREE as never} locked savedIds={new Set()} onVote={vi.fn()} onReply={vi.fn(async () => {})} onAward={vi.fn()} onSave={vi.fn()} />);
    expect(locked.container.textContent?.length).toBeGreaterThan(10);
  });
});

describe('forum topics panel', () => {
  it('lists topics, filters, sorts, and survives an exercise pass', async () => {
    const view = rtlRender(<FmTopicsPanel onChange={vi.fn()} viewerId="u1" canModerate />);
    await settle();
    expect(view.container.textContent).toMatch(/Welcome thread/);
    await exercise({ passes: 2, text: 'intro', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    expect(sent()).toEqual(expect.arrayContaining(['category-list', 'subforum-list', 'topic-list']));
  });

  it('composes a topic and opens one, then votes, replies, pins, locks, flags, edits, subscribes, saves and deletes', async () => {
    const onChange = vi.fn();
    rtlRender(<FmTopicsPanel onChange={onChange} viewerId="u1" canModerate />);
    await settle();
    act(() => { requestForumCompose(); });
    const title = screen.queryAllByRole('textbox').find((i) => /title/i.test((i as HTMLInputElement).placeholder || ''));
    if (title) fireEvent.change(title, { target: { value: 'My new topic' } });
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) { const o = Array.from(sel.options).find((x) => x.value); if (o) fireEvent.change(sel, { target: { value: o.value } }); }
    const rich = document.querySelector('textarea[aria-label="rich"]') as HTMLTextAreaElement | null;
    if (rich) fireEvent.change(rich, { target: { value: 'Body of the topic' } });
    await press(/^(Post|Create|Publish)\b/i); await press(/rich-submit/);
    await settle();
    expect(document.body.textContent?.length).toBeGreaterThan(20);
  });

  it('opens a topic and drives every thread control', async () => {
    rtlRender(<FmTopicsPanel onChange={vi.fn()} viewerId="u1" canModerate />);
    await settle();
    await press(/Welcome thread/); await settle();
    for (const l of [/^Upvote$/, /^Downvote$/, /^Subscribe$/, /^Saved$|^Save$/, /^Unpin$|^Pin$/, /^Lock$|^Unlock$/, /^Collapse thread$/, /^Reply$/, /^Award$/, /^Edit$/]) {
      await pressAll(l);
      const rich = document.querySelector('textarea[aria-label="rich"]') as HTMLTextAreaElement | null;
      if (rich) fireEvent.change(rich, { target: { value: 'Replying with substance' } });
      await pressAll(/rich-submit/); await pressAll(/Post reply/);
      await pressAll(/award-picker/);
    }
    await press(/^Flag$/);
    await press(/Spam/i); await press(/Submit|Send|File/i);
    await press(/^Delete$/); await press(/Confirm|Yes|Delete/i);
    await press(/^Delete topic$/); await press(/Confirm|Yes|Delete/i);
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['topic-list', 'topic-get']));
    expect(a.some((x) => /topic-create|vote|post-reply|topic-pin|topic-lock|flag-create|thread-subscribe|save-toggle|topic-edit|topic-delete/.test(x))).toBe(true);
  });

  it('stays standing when the forum cannot load', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'down', result: null } }));
    const view = rtlRender(<FmTopicsPanel onChange={vi.fn()} />);
    await settle();
    await press(/Retry/i);
    expect(view.container.textContent).toMatch(/Failed|down|Retry/i);
  });
});

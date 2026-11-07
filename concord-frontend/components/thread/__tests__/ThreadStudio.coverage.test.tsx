// Render + behaviour coverage for the thread studio: accounts, media (attach/reorder/remove),
// calendar, AI assist, style/CTA preview and analytics (publish, fetch metrics, mark posted, sync).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const ACC = (id: string, platform: string, mode: 'api' | 'manual') => ({ id, platform, handle: `me_${id}`, displayName: `Me ${id}`, status: 'connected', publishMode: mode, defaults: { numberingStyle: 'slash', ctaTemplate: null, autoPlug: null } });
const THREAD = (id: string, over: Record<string, unknown> = {}) => ({ publishId: id, platform: 'bluesky', handle: 'me_a1', title: `Thread ${id}`, postCount: 3, impressions: 1200, likes: 80, reposts: 12, replies: 6, engagementRate: 8.1, synced: false, status: 'posted', method: 'api', posts: [{ index: 1, text: 'First post', url: 'https://x/1' }, { index: 2, text: 'Second post', url: null }], ...over });
function resultFor(action: string): unknown {
  switch (action) {
    case 'draft-list': return { drafts: [{ id: 'd1', title: 'Launch thread', platform: 'bluesky', status: 'draft', postCount: 3 }, { id: 'd2', title: 'Second', platform: 'x', status: 'draft', postCount: 2 }] };
    case 'account-list': return { accounts: [ACC('a1', 'bluesky', 'api'), ACC('a2', 'x', 'manual')] };
    case 'media-list': return { media: [{ id: 'm1', postIndex: 1, kind: 'image', url: 'https://img/1.png', alt: 'one', order: 0 }, { id: 'm2', postIndex: 1, kind: 'image', url: 'https://img/2.png', alt: null, order: 1 }] };
    case 'queue-calendar': return { cells: [{ date: '2026-03-02', count: 2, items: [{ id: 'd1', title: 'Launch thread', platform: 'bluesky', scheduledAt: '2026-03-02T10:00:00Z', postCount: 3 }] }, { date: '2026-03-03', count: 0, items: [] }] };
    case 'ai-suggest-hook': return { hooks: [{ style: 'curiosity', text: 'You will not believe this' }, { style: 'stat', text: '9 of 10 teams miss this' }], originalOpener: 'Here is a thing' };
    case 'ai-rewrite': return { changed: true, rewritten: 'Tighter text', deltaPct: -22 };
    case 'cta-templates': return { templates: [{ id: 'c1', label: 'Follow', text: 'Follow for more' }] };
    case 'restyle-preview': return { posts: [{ index: 1, text: '1/ Hello', chars: 8 }, { index: 2, text: '2/ World', chars: 8 }] };
    case 'engagement-report': return { threads: [THREAD('p1'), THREAD('p2', { synced: true, status: 'awaiting_manual', method: 'manual', platform: 'x' })], totals: { impressions: 2400, likes: 160, reposts: 24, replies: 12 }, avgEngagementRate: 8.1 };
    case 'publish-to-account': return { published: { status: 'posted', id: 'p9', postCount: 3 } };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const TAB_RE = /^(Accounts|Media|Calendar|AI Assist|Style|Analytics)$/;
const goTab = async (name: string) => { const b = screen.getAllByRole('button').find((x) => (x.textContent || '').trim() === name); if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 25)); }); };
const mount = async () => { const { ThreadStudio } = await import('../ThreadStudio'); const v = render(<ThreadStudio />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

describe('ThreadStudio', () => {
  it('walks every tab and exercises its controls', { timeout: 120000 }, async () => {
    const v = await mount();
    expect(sent()).toContain('draft-list');
    for (const t of ['Accounts', 'Media', 'Calendar', 'AI Assist', 'Style', 'Analytics']) {
      await goTab(t);
      await exercise({ passes: 2, text: 'Launch day thread with a long enough body to rewrite.', skip: new RegExp(`${TAB_RE.source}|delete|remove|disconnect|trash|discard|cancel|close|dismiss|clear|^×$`, 'i') });
      await settle();
    }
    const calls = sent();
    for (const a of ['account-list', 'media-list', 'queue-calendar', 'engagement-report']) expect(calls).toContain(a);
    expect(v.container.textContent?.length).toBeGreaterThan(50);
  });

  it('connects and disconnects accounts, and manages media', { timeout: 90000 }, async () => {
    await mount();
    await goTab('Accounts');
    await exercise({ passes: 1, text: 'someone', skip: TAB_RE });
    await goTab('Media');
    await exercise({ passes: 1, text: 'https://img/3.png', skip: TAB_RE });
    expect(sent().some((x) => /account-(connect|disconnect|update)|media-(attach|remove|reorder)/.test(x))).toBe(true);
  });

  it('publishes an API draft, hands off a manual one, fetches metrics and marks posted', { timeout: 90000 }, async () => {
    const v = await mount();
    await goTab('Analytics');
    expect(v.container.textContent).toMatch(/Thread p1/);
    const pick = async (label: string, value: string) => { const el = screen.getByLabelText(label); await act(async () => { fireEvent.change(el, { target: { value } }); }); };
    const publishBtn = () => screen.getByLabelText("Account").parentElement!.querySelector("button") as HTMLElement;
    await act(async () => { fireEvent.click(publishBtn()); });
    expect(v.container.textContent).toMatch(/select a draft and an account/);
    await pick('Draft to publish', 'd1'); await pick('Account', 'a1');
    await act(async () => { fireEvent.click(publishBtn()); await new Promise((r) => setTimeout(r, 30)); });
    expect(sent()).toContain('publish-to-account');
    await pick('Account', 'a2');
    await act(async () => { fireEvent.click(publishBtn()); await new Promise((r) => setTimeout(r, 30)); });
    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'publish-to-account' ? { data: { ok: false, error: 'platform refused' } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await act(async () => { fireEvent.click(publishBtn()); await new Promise((r) => setTimeout(r, 30)); });
    expect(v.container.textContent).toMatch(/platform refused/);
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
    await exercise({ passes: 2, text: 'https://x/posted', skip: new RegExp(`${TAB_RE.source}|delete|remove|cancel|close|^×$`, 'i') });
    expect(sent().some((x) => /engagement-fetch|publish-mark-posted|engagement-sync/.test(x))).toBe(true);
  });

  it('shows empty and failing states for every tab', { timeout: 90000 }, async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'thread backend offline' } }));
    const v = await mount();
    for (const t of ['Accounts', 'Media', 'Calendar', 'AI Assist', 'Style', 'Analytics']) {
      await goTab(t);
      await exercise({ passes: 1, text: 'draft text', skip: new RegExp(`${TAB_RE.source}|delete|remove|cancel|close|^×$`, 'i') });
    }
    expect(v.container.textContent?.length).toBeGreaterThan(20);
  });
});

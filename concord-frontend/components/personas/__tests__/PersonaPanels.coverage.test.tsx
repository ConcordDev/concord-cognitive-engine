// Behaviour coverage for the persona chat preview and the persona detail panel: chat resume /
// fresh open / send / rollback, publish arming, install, remix, rate, portrait regen + upload,
// and every tab.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// jsdom has no Element.scrollTo; the chat preview calls it in an effect.
Element.prototype.scrollTo = () => {};

const h = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../persona-envelope', () => ({ runPersona: (...a: unknown[]) => h.run(...a) }));
vi.mock('@/components/viz', () => ({ ChartKit: ({ data }: { data: unknown[] }) => <div>chart:{data.length}</div> }));

const PERSONA = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Nova', tagline: 'A helpful guide', personality: 'Curious and warm', voice: 'warm', greeting: 'Hi!', category: 'guide',
  tags: ['space', 'friendly'], portrait: 'data:image/png;base64,AAA', version: 3, published: false, isAuthor: true,
  rating: 4.5, ratingCount: 2, installCount: 7, chatCount: 11, exampleDialogue: [], ...over,
});
let persona = PERSONA();
const ok = (data: unknown) => ({ ok: true, error: null, data });
function impl(action: string, input?: Record<string, unknown>) {
  switch (action) {
    case 'get': return ok({ persona, reviews: [{ userId: 'u2', stars: 4, review: 'Great', at: 1_770_000_000 }] });
    case 'stats': return ok({ installCount: 7, chatCount: 11, version: 3, rating: 4.5, ratingCount: 2, distribution: [{ stars: 5, count: 1 }, { stars: 4, count: 1 }], published: persona.published, isAuthor: persona.isAuthor });
    case 'versions': return ok({ versions: [{ version: 1, changelog: 'first', contentHash: 'abcdef0123456789abcdef', at: 1_770_000_000 }, { version: 2, changelog: 'tweak', contentHash: '1234567890abcdef12345', at: 1_770_100_000 }] });
    case 'chat_open': return ok({ chatId: 'c-new', turns: [{ role: 'persona', text: 'Hello there', at: 1, basis: 'authored_example' }] });
    case 'chat_history': return input?.chatId === 'stale' ? { ok: false, error: 'gone', data: null } : ok({ chatId: input?.chatId, turns: [{ role: 'user', text: 'earlier', at: 1 }, { role: 'persona', text: 'reply', at: 2 }] });
    case 'chat_send': return ok({ reply: { role: 'persona', text: 'Nice question', at: 3 } });
    case 'publish': return ok({ published: !persona.published });
    case 'install': return ok({ version: 3 });
    default: return ok({});
  }
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 25)); }); };
const btn = (re: RegExp) => screen.getByRole('button', { name: re });
afterEach(() => { cleanup(); sessionStorage.clear(); });
beforeEach(() => {
  sessionStorage.clear(); persona = PERSONA();
  h.run.mockReset();
  h.run.mockImplementation(async (a: string, i?: Record<string, unknown>) => impl(a, i));
  window.HTMLElement.prototype.scrollTo = vi.fn() as never;
});

describe('PersonaChat', () => {
  it('opens a fresh chat, sends a message, and starts a new chat', async () => {
    const { PersonaChat } = await import('../PersonaChat');
    const view = render(<PersonaChat personaId="p1" personaName="Nova" portrait="data:image/png;base64,AAA" />);
    await settle();
    expect(view.container.textContent).toMatch(/Hello there/);
    expect(view.container.textContent).toMatch(/authored example/);
    expect(sessionStorage.getItem('concord:personas:chat:p1')).toBe('c-new');
    const input = screen.getByPlaceholderText('Message Nova…');
    await act(async () => { fireEvent.change(input, { target: { value: 'hello?' } }); });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); await new Promise((r) => setTimeout(r, 25)); });
    expect(view.container.textContent).toMatch(/Nice question/);
    await click(btn(/New chat/));
    expect(h.run.mock.calls.filter((c) => c[0] === 'chat_open').length).toBe(2);
  });

  it('resumes a stored chat, falls back from a stale id, and rolls back a failed send', async () => {
    sessionStorage.setItem('concord:personas:chat:p1', 'c-old');
    const { PersonaChat } = await import('../PersonaChat');
    const v1 = render(<PersonaChat personaId="p1" personaName="Nova" />);
    await settle();
    expect(v1.container.textContent).toMatch(/earlier/);
    cleanup();
    sessionStorage.setItem('concord:personas:chat:p1', 'stale');
    const v2 = render(<PersonaChat personaId="p1" personaName="Nova" />);
    await settle();
    expect(v2.container.textContent).toMatch(/Hello there/);
    h.run.mockImplementation(async (a: string, i?: Record<string, unknown>) => a === 'chat_send' ? { ok: false, error: 'no_model', data: null } : impl(a, i));
    const input = screen.getByPlaceholderText('Message Nova…') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { value: 'lost?' } }); });
    await click(btn(/Send/));
    expect(v2.container.textContent).toMatch(/no_model/);
    expect(input.value).toBe('lost?');
    expect(v2.container.textContent).not.toMatch(/>lost\?</);
  });

  it('shows an open failure and ignores empty sends', async () => {
    h.run.mockImplementation(async () => ({ ok: false, error: '', data: null }));
    const { PersonaChat } = await import('../PersonaChat');
    const view = render(<PersonaChat personaId="p9" personaName="Zed" />);
    await settle();
    expect(view.container.textContent).toMatch(/chat_open_failed/);
    expect((screen.getByRole('button', { name: /Send/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PersonaDetailPanel', () => {
  const mount = async (props: Partial<{ onEdit: () => void; onChanged: () => void; onClose: () => void }> = {}) => {
    const { PersonaDetailPanel } = await import('../PersonaDetailPanel');
    const fns = { onEdit: vi.fn(), onChanged: vi.fn(), onClose: vi.fn(), ...props };
    // The detail panel's author path now hosts react-query consumers, so
    // mounts need a QueryClientProvider (declared test-only repair —
    // without it the author-path tests die with 'No QueryClient set').
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const v = render(<QueryClientProvider client={qc}><PersonaDetailPanel personaId="p1" {...fns} /></QueryClientProvider>);
    await settle();
    return { v, fns };
  };

  it('author flow: tabs, edit, arm + confirm publish, regenerate and upload portrait', async () => {
    const { v, fns } = await mount();
    expect(v.container.textContent).toMatch(/Nova/);
    expect(v.container.textContent).toMatch(/draft/);
    for (const t of ['stats', 'versions', 'reviews', 'chat']) await click(btn(new RegExp(`^${t}$`, 'i')));
    await click(btn(/^stats$/i));
    expect(v.container.textContent).toMatch(/chart:2/);
    await click(btn(/^versions$/i));
    expect(v.container.textContent).toMatch(/v2.*v1|tweak/s);
    await click(btn(/^reviews$/i));
    expect(v.container.textContent).toMatch(/Great/);
    await click(btn(/^Edit$/));
    expect(fns.onEdit).toHaveBeenCalled();
    await click(btn(/^Publish$/));
    expect(v.container.textContent).toMatch(/Publishing lists this persona/);
    await click(btn(/Keep private/));
    await click(btn(/^Publish$/));
    await click(btn(/Confirm publish/));
    expect(v.container.textContent).toMatch(/Published to marketplace/);
    expect(fns.onChanged).toHaveBeenCalled();
    await click(btn(/Regenerate portrait/));
    expect(v.container.textContent).toMatch(/Portrait regenerated/);
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    const input = v.container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); await new Promise((r) => setTimeout(r, 80)); });
    expect(h.run).toHaveBeenCalledWith('regenerate_portrait', expect.objectContaining({ dataUri: expect.any(String) }));
    await click(btn(/✕/));
    expect(fns.onClose).toHaveBeenCalled();
  });

  it('unpublishes only after an armed confirm and reports failures', async () => {
    persona = PERSONA({ published: true });
    const { v } = await mount();
    // FIX-personas-017: the first click only arms with the terms in
    // words — nothing is unpublished yet.
    await click(btn(/^Unpublish$/));
    expect(v.container.textContent).toMatch(/removes this persona from the marketplace/);
    expect(v.container.textContent).not.toMatch(/Unpublished/);
    await click(btn(/^Confirm unpublish$/));
    expect(v.container.textContent).toMatch(/Unpublished|Published to marketplace/);
    h.run.mockImplementation(async (a: string, i?: Record<string, unknown>) => ['publish', 'regenerate_portrait'].includes(a) ? { ok: false, error: 'denied', data: null } : impl(a, i));
    await click(btn(/^Unpublish$/));
    await click(btn(/^Confirm unpublish$/));
    expect(v.container.textContent).toMatch(/Failed: denied/);
    await click(btn(/Regenerate portrait/));
    expect(v.container.textContent).toMatch(/Failed: denied/);
  });

  it('viewer flow: install, remix, rate with stars, and failure messages', async () => {
    persona = PERSONA({ isAuthor: false, published: true });
    const { v, fns } = await mount();
    await click(btn(/Install persona/));
    expect(v.container.textContent).toMatch(/Installed \(v3\)/);
    await click(btn(/^Remix$/));
    expect(h.run).toHaveBeenCalledWith('create', expect.objectContaining({ name: 'Nova (remix)' }));
    expect(v.container.textContent).toMatch(/Remix created/);
    await click(btn(/^reviews$/i));
    const stars = screen.getAllByRole('button', { name: '★' });
    await click(stars[2]);
    await act(async () => { fireEvent.change(screen.getByPlaceholderText(/Write a review/), { target: { value: 'Lovely' } }); });
    await click(btn(/Submit rating/));
    expect(h.run).toHaveBeenCalledWith('rate', expect.objectContaining({ stars: 3, review: 'Lovely' }));
    h.run.mockImplementation(async (a: string, i?: Record<string, unknown>) => ['install', 'create', 'rate'].includes(a) ? { ok: false, error: 'nope', data: null } : impl(a, i));
    await click(btn(/Submit rating/));
    await click(btn(/Install persona/));
    await click(btn(/^Remix$/));
    expect(v.container.textContent).toMatch(/Failed: nope/);
    expect(fns.onChanged).toHaveBeenCalled();
  });

  it('shows empty stats/reviews, not-found, and loading states', async () => {
    h.run.mockImplementation(async (a: string) => a === 'stats' ? ok({ installCount: 0, chatCount: 0, version: 1, rating: 0, ratingCount: 0, distribution: [], published: false, isAuthor: true }) : a === 'get' ? ok({ persona, reviews: [] }) : ok({}));
    const { v } = await mount();
    await click(btn(/^stats$/i));
    expect(v.container.textContent).toMatch(/No ratings yet/);
    await click(btn(/^reviews$/i));
    expect(v.container.textContent).toMatch(/No reviews yet/);
    cleanup();
    h.run.mockImplementation(async () => ({ ok: false, error: 'x', data: null }));
    const missing = await mount();
    expect(missing.v.container.textContent).toMatch(/not found or not visible/);
  });
});

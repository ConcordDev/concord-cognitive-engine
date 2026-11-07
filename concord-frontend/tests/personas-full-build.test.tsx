/**
 * Personas full build (B6) — the surface legs:
 *   S1 / F1 — REAL_LIVE on the manifest entry + the scoped caption.
 *   S5 / F5 — the chat RESUMES from the server's record (chat_history)
 *   when this surface already hosted one; it does not silently open a
 *   new chat per mount.
 *   S6 / F6 — a Marketplace card carries an Install verb for another
 *   author's persona.
 *   S7 / F6 — publishing states its visibility BEFORE the act: the
 *   first click arms with the terms; only the confirm publishes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const callLog: string[] = [];
const PERSONA = {
  id: 'persona_1', name: 'Sage', tagline: 'Measured', personality: 'Exact.',
  voice: 'wise', greeting: 'Greetings.', category: 'original', tags: [],
  portrait: 'data:,', version: 1, published: false, installCount: 0,
  chatCount: 0, rating: 0, ratingCount: 0, exampleDialogue: [],
  contentHash: 'abc', isAuthor: true, authorUserId: 'me-1',
};

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me-1', username: 'tester' } }),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/personas/persona-envelope', () => ({
  runPersona: async (action: string, input: Record<string, unknown>) => {
    callLog.push(action);
    if (action === 'chat_history') {
      return { ok: true, error: null, data: { chatId: input.chatId, personaId: 'persona_1', turns: [
        { role: 'persona', text: 'Greetings.', at: 1, basis: 'greeting' },
        { role: 'user', text: 'hello sage', at: 2 },
        { role: 'persona', text: 'Well met, tester.', at: 3, basis: 'example_dialogue' },
      ] } };
    }
    if (action === 'chat_open') {
      return { ok: true, error: null, data: { chatId: 'chat_new', personaId: 'persona_1', turns: [
        { role: 'persona', text: 'Greetings.', at: 1, basis: 'greeting' },
      ] } };
    }
    if (action === 'get') return { ok: true, error: null, data: { persona: PERSONA, reviews: [] } };
    if (action === 'stats') return { ok: true, error: null, data: { installCount: 0, chatCount: 0, version: 1, rating: 0, ratingCount: 0, distribution: [], published: false, isAuthor: true } };
    if (action === 'versions') return { ok: true, error: null, data: { versions: [] } };
    if (action === 'browse') return { ok: true, error: null, data: { personas: [{ ...PERSONA, published: true, isAuthor: false, authorUserId: 'other-9' }], total: 1 } };
    if (action === 'facets') return { ok: true, error: null, data: { tags: [], categories: [] } };
    if (action === 'publish') return { ok: true, error: null, data: { personaId: 'persona_1', published: true } };
    if (action === 'install') return { ok: true, error: null, data: { personaId: 'persona_1', installCount: 1, version: 1 } };
    return { ok: true, error: null, data: {} };
  },
}));

import { PersonaChat } from '@/components/personas/PersonaChat';
import { PersonaMarketplace } from '@/components/personas/PersonaMarketplace';
import { PersonaDetailPanel } from '@/components/personas/PersonaDetailPanel';

describe('Personas declaration (S1)', () => {
  it('the manifest entry declares REAL_LIVE', () => {
    expect(getLensManifest('personas')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped store caption', () => {
    const badge = renderHook(() => useDepthBadge('personas')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/platform’s own store/);
    expect(badge?.caption).not.toMatch(/external source/);
  });
});

describe('Personas surface legs', () => {
  beforeEach(() => {
    callLog.length = 0;
    sessionStorage.clear();
    // jsdom has no Element.scrollTo; PersonaChat's scroll effect calls it.
    (Element.prototype as any).scrollTo = vi.fn();
  });

  it('S5: a stored chat id resumes its history — no new chat is opened', async () => {
    sessionStorage.setItem('concord:personas:chat:persona_1', 'chat_old');
    render(<PersonaChat personaId="persona_1" personaName="Sage" />);
    expect(await screen.findByText('Well met, tester.')).toBeTruthy();
    expect(screen.getByText('hello sage')).toBeTruthy();
    expect(callLog).toContain('chat_history');
    expect(callLog).not.toContain('chat_open');
  });

  it('S6: another author’s marketplace card carries an Install verb', async () => {
    render(<PersonaMarketplace onOpen={() => {}} />);
    const btn = await screen.findByRole('button', { name: /install sage/i });
    fireEvent.click(btn);
    await waitFor(() => { expect(callLog).toContain('install'); });
  });

  it('S7: publish states its visibility first; only the confirm publishes', async () => {
    render(<PersonaDetailPanel personaId="persona_1" onEdit={() => {}} onChanged={() => {}} onClose={() => {}} />);
    const publishBtn = await screen.findByRole('button', { name: /^publish$/i });
    fireEvent.click(publishBtn);
    expect(await screen.findByText(/anyone can find, install, rate, and remix it/)).toBeTruthy();
    expect(callLog).not.toContain('publish');
    fireEvent.click(screen.getByRole('button', { name: /confirm publish/i }));
    await waitFor(() => { expect(callLog).toContain('publish'); });
  });
});

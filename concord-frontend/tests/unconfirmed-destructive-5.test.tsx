// CB-0492 Part A — FIX-personas-017: Unpublish gains the same armed
// confirm Publish already had. This pin lives outside the shipped
// personas coverage suite because that suite is red at branch state
// for an unrelated cause (its author-path mounts lack a
// QueryClientProvider the panel now requires — verified on pristine
// panel + pristine suite: 3 failures, 'No QueryClient set').
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ actions: [] as string[] }));

vi.mock('@/components/personas/persona-envelope', () => ({
  runPersona: (action: string) => {
    h.actions.push(action);
    const persona = {
      id: 'p1', name: 'Nova', tagline: 'A helpful guide', personality: 'Curious', voice: 'warm',
      greeting: 'Hi!', category: 'guide', tags: [], portrait: '', version: 3, published: true,
      isAuthor: true, rating: 4.5, ratingCount: 2, installCount: 7, chatCount: 11, exampleDialogue: [],
    };
    if (action === 'get') return Promise.resolve({ ok: true, error: null, data: { persona, reviews: [] } });
    if (action === 'stats') return Promise.resolve({ ok: true, error: null, data: { installCount: 7, chatCount: 11, version: 3, rating: 4.5, ratingCount: 2, distribution: [], published: true, isAuthor: true } });
    if (action === 'versions') return Promise.resolve({ ok: true, error: null, data: { versions: [] } });
    if (action === 'publish') return Promise.resolve({ ok: true, error: null, data: { published: false } });
    return Promise.resolve({ ok: true, error: null, data: {} });
  },
}));

import { PersonaDetailPanel } from '@/components/personas/PersonaDetailPanel';

// jsdom has no Element.scrollTo; the panel's chat preview calls it in an
// effect, which otherwise aborts the mount commit in this environment.
Element.prototype.scrollTo = () => {};

afterEach(() => { cleanup(); h.actions.length = 0; });

describe('FIX-personas-017 unpublish armed confirm', () => {
  it('unpublish fires only after the armed confirm, with the terms shown', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PersonaDetailPanel personaId="p1" onEdit={() => {}} onChanged={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const arm = await screen.findByRole('button', { name: /^Unpublish$/ });
    fireEvent.click(arm);
    // Armed only: terms visible, no publish call yet.
    expect(await screen.findByText(/removes this persona from the marketplace/)).toBeTruthy();
    expect(h.actions).not.toContain('publish');
    fireEvent.click(screen.getByRole('button', { name: /^Confirm unpublish$/ }));
    await waitFor(() => expect(h.actions).toContain('publish'));
    expect(await screen.findByText(/Unpublished/)).toBeTruthy();
  });
});

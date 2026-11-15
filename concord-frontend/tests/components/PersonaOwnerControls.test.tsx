// PersonaOwnerControls.test.tsx
//
// FIX-personas-016: on their OWN published persona, the author got
// no Install control (detail panel + marketplace both withheld it,
// though personas.install accepts the author) and no rate control
// with no explanation (the server refuses author ratings by design,
// cannot_rate_own). Now: Install is offered on any published
// persona, author included, and the reviews tab tells the author
// why they have no rate form.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/personas/PersonaChat', () => ({ PersonaChat: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

const PERSONA = {
  id: 'per_1', name: 'Sage', tagline: 'A patient explainer', category: 'guide',
  personality: 'calm', voice: 'warm', greeting: 'Hello.', exampleDialogue: [],
  portrait: null, published: true, isAuthor: true, authorUserId: 'u1',
  rating: 0, ratingCount: 0, installCount: 2, chatCount: 5, version: 1,
  tags: [], createdAt: 1, updatedAt: 1, contentHash: 'abc',
};

vi.mock('@/components/personas/persona-envelope', () => ({
  runPersona: vi.fn(async (action: string) => {
    if (action === 'get') return { ok: true, data: { persona: PERSONA, reviews: [] } };
    if (action === 'stats') return { ok: true, data: { installCount: 2, chatCount: 5, version: 1, rating: 0, ratingCount: 0, distribution: [], published: true, isAuthor: true } };
    if (action === 'versions') return { ok: true, data: { versions: [] } };
    if (action === 'install') return { ok: true, data: { personaId: 'per_1', installCount: 3, version: 1 } };
    return { ok: true, data: {} };
  }),
}));

import { PersonaDetailPanel } from '@/components/personas/PersonaDetailPanel';

describe('Persona owner controls (FIX-personas-016)', () => {
  afterEach(() => cleanup());

  it('offers the author Install, and explains the missing rate form', async () => {
    render(React.createElement(PersonaDetailPanel, {
      personaId: 'per_1', onEdit: () => {}, onChanged: () => {}, onClose: () => {},
    }));
    expect(await screen.findByRole('button', { name: 'Install persona' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'reviews' }));
    expect(await screen.findByText(/can’t rate your own persona/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit rating' })).toBeNull();
  });
});

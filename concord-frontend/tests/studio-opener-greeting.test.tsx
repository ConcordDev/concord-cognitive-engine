/**
 * Studio Opener northstar greeting.
 *
 * The Studio concept (docs/lens-northstar/36) opens on a serif headline
 * addressed to the user — "What are we making, Ramaj" — above the
 * session surface. The Opener is that surface in the rebuilt DAW
 * (template picker + recent projects). This pins the greeting carrying
 * the signed-in username while the Opener's real states still render.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/lib/daw/studio-api', () => ({
  studioTransport: { list: () => Promise.resolve([]) },
}));

import { Opener } from '@/components/studio/daw/Opener';

describe('Studio Opener greeting', () => {
  it('greets the signed-in user by name in the serif display face', async () => {
    render(<Opener onOpenProject={() => {}} onNew={() => {}} opening={null} />);
    const greeting = await screen.findByTestId('studio-greeting');
    expect(greeting.textContent).toBe('What are we making, ramaj');
    expect(greeting.className).toContain('font-vault');
    // The real empty state still renders under the greeting.
    expect(await screen.findByText('No projects yet. Pick a template above.')).toBeTruthy();
  });
});

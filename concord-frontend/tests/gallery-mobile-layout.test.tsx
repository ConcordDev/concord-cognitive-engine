/**
 * FIX-gallery-003 — Gallery at 390px.
 *
 * The page's own fixed "Hang a work" button sat at bottom-8 — inside the
 * shell's fixed bottom-nav zone and over the open hang form's lower
 * area. It now sits on the platform's mobile CTA line
 * (bottom-[4rem+safe-area], the NorthStarFrame placement; bottom-8
 * returns at lg where the nav hides), and while the form is open the
 * page carries extra bottom padding so the last field scrolls clear.
 * The form's placeholder and the wall's standing texts move from
 * zinc-500 to zinc-400 for contrast on the black ground.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import GalleryPage from '@/app/lenses/gallery/page';

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(async (_d: string, action: string) => {
    if (action === 'collection-list') return { data: { ok: true, result: { collections: [{ id: 'col_1', artworkCount: 0 }] }, error: null } };
    if (action === 'collection-detail') return { data: { ok: true, result: { collection: { id: 'col_1', artworks: [] } }, error: null } };
    throw new Error(action);
  });
});

describe('FIX-gallery-003 — hang form vs the fixed button at 390px', () => {
  it('places the button on the mobile CTA line and pads the page while composing', async () => {
    const { container } = render(<GalleryPage />);
    const button = await screen.findByRole('button', { name: 'Hang a work' });
    expect(button.className).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]');
    expect(button.className).toContain('lg:bottom-8');
    const root = container.querySelector('[data-lens-theme="gallery"]');
    expect(root!.className).toContain('pb-28');
    fireEvent.click(button);
    const urlInput = await screen.findByTestId('gallery-image-url');
    expect(urlInput.className).toContain('placeholder:text-zinc-400');
    expect(root!.className).toContain('pb-44');
  });
});

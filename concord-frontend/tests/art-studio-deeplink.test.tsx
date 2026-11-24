// /lenses/art?artwork=<id> opens that artwork straight into the canvas
// (the link a chat drawing's "Open in Art lens" points at).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { artworks: [] } } })),
}));
vi.mock('@/components/art/ArtCanvas', () => ({
  ArtCanvas: ({ artworkId }: { artworkId: string }) => <div data-testid="art-canvas">{artworkId}</div>,
}));
vi.mock('@/components/art/ArtPalettesPanel', () => ({ ArtPalettesPanel: () => null }));
vi.mock('@/components/art/ArtReferencesPanel', () => ({ ArtReferencesPanel: () => null }));
vi.mock('@/components/art/ArtInspirePanel', () => ({ ArtInspirePanel: () => null }));
vi.mock('@/components/art/ConceptArtBoard', () => ({ ConceptArtBoard: () => null }));

import { ArtStudioSection } from '@/components/art/ArtStudioSection';

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('ArtStudioSection ?artwork= deep link', () => {
  it('opens the linked artwork in the canvas', async () => {
    window.history.replaceState({}, '', '/lenses/art?artwork=art_123');
    render(<ArtStudioSection />);
    await waitFor(() => expect(screen.getByTestId('art-canvas').textContent).toBe('art_123'));
  });

  it('opens nothing when there is no artwork param', async () => {
    window.history.replaceState({}, '', '/lenses/art');
    render(<ArtStudioSection />);
    await waitFor(() => expect(screen.queryByText(/Loading/i)).toBeNull());
    expect(screen.queryByTestId('art-canvas')).toBeNull();
  });

  it('ignores an artwork id that is not a plain id', async () => {
    window.history.replaceState({}, '', '/lenses/art?artwork=' + encodeURIComponent('../../etc/passwd'));
    render(<ArtStudioSection />);
    await waitFor(() => expect(screen.queryByText(/Loading/i)).toBeNull());
    expect(screen.queryByTestId('art-canvas')).toBeNull();
  });
});

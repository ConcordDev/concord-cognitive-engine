// art_draw: a chat drawing carries an in-app href that opens the saved
// artwork in the Art lens. The link renders only for a safe /lenses/... path.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/store/media', () => ({ useMediaStore: { getState: () => ({ play: vi.fn() }) } }));

import { ChatArtifacts } from '@/components/chat/ChatArtifacts';

const drawing = (href?: string) => ({
  kind: 'image',
  title: 'A red car',
  url: 'data:image/svg+xml;base64,PHN2Zy8+',
  prompt: 'a red car',
  ...(href === undefined ? {} : { href }),
});

describe('ChatArtifacts — Open in Art lens', () => {
  it('links a saved drawing to its artwork in the Art lens', () => {
    render(<ChatArtifacts artifacts={[drawing('/lenses/art?artwork=art_123')]} />);
    const link = screen.getByRole('link', { name: /Open in Art lens/ });
    expect(link.getAttribute('href')).toBe('/lenses/art?artwork=art_123');
  });

  it('shows the image but no link when the drawing was not saved (no href)', () => {
    render(<ChatArtifacts artifacts={[drawing()]} />);
    expect(screen.getByRole('img', { name: 'a red car' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open in Art lens/ })).toBeNull();
  });

  it('refuses hrefs that leave the app or are not a /lenses path', () => {
    for (const bad of ['https://evil.example/lenses/art', '//evil.example/x', 'javascript:alert(1)', '/api/secret', '/lenses/']) {
      const { unmount } = render(<ChatArtifacts artifacts={[drawing(bad)]} />);
      expect(screen.queryByRole('link', { name: /Open in Art lens/ }), `href ${bad}`).toBeNull();
      unmount();
    }
  });
});

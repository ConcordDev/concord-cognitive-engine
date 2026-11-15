// BrokenImageFallbacks.test.tsx
//
// The broken-image genus (FIX-gallery-001 · FIX-cooking-005 ·
// FIX-artistry-005): three surfaces rendered an <img> for an arbitrary
// external URL with no load-failure path, so a dead host / 404 / bogus
// stored URL showed the browser's broken-image glyph. Each surface
// now swaps to its designed fallback when the image errors:
//   gallery  — a labelled tile naming the host that failed;
//   cooking  — the same ChefHat tile a photo-less recipe gets;
//   artistry — the ImageIcon fallback that already covered the
//              reference-resolution failure path.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  const names = ['ChefHat', 'Loader2', 'Plus', 'Trash2', 'X', 'CalendarDays', 'ShoppingCart', 'Package',
    'Sparkles', 'BookOpen', 'Check', 'Scaling', 'FolderHeart', 'ChevronLeft', 'Image', 'ImageIcon',
    'FolderPlus', 'Search', 'Heart', 'MessageCircle', 'Eye', 'Clock', 'Award', 'Palette', 'Camera',
    'Brush', 'Music', 'Film', 'PenTool', 'Layers', 'Star', 'Share2', 'Bookmark', 'MoreHorizontal',
    'ChevronDown', 'ChevronUp', 'ChevronRight', 'Send', 'User', 'Globe', 'Lock', 'TrendingUp', 'Grid', 'List'];
  const out: Record<string, unknown> = {};
  for (const n of names) out[n] = createIcon(n);
  return out;
});
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/artistry/StudyCanvas', () => ({ StudyCanvas: () => null }));

import { WallImage } from '@/app/lenses/gallery/page';
import { RecipePhoto } from '@/components/cooking/RecipeBoxSection';
import { ResolvedImage } from '@/components/artistry/ProjectStudio';

describe('broken-image fallbacks', () => {
  afterEach(() => cleanup());

  it('gallery: a failed wall image becomes a labelled tile naming the host', () => {
    render(React.createElement(WallImage, { src: 'https://upload.wikimedia.org/dead.jpg', title: 'Starry Night' }));
    const img = screen.getByAltText('Starry Night');
    fireEvent.error(img);
    expect(screen.getByText(/Image didn’t load from upload\.wikimedia\.org/)).toBeTruthy();
    expect(screen.queryByAltText('Starry Night')).toBeNull();
  });

  it('cooking: a failed recipe photo becomes the ChefHat tile', () => {
    const { container } = render(React.createElement(RecipePhoto, { url: 'https://dead.example/soup.jpg', title: 'Soup' }));
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('icon-ChefHat')).toBeTruthy();
  });

  it('artistry: a failed cover URL becomes the ImageIcon fallback', () => {
    render(React.createElement(ResolvedImage, { src: 'https://dead.example/cover.jpg', alt: 'Case study' }));
    const img = screen.getByAltText('Case study');
    fireEvent.error(img);
    expect(screen.getByTestId('artistry-img-failed')).toBeTruthy();
    expect(screen.queryByAltText('Case study')).toBeNull();
  });
});

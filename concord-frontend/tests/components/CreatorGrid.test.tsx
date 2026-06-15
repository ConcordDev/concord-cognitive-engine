import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CreatorGrid, type CreatorGridItem } from '@/components/marketplace/CreatorGrid';

const items: CreatorGridItem[] = [
  {
    id: 'i1', title: 'Stance Against the Cold', creator: 'Aria',
    minPriceCc: 5, suggestedPriceCc: 12, royaltyRate: 0.21,
    tags: ['frost', 'combat'],
  },
  {
    id: 'i2', title: 'Twilight Commune', creator: 'Mira',
    minPriceCc: 0, suggestedPriceCc: 8, royaltyRate: 0.105,
  },
];

describe('CreatorGrid', () => {
  it('renders each item title + creator', () => {
    render(<CreatorGrid items={items} />);
    expect(screen.getByText('Stance Against the Cold')).toBeInTheDocument();
    expect(screen.getByText('Aria')).toBeInTheDocument();
    expect(screen.getByText('Twilight Commune')).toBeInTheDocument();
    expect(screen.getByText('Mira')).toBeInTheDocument();
  });

  it('calls onOpen when an item tile is clicked', () => {
    const onOpen = vi.fn();
    render(<CreatorGrid items={items} onOpen={onOpen} />);
    const titleEl = screen.getByText('Stance Against the Cold');
    const opener = titleEl.closest('button') ?? titleEl.closest('article')?.querySelector('button[aria-label^="Open"]');
    if (opener) fireEvent.click(opener);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }));
  });
});

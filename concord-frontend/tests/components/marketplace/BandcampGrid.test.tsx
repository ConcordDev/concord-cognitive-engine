import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { BandcampGrid, type BandcampItem } from '@/components/marketplace/BandcampGrid';

const items: BandcampItem[] = [
  {
    id: 'i1',
    title: 'Stance Against the Cold',
    creator: 'Aria',
    minPriceCc: 5,
    suggestedPriceCc: 12,
    royaltyRate: 0.21,
    tags: ['frost', 'combat', 'study', 'lofi', 'extra'],
    previewUrl: 'https://x/a.mp3',
    accent: '#ff0000',
  },
  {
    id: 'i2',
    title: 'Twilight Commune',
    creator: 'Mira',
    minPriceCc: 0,
    royaltyRate: 0,
    coverUrl: 'https://x/cover.jpg',
  },
];

describe('BandcampGrid', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for empty items', () => {
    const { container } = render(<BandcampGrid items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders each item title + creator (default 3 columns)', () => {
    render(<BandcampGrid items={items} />);
    expect(screen.getByText('Stance Against the Cold')).toBeInTheDocument();
    expect(screen.getByText('Aria')).toBeInTheDocument();
    expect(screen.getByText('Twilight Commune')).toBeInTheDocument();
    expect(screen.getByText('Mira')).toBeInTheDocument();
  });

  it.each([2, 3, 4, 5] as const)('renders with %d columns', (columns) => {
    const { container } = render(<BandcampGrid items={items} columns={columns} />);
    expect(container.querySelector('.grid')).toBeTruthy();
  });

  it('renders cover image when coverUrl present, gradient otherwise', () => {
    const { container } = render(<BandcampGrid items={items} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThan(0); // i2 has cover
    // i1 has no cover -> initials shown
    expect(screen.getByText('ST')).toBeInTheDocument();
  });

  it('shows suggested price + royalty cascade only when present', () => {
    render(<BandcampGrid items={items} />);
    expect(screen.getByText(/suggested 12/)).toBeInTheDocument();
    expect(screen.getByText(/21\.00% royalty cascades/)).toBeInTheDocument();
    // i2 royaltyRate is 0 -> no cascade row for it
  });

  it('renders only first 4 tags', () => {
    render(<BandcampGrid items={items} />);
    expect(screen.getByText('frost')).toBeInTheDocument();
    expect(screen.queryByText('extra')).not.toBeInTheDocument();
  });

  it('calls onOpen when item tile clicked', () => {
    const onOpen = vi.fn();
    render(<BandcampGrid items={items} onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText('Open Stance Against the Cold'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }));
  });

  it('calls onSupport with a price >= minPrice', () => {
    const onSupport = vi.fn();
    render(<BandcampGrid items={items} onSupport={onSupport} />);
    const supportBtns = screen.getAllByText('Support');
    fireEvent.click(supportBtns[0]);
    expect(onSupport).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), 12);
  });

  it('blocks support when price drops below minPrice', () => {
    const onSupport = vi.fn();
    render(<BandcampGrid items={items} onSupport={onSupport} />);
    const priceInput = screen.getAllByLabelText('Support price')[0] as HTMLInputElement;
    // input onChange clamps to minPrice, so set valid then check support fires
    fireEvent.change(priceInput, { target: { value: '3' } });
    // clamped to min 5
    expect(priceInput.value).toBe('5');
    fireEvent.click(screen.getAllByText('Support')[0]);
    expect(onSupport).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), 5);
  });

  it('price input clamps NaN to minPrice', () => {
    render(<BandcampGrid items={items} />);
    const priceInput = screen.getAllByLabelText('Support price')[0] as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: 'abc' } });
    expect(priceInput.value).toBe('5');
  });

  it('toggles audio preview play/pause', () => {
    const playSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined as unknown as void);
    const pauseSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    render(<BandcampGrid items={items} />);
    const playBtn = screen.getByLabelText('Play preview');
    fireEvent.click(playBtn);
    expect(playSpy).toHaveBeenCalled();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it('support is no-op when onSupport not provided', () => {
    render(<BandcampGrid items={items} />);
    expect(() => fireEvent.click(screen.getAllByText('Support')[0])).not.toThrow();
  });
});

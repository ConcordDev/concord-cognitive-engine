import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('next/image', () => ({
  default: (p: Record<string, unknown>) => React.createElement('img', { src: p.src, alt: p.alt }),
}));

import { ListingPhotoGallery } from '@/components/realestate/ListingPhotoGallery';

const PHOTOS = [
  { id: 'p1', url: 'https://x/1.jpg', caption: 'Front', room: 'Exterior', addedAt: '2026-05-01' },
  { id: 'p2', url: 'https://x/2.jpg', caption: 'Kitchen view', room: 'Kitchen', addedAt: '2026-05-02' },
];

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('ListingPhotoGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { photos: [] } } });
  });

  it('shows the select-a-listing placeholder without a listingId', () => {
    render(<ListingPhotoGallery />);
    expect(screen.getByText(/Select a listing to manage its photo gallery/)).toBeInTheDocument();
  });

  it('shows the no-photos empty state', async () => {
    render(<ListingPhotoGallery listingId="L1" />);
    expect(await screen.findByText(/No photos yet/)).toBeInTheDocument();
  });

  it('renders photos and the tour open link', async () => {
    route(() => ({ data: { ok: true, result: { photos: PHOTOS, virtualTourUrl: 'https://tour.com/x' } } }));
    render(<ListingPhotoGallery listingId="L1" />);
    expect(await screen.findByText('2 photos')).toBeInTheDocument();
    expect(screen.getByText('Front')).toBeInTheDocument();
    expect(screen.getByText('Open tour')).toBeInTheDocument();
  });

  it('navigates between photos with prev/next arrows', async () => {
    route(() => ({ data: { ok: true, result: { photos: PHOTOS, virtualTourUrl: '' } } }));
    render(<ListingPhotoGallery listingId="L1" />);
    await screen.findByText('2 photos');
    const main = document.querySelector('.aspect-video img') as HTMLImageElement;
    expect(main.getAttribute('src')).toBe('https://x/1.jpg');
    const arrows = document.querySelectorAll('.aspect-video button');
    fireEvent.click(arrows[1]);
    await waitFor(() => {
      const m2 = document.querySelector('.aspect-video img') as HTMLImageElement;
      expect(m2.getAttribute('src')).toBe('https://x/2.jpg');
    });
    fireEvent.click(arrows[0]);
    await waitFor(() => {
      const m3 = document.querySelector('.aspect-video img') as HTMLImageElement;
      expect(m3.getAttribute('src')).toBe('https://x/1.jpg');
    });
  });

  it('adds a photo through the add form', async () => {
    route((action) => {
      if (action === 'listing-photos-list') return { data: { ok: true, result: { photos: [] } } };
      return { data: { ok: true } };
    });
    render(<ListingPhotoGallery listingId="L1" />);
    await screen.findByText(/No photos yet/);
    fireEvent.click(screen.getByTitle('Add photo'));
    fireEvent.change(screen.getByPlaceholderText(/Image URL/), { target: { value: 'https://x/new.jpg' } });
    fireEvent.change(screen.getByPlaceholderText('Room'), { target: { value: 'Den' } });
    fireEvent.change(screen.getByPlaceholderText('Caption'), { target: { value: 'cozy' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'listing-photos-add',
          input: { listingId: 'L1', url: 'https://x/new.jpg', caption: 'cozy', room: 'Den' },
        }),
      ),
    );
  });

  it('surfaces an error when add fails', async () => {
    route((action) => {
      if (action === 'listing-photos-list') return { data: { ok: true, result: { photos: [] } } };
      return { data: { ok: false, error: 'bad url' } };
    });
    render(<ListingPhotoGallery listingId="L1" />);
    await screen.findByText(/No photos yet/);
    fireEvent.click(screen.getByTitle('Add photo'));
    fireEvent.change(screen.getByPlaceholderText(/Image URL/), { target: { value: 'https://x/new.jpg' } });
    fireEvent.click(screen.getByText('Add'));
    expect(await screen.findByText('bad url')).toBeInTheDocument();
  });

  it('deletes a photo', async () => {
    route((action) => {
      if (action === 'listing-photos-list') return { data: { ok: true, result: { photos: PHOTOS } } };
      return { data: { ok: true } };
    });
    render(<ListingPhotoGallery listingId="L1" />);
    await screen.findByText('2 photos');
    fireEvent.click(screen.getAllByLabelText('Delete photo')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listing-photos-delete', input: { listingId: 'L1', photoId: 'p1' } }),
      ),
    );
  });

  it('saves the virtual tour url', async () => {
    route((action) => {
      if (action === 'listing-photos-list') return { data: { ok: true, result: { photos: PHOTOS, virtualTourUrl: '' } } };
      return { data: { ok: true, result: { virtualTourUrl: 'https://new-tour.com' } } };
    });
    render(<ListingPhotoGallery listingId="L1" />);
    await screen.findByText('2 photos');
    fireEvent.change(screen.getByPlaceholderText('https://my3dtour.com/...'), { target: { value: 'https://new-tour.com' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listing-tour-set', input: { listingId: 'L1', virtualTourUrl: 'https://new-tour.com' } }),
      ),
    );
    expect(await screen.findByText('Open tour')).toBeInTheDocument();
  });

  it('surfaces an error when saving the tour fails', async () => {
    route((action) => {
      if (action === 'listing-photos-list') return { data: { ok: true, result: { photos: PHOTOS } } };
      return { data: { ok: false, error: 'invalid tour' } };
    });
    render(<ListingPhotoGallery listingId="L1" />);
    await screen.findByText('2 photos');
    fireEvent.change(screen.getByPlaceholderText('https://my3dtour.com/...'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('invalid tour')).toBeInTheDocument();
  });

  it('tolerates a list fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ListingPhotoGallery listingId="L1" />);
    expect(await screen.findByText(/No photos yet/)).toBeInTheDocument();
  });
});

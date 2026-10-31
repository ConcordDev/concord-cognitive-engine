/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DTUExportButton } from './DTUExportButton';

// Q16: DTUExportButton must never wrap an empty payload in a .dtu and
// call it an export. With no prepare and data={{}} (32 call sites), it
// loads the lens's real export rows (Q79) at click time; with no rows
// either, it refuses with a toast and downloads nothing.

const get = vi.fn();
const post = vi.fn();
const addToast = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
}));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  addToast.mockReset();
  post.mockResolvedValue({ data: new Blob(['dtu-bytes']) });
  // jsdom has no object-URL implementation; the component only needs
  // the pair to exist so the download anchor can be built and revoked.
  const urlStatics = URL as unknown as { createObjectURL: unknown; revokeObjectURL: unknown };
  urlStatics.createObjectURL = vi.fn(() => 'blob:fake');
  urlStatics.revokeObjectURL = vi.fn();
});

describe('DTUExportButton (Q16)', () => {
  it('empty data falls back to the lens export rows and puts them in the .dtu payload', async () => {
    get.mockResolvedValue({
      data: { artifacts: [{ id: 'e1', type: 'event', title: 'Dentist appointment' }], total: 1 },
    });
    render(<DTUExportButton domain="calendar" data={{}} compact />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith('/api/lens/calendar/export', { params: { limit: 1000 } });
    const body = post.mock.calls[0][1] as { data: { source?: string; items?: { title: string }[] } };
    expect(body.data.source).toBe('lens-export');
    expect(body.data.items?.[0].title).toBe('Dentist appointment');
    expect(addToast).not.toHaveBeenCalled();
  });

  it('empty data and zero export rows: honest toast, no download', async () => {
    get.mockResolvedValue({ data: { artifacts: [], total: 0 } });
    render(<DTUExportButton domain="bio" data={{}} compact />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addToast.mock.calls[0][0].type).toBe('error');
    expect(addToast.mock.calls[0][0].message).toMatch(/Nothing to export/);
    expect(post).not.toHaveBeenCalled();
  });

  it('real data exports as-is and never touches the export read', async () => {
    render(<DTUExportButton domain="music" data={{ track: 'Song', plays: 3 }} compact />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(get).not.toHaveBeenCalled();
    const body = post.mock.calls[0][1] as { data: unknown };
    expect(body.data).toEqual({ track: 'Song', plays: 3 });
  });

  it('prepare still wins over the fallback', async () => {
    const prepare = vi.fn(async () => ({ study: 'prepared' }));
    render(<DTUExportButton domain="conkay" data={{}} prepare={prepare} compact />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    const body = post.mock.calls[0][1] as { data: unknown };
    expect(body.data).toEqual({ study: 'prepared' });
  });

  it('a failed export read toasts an error and downloads nothing', async () => {
    get.mockRejectedValue(new Error('network down'));
    render(<DTUExportButton domain="eco" data={{}} compact />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addToast.mock.calls[0][0].message).toMatch(/could not load/);
    expect(post).not.toHaveBeenCalled();
  });
});

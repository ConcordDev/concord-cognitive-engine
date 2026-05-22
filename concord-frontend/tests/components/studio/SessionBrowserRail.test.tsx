import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, renderWithClient } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import SessionBrowserRail from '@/components/studio/SessionBrowserRail';

beforeEach(() => { lensRun.mockReset(); });

describe('SessionBrowserRail', () => {
  it('renders the browser header + tabs and loops results', async () => {
    lensRun.mockResolvedValue(okResult({ items: [
      { id: 'l1', title: 'Funk Loop', bpm: 110, key: 'Am' },
      { id: 'l2', title: 'House Loop', bpm: 124 },
    ] }));
    renderWithClient(<SessionBrowserRail />);
    expect(screen.getByText('Browser')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Funk Loop')).toBeInTheDocument());
    expect(screen.getByText(/110 BPM/)).toBeInTheDocument();
  });

  it('shows the empty state for a tab with no assets', async () => {
    lensRun.mockResolvedValue(okResult({ items: [] }));
    renderWithClient(<SessionBrowserRail />);
    await waitFor(() => expect(screen.getByText(/No loops yet/)).toBeInTheDocument());
  });

  it('switches to the DTU tab and filters by kind keyword', async () => {
    lensRun.mockImplementation((spec: { domain: string }) => {
      if (spec.domain === 'dtu') {
        return Promise.resolve(okResult({ items: [
          { id: 'd1', title: 'Drum DTU', kind: 'music_dtu' },
          { id: 'd2', title: 'Essay', kind: 'text_dtu' },
        ] }));
      }
      return Promise.resolve(okResult({ items: [] }));
    });
    renderWithClient(<SessionBrowserRail />);
    fireEvent.click(screen.getByText('DTUs'));
    await waitFor(() => expect(screen.getByText('Drum DTU')).toBeInTheDocument());
    // 'Essay' fails the audio/music keyword filter
    expect(screen.queryByText('Essay')).not.toBeInTheDocument();
  });

  it('searches within loaded assets', async () => {
    lensRun.mockResolvedValue(okResult({ items: [
      { id: 'l1', title: 'Funk Loop' },
      { id: 'l2', title: 'House Loop' },
    ] }));
    renderWithClient(<SessionBrowserRail />);
    await waitFor(() => expect(screen.getByText('Funk Loop')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'house' } });
    expect(screen.queryByText('Funk Loop')).not.toBeInTheDocument();
    expect(screen.getByText('House Loop')).toBeInTheDocument();
  });

  it('shows the no-matches message when search excludes everything', async () => {
    lensRun.mockResolvedValue(okResult({ items: [{ id: 'l1', title: 'Funk Loop' }] }));
    renderWithClient(<SessionBrowserRail />);
    await waitFor(() => expect(screen.getByText('Funk Loop')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('switches to the Stems tab', async () => {
    lensRun.mockResolvedValue(okResult({ stems: [{ id: 's1', title: 'Vox Stem' }] }));
    renderWithClient(<SessionBrowserRail />);
    fireEvent.click(screen.getByText('Stems'));
    await waitFor(() => expect(screen.getByText('Vox Stem')).toBeInTheDocument());
  });

  it('sets a drag payload on dragstart', async () => {
    lensRun.mockResolvedValue(okResult({ items: [{ id: 'l1', title: 'Funk Loop', kind: 'loops' }] }));
    renderWithClient(<SessionBrowserRail />);
    await waitFor(() => expect(screen.getByText('Funk Loop')).toBeInTheDocument());
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByText('Funk Loop').closest('li')!, {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith('application/x-concord-asset', expect.stringContaining('l1'));
  });

  it('survives a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('net'));
    renderWithClient(<SessionBrowserRail />);
    await waitFor(() => expect(screen.getByText(/No loops yet/)).toBeInTheDocument());
  });
});

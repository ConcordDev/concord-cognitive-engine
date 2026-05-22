import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async (importOriginal) => {
  const ReactM = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = ReactM.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactM.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Stub the heavy sub-panels — they have their own tests.
vi.mock('@/components/music/MusicLibraryPanel', () => ({
  MusicLibraryPanel: ({ onChange }: { onChange: () => void }) =>
    React.createElement('div', { 'data-testid': 'library-panel', onClick: onChange }, 'library'),
}));
vi.mock('@/components/music/MusicPlayerPanel', () => ({
  MusicPlayerPanel: () => React.createElement('div', { 'data-testid': 'player-panel' }, 'player'),
}));
vi.mock('@/components/music/MusicStatsPanel', () => ({
  MusicStatsPanel: () => React.createElement('div', { 'data-testid': 'stats-panel' }, 'stats'),
}));
vi.mock('@/components/music/MusicRadioPanel', () => ({
  MusicRadioPanel: () => React.createElement('div', { 'data-testid': 'radio-panel' }, 'radio'),
}));
vi.mock('@/components/music/MusicParityPanel', () => ({
  MusicParityPanel: () => React.createElement('div', { 'data-testid': 'parity-panel' }, 'parity'),
}));

import { MusicStreamingSection } from '@/components/music/MusicStreamingSection';

describe('MusicStreamingSection', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows loading then dashboard stats when result is populated', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { tracks: 12, liked: 3, playlists: 2, following: 4, totalPlays: 88, listenedHours: 5, queued: 1 } },
    });
    render(<MusicStreamingSection />);
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.getByText('Tracks')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByTestId('library-panel')).toBeInTheDocument();
  });

  it('renders no stat strip when dashboard result is empty/null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<MusicStreamingSection />);
    await waitFor(() => expect(screen.getByTestId('library-panel')).toBeInTheDocument());
    expect(screen.queryByText('Tracks')).not.toBeInTheDocument();
  });

  it('switches tabs to player, radio, stats and pro panels', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<MusicStreamingSection />);
    await waitFor(() => expect(screen.getByTestId('library-panel')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Now Playing'));
    expect(screen.getByTestId('player-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Radio & DJ'));
    expect(screen.getByTestId('radio-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Stats & Discover'));
    expect(screen.getByTestId('stats-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Pro Suite'));
    expect(screen.getByTestId('parity-panel')).toBeInTheDocument();
  });

  it('child onChange triggers a dashboard refresh', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<MusicStreamingSection />);
    await waitFor(() => expect(screen.getByTestId('library-panel')).toBeInTheDocument());
    const callsBefore = lensRun.mock.calls.length;
    fireEvent.click(screen.getByTestId('library-panel'));
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

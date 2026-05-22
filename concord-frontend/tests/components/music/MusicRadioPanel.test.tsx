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

import { MusicRadioPanel } from '@/components/music/MusicRadioPanel';

const settings = { crossfadeSec: 4, gapless: true, normalize: false, quality: 'high', monoAudio: false };

function routeMock(over: Record<string, unknown> = {}) {
  lensRun.mockImplementation(async (_d: string, macro: string) => {
    const map: Record<string, unknown> = {
      'genre-hub': { data: { ok: true, result: { genres: [{ genre: 'pop', trackCount: 8, totalPlays: 30, liked: 2 }] } } },
      'audio-settings-get': { data: { ok: true, result: { settings } } },
      'radio-status': { data: { ok: true, result: { station: null } } },
      'sleep-timer-get': { data: { ok: true, result: { active: false } } },
      'smart-shuffle': { data: { ok: true, result: { tracks: [{ id: 's1', title: 'Shuf', artist: 'A', genre: 'pop', durationSec: 120 }], dj: 'Here we go' } } },
      'radio-start': { data: { ok: true, result: { station: { label: 'Pop Radio', trackCount: 5 } } } },
      'sleep-timer-set': { data: { ok: true, result: {} } },
      'sleep-timer-cancel': { data: { ok: true, result: {} } },
      'blend': { data: { ok: true, result: { trackCount: 7 } } },
      'audio-settings-set': { data: { ok: true, result: { settings: { ...settings, gapless: false } } } },
      ...over,
    };
    return map[macro] ?? { data: { ok: true, result: {} } };
  });
}

describe('MusicRadioPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders DJ, radio, sleep timer, blend, genres and audio settings', async () => {
    routeMock();
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/AI DJ/)).toBeInTheDocument());
    expect(screen.getByText('Radio')).toBeInTheDocument();
    expect(screen.getByText('Sleep Timer')).toBeInTheDocument();
    expect(screen.getByText('Blend')).toBeInTheDocument();
    expect(screen.getByText('pop')).toBeInTheDocument();
    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  it('starting a DJ session populates tracks and the dj line', async () => {
    const onChange = vi.fn();
    routeMock();
    render(<MusicRadioPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('Start a DJ session')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start a DJ session'));
    await waitFor(() => expect(screen.getByText(/Here we go/)).toBeInTheDocument());
    // DJ track row renders "Shuf" + duration 2:00
    expect(screen.getByText('2:00')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it('DJ failure surfaces the error message', async () => {
    routeMock({ 'smart-shuffle': { data: { ok: false, error: 'need 2+ tracks' } } });
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Start a DJ session')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start a DJ session'));
    await waitFor(() => expect(screen.getByText(/need 2\+ tracks/)).toBeInTheDocument());
  });

  it('tuning a station by genre seed shows the on-air banner', async () => {
    routeMock();
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Seed a station/)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Seed a station/), { target: { value: 'Pop' } });
    fireEvent.click(screen.getByText('Tune in'));
    await waitFor(() => expect(screen.getByText('Pop Radio')).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledWith('music', 'radio-start', { seedGenre: 'pop' });
  });

  it('Enter key in the radio seed input starts the station', async () => {
    routeMock();
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Seed a station/)).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/Seed a station/);
    fireEvent.change(input, { target: { value: 'jazz' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'radio-start', { seedGenre: 'jazz' }));
  });

  it('clicking a genre tile starts a genre radio', async () => {
    routeMock();
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('pop')).toBeInTheDocument());
    fireEvent.click(screen.getByText('pop'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'radio-start', { seedGenre: 'pop' }));
  });

  it('setting the sleep timer reflects the active state', async () => {
    routeMock({
      'sleep-timer-get': { data: { ok: true, result: { active: false } } },
    });
    let timerActive = false;
    lensRun.mockImplementation(async (_d: string, macro: string, input?: Record<string, unknown>) => {
      if (macro === 'sleep-timer-set') { timerActive = true; return { data: { ok: true, result: {} } }; }
      if (macro === 'sleep-timer-get') return { data: { ok: true, result: timerActive ? { active: true, remainingMin: 30 } : { active: false } } };
      if (macro === 'genre-hub') return { data: { ok: true, result: { genres: [] } } };
      if (macro === 'audio-settings-get') return { data: { ok: true, result: { settings } } };
      if (macro === 'radio-status') return { data: { ok: true, result: { station: null } } };
      void input;
      return { data: { ok: true, result: {} } };
    });
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Set timer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Set timer'));
    await waitFor(() => expect(screen.getByText(/Stops in/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.getByText('Set timer')).toBeInTheDocument());
  });

  it('making a Blend shows the result message', async () => {
    routeMock();
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Create a Blend')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create a Blend'));
    await waitFor(() => expect(screen.getByText(/7 tracks/)).toBeInTheDocument());
  });

  it('Blend failure shows the fallback error text', async () => {
    routeMock({ 'blend': { data: { ok: false, error: 'need liked tracks' } } });
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Create a Blend')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create a Blend'));
    await waitFor(() => expect(screen.getByText('need liked tracks')).toBeInTheDocument());
  });

  it('changing crossfade, quality and a toggle updates settings', async () => {
    routeMock();
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Audio')).toBeInTheDocument());
    const ranges = screen.getAllByRole('slider');
    fireEvent.change(ranges[0], { target: { value: '8' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'audio-settings-set', { crossfadeSec: 8 }));
    // quality select is the last combobox (the first is the sleep-timer one)
    const combos = screen.getAllByRole('combobox');
    fireEvent.change(combos[combos.length - 1], { target: { value: 'lossless' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'audio-settings-set', { quality: 'lossless' }));
    // toggle gapless — sends a single { gapless: <bool> } patch
    const gaplessRow = screen.getByText('Gapless playback').closest('label')!;
    fireEvent.click(gaplessRow.querySelector('button')!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'audio-settings-set', expect.objectContaining({ gapless: expect.any(Boolean) }))
    );
    // toggle normalize too — exercises the other toggle branch
    const normRow = screen.getByText('Normalize volume').closest('label')!;
    fireEvent.click(normRow.querySelector('button')!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'audio-settings-set', expect.objectContaining({ normalize: expect.any(Boolean) }))
    );
  });

  it('shows the empty-genre hint when no genres exist', async () => {
    routeMock({ 'genre-hub': { data: { ok: true, result: { genres: [] } } } });
    render(<MusicRadioPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/populate genres/)).toBeInTheDocument());
  });
});

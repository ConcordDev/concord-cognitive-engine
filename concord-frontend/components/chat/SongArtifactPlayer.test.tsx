import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({
  play: vi.fn(),
  renderSongToWav: vi.fn(),
  lensRun: vi.fn(),
}));

vi.mock('@/store/media', () => ({
  useMediaStore: Object.assign(() => ({}), { getState: () => ({ play: h.play }) }),
}));
vi.mock('@/lib/daw/render-song', () => ({
  renderSongToWav: (...args: unknown[]) => h.renderSongToWav(...args),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => h.lensRun(...args),
}));

import { SongArtifactPlayer } from './SongArtifactPlayer';

function makeArtifact(overrides = {}) {
  return {
    kind: 'song' as const,
    projectId: 'proj_test',
    title: 'Test Song',
    bpm: 90,
    key: 'C',
    durationSec: 8,
    song: {
      title: 'Test Song', genre: 'lofi', bpm: 90, key: 'C', scale: 'major',
      bars: 4, durationSec: 8, tracks: [],
      drums: { steps: 16, stepBeats: 0.25, lanes: [] },
    },
    ...overrides,
  };
}

beforeEach(() => {
  h.play.mockClear();
  h.lensRun.mockReset();
  h.renderSongToWav.mockReset();
  h.renderSongToWav.mockResolvedValue({ blob: new Blob(['RIFF'], { type: 'audio/wav' }) });
  global.URL.createObjectURL = vi.fn(() => 'blob:test');
  global.URL.revokeObjectURL = vi.fn();
});

describe('SongArtifactPlayer', () => {
  it('links Open in Studio to /lenses/studio?project=<id>', () => {
    const { container } = render(<SongArtifactPlayer artifact={makeArtifact()} />);
    const link = container.querySelector('a[href^="/lenses/studio?project="]');
    expect(link?.getAttribute('href')).toBe('/lenses/studio?project=proj_test');
  });

  it('renders on mount and shows an inline audio player with the WAV', async () => {
    const { findByTestId } = render(<SongArtifactPlayer artifact={makeArtifact()} />);
    const audio = await findByTestId('song-audio');
    expect(audio.getAttribute('src')).toBe('blob:test');
    expect(h.renderSongToWav).toHaveBeenCalledTimes(1);
  });

  it('sends the rendered song to the global mini-player on first click', async () => {
    const { getByTitle } = render(<SongArtifactPlayer artifact={makeArtifact()} />);
    fireEvent.click(getByTitle('Play in mini-player'));
    await waitFor(() => expect(h.play).toHaveBeenCalledTimes(1));
    expect(h.play.mock.calls[0][0]).toMatchObject({ src: 'blob:test', title: 'Test Song', lens: 'chat' });
    expect(h.play.mock.calls[0][0].id).toBeTruthy();
    expect(h.renderSongToWav).toHaveBeenCalledTimes(1);
  });

  it('saves via studio.bounce with a base64 audio data URL and shows the stored link', async () => {
    h.lensRun.mockResolvedValue({ data: { ok: true, result: { render: { downloadUrl: '/api/artifacts/a1/download' } }, error: null } });
    const { findByTestId, getByTitle, findByText } = render(<SongArtifactPlayer artifact={makeArtifact()} />);
    await findByTestId('song-audio');
    fireEvent.click(getByTitle('Save the rendered WAV to your Concord Studio project'));
    await waitFor(() => expect(h.lensRun).toHaveBeenCalled());
    const [domain, action, input] = h.lensRun.mock.calls[0];
    expect(domain).toBe('studio');
    expect(action).toBe('bounce');
    expect(input.projectId).toBe('proj_test');
    expect(String(input.audioDataUrl)).toMatch(/^data:audio\/wav;base64,/);
    const link = await findByText('download saved WAV');
    expect(link.getAttribute('href')).toBe('/api/artifacts/a1/download');
  });

  it('shows an honest error when save fails', async () => {
    h.lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'project not found' } });
    const { findByTestId, getByTitle, findByText } = render(<SongArtifactPlayer artifact={makeArtifact()} />);
    await findByTestId('song-audio');
    fireEvent.click(getByTitle('Save the rendered WAV to your Concord Studio project'));
    expect(await findByText('project not found')).toBeTruthy();
  });

  it('shows the render error instead of a player when rendering fails', async () => {
    h.renderSongToWav.mockRejectedValue(new Error('OfflineAudioContext unavailable'));
    const { findByText, queryByTestId } = render(<SongArtifactPlayer artifact={makeArtifact()} />);
    expect(await findByText('OfflineAudioContext unavailable')).toBeTruthy();
    expect(queryByTestId('song-audio')).toBeNull();
  });
});

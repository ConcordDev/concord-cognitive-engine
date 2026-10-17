/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * INC-127 part 2: AgentModePanel renders studio.compose `song` artifacts via
 * SongArtifactPlayer and real audio URLs via inline <audio>.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/store/media', () => ({
  useMediaStore: () => ({ play: vi.fn() }),
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: { render: { downloadUrl: '/api/artifacts/saved/download' } } } })),
}));

vi.mock('@/lib/daw/render-song', () => ({
  renderSongToWav: vi.fn(() => Promise.resolve({
    blob: new Blob(['RIFF'], { type: 'audio/wav' }),
    buffer: { duration: 5, sampleRate: 44100 },
    durationSec: 4,
  })),
}));

import AgentModePanel from './AgentModePanel';

function mockFetch(artifacts: unknown[]) {
  const response = {
    ok: true,
    json: () => Promise.resolve({
      ok: true,
      result: {
        ok: true,
        answer: 'Here is your music.',
        toolCalls: [],
        artifacts,
      },
    }),
  } as Response;
  global.fetch = vi.fn(() => Promise.resolve(response));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AgentModePanel audio/song artifacts', () => {
  it('renders SongArtifactPlayer for a kind:song artifact', async () => {
    mockFetch([
      {
        kind: 'song',
        projectId: 'proj_agent_1',
        title: 'Agent Lo-fi Beat',
        bpm: 90,
        key: 'C',
        durationSec: 16,
        song: {
          title: 'Agent Lo-fi Beat',
          genre: 'lofi',
          bpm: 90,
          key: 'C',
          scale: 'major',
          bars: 8,
          durationSec: 16,
          tracks: [],
          drums: { steps: 16, stepBeats: 0.25, lanes: [] },
        },
      },
    ]);

    render(<AgentModePanel open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Tell Concord to do something/), {
      target: { value: 'compose a lo-fi beat' },
    });
    fireEvent.click(screen.getByTitle('Send (⌘↵)'));

    await waitFor(() => expect(screen.getByText('Agent Lo-fi Beat')).toBeInTheDocument());
    expect(screen.getByText('Open in Studio')).toBeInTheDocument();
    expect(screen.getByText('Save to Concord')).toBeInTheDocument();
  });

  it('renders an inline <audio> player for a kind:audio artifact', async () => {
    mockFetch([
      {
        kind: 'audio',
        url: 'https://audio-ssl.itunes.apple.com/preview.m4a',
        title: 'Lofi Dreams',
        artist: 'Artist',
        mimeType: 'audio/mp4',
      },
    ]);

    render(<AgentModePanel open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Tell Concord to do something/), {
      target: { value: 'find a preview' },
    });
    fireEvent.click(screen.getByTitle('Send (⌘↵)'));

    await waitFor(() => expect(screen.getByText('Lofi Dreams')).toBeInTheDocument());
    expect(screen.getByText('Artist')).toBeInTheDocument();
    expect(document.querySelector('audio[src="https://audio-ssl.itunes.apple.com/preview.m4a"]')).toBeInTheDocument();
  });
});

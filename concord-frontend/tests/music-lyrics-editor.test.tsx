/** MusicPlayerPanel lyrics editor — timed [m:ss] lines save as synced lines; plain text saves as-is. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { MusicPlayerPanel } from '@/components/music/MusicPlayerPanel';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    const r: Record<string, unknown> = {
      'now-playing': { nowPlaying: { track: { id: 't1', title: 'Song', artist: 'A', durationSec: 200 }, positionSec: 0 } },
      'queue-list': { tracks: [] }, 'recently-played': { tracks: [] },
      'track-lyrics-get': { lyrics: [], synced: false },
    };
    return Promise.resolve({ data: { ok: true, result: r[action] ?? {} } });
  });
});

describe('MusicPlayerPanel lyrics editor', () => {
  it('saves fully stamped lines as timed lyrics', async () => {
    render(<MusicPlayerPanel onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /add lyrics/i }));
    fireEvent.change(screen.getByLabelText('Lyrics'), { target: { value: '[0:05.50] Hello\n[1:02] World' } });
    fireEvent.click(screen.getByRole('button', { name: /save lyrics/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('music', 'track-lyrics-set', {
      id: 't1', lyrics: [{ timeSec: 5.5, line: 'Hello' }, { timeSec: 62, line: 'World' }],
    }));
  });

  it('saves unstamped text as plain lyrics', async () => {
    render(<MusicPlayerPanel onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /add lyrics/i }));
    fireEvent.change(screen.getByLabelText('Lyrics'), { target: { value: 'Hello\n[0:03] World' } });
    fireEvent.click(screen.getByRole('button', { name: /save lyrics/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('music', 'track-lyrics-set', { id: 't1', lyrics: 'Hello\n[0:03] World' }));
  });
});

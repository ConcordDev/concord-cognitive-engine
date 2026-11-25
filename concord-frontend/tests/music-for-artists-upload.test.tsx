// For Artists upload: the song picker has to open on iPhone Safari (a
// display:none file input ignores a scripted click), measuring must not
// block the upload, and a file over the edge limit is refused in words.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
let handler: (
  action: string,
  input: Record<string, unknown>
) => { data: { ok: boolean; result: unknown; error: string | null } };
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_d: string, action: string, input: Record<string, unknown>) => {
    calls.push({ action, input });
    return handler(action, input);
  }),
}));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));

const analyzeFile = vi.hoisted(() => vi.fn());
const uploadTrackFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/music/analyze', () => ({ analyzeFile }));
vi.mock('@/components/music/liner/linerApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/music/liner/linerApi')>();
  return { ...actual, uploadTrackFile };
});

import { ANALYSIS_BUDGET_MS, ForArtists } from '@/components/music/liner/ForArtists';
import {
  MAX_TRACK_UPLOAD_BYTES,
  trackTooLargeMessage,
  type Release,
} from '@/components/music/liner/linerApi';

const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });

function draft(over: Partial<Release> = {}): Release {
  return {
    id: 'rel_d',
    title: 'Draft',
    type: 'single',
    genre: null,
    note: '',
    credits: [],
    coverDtuId: null,
    coverUrl: null,
    priceCC: 0,
    streaming: 'full',
    previewSec: 30,
    status: 'draft',
    releaseDate: '2026-11-23',
    publishedAt: null,
    owned: true,
    remixOf: [],
    remixes: [],
    artist: { handle: 'me', key: 'a_me', name: 'me', isMe: true },
    tracks: [],
    durationSec: 0,
    sales: 0,
    ...over,
  };
}

function renderEditor() {
  const rel = draft();
  handler = (action, input) => {
    if (action === 'release-list-mine')
      return ok({ releases: [rel], artist: rel.artist, salesGrossCC: 0, creatorPoolCC: 0 });
    if (action === 'artist-profile-get') return ok({ profile: { bio: '', links: [] } });
    if (action === 'release-add-track') {
      return ok({
        release: draft({
          tracks: [
            {
              mediaId: String(input.mediaId),
              title: String(input.title),
              durationSec: null,
              explicit: false,
              bpm: (input.bpm as number | null) ?? null,
              key: (input.key as string | null) ?? null,
              lufs: (input.lufs as number | null) ?? null,
              plays: 0,
              streamUrl: '/api/media/m/stream',
              fullStream: true,
            },
          ],
        }),
      });
    }
    return { data: { ok: false, result: null, error: `unexpected ${action}` } };
  };
  render(
    <ForArtists onRelease={() => {}} onArtist={() => {}} focusId="rel_d" onFocus={() => {}} />
  );
}

function fileWithSize(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  calls.length = 0;
  analyzeFile.mockReset();
  uploadTrackFile.mockReset();
  uploadTrackFile.mockResolvedValue({ ok: true, result: { mediaId: 'm-new' } });
  vi.useRealTimers();
});

describe('For Artists song picker (iPhone Safari)', () => {
  it('keeps the song input inside a label, visible to the picker, and accepting the audio extensions', async () => {
    renderEditor();
    const input = (await screen.findByTestId('ln-song-files')) as HTMLInputElement;
    const label = input.closest('label');
    expect(label).toBeTruthy();
    expect(label!.textContent).toMatch(/choose files/);
    expect(label!.className).toContain('ln-file-label');
    expect(input.className.split(/\s+/)).toContain('sr-only');
    expect(input.className.split(/\s+/)).not.toContain('hidden');
    expect(input.style.display).not.toBe('none');
    expect(window.getComputedStyle(input).display).not.toBe('none');
    expect(input.multiple).toBe(true);
    expect(input.tabIndex).not.toBe(-1);
    expect(screen.queryByRole('button', { name: 'choose files' })).toBeNull();
    for (const ext of ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aif', '.aiff']) {
      expect(input.accept).toContain(ext);
    }
    expect(input.accept).toContain('audio/*');
    expect(screen.queryByText(/before it uploads/i)).toBeNull();
    expect(screen.getByText(/still uploads/i)).toBeTruthy();
  });

  it('keeps the cover input inside a label and accepting images', async () => {
    renderEditor();
    const input = (await screen.findByTestId('ln-cover-file')) as HTMLInputElement;
    expect(input.closest('label')).toBeTruthy();
    expect(input.closest('label')!.className).toContain('ln-file-label');
    expect(input.className.split(/\s+/)).toContain('sr-only');
    expect(input.className.split(/\s+/)).not.toContain('hidden');
    expect(window.getComputedStyle(input).display).not.toBe('none');
    expect(input.accept).toMatch(/image\//);
  });

  it('draws the focus ring on the label when the file input is focused from the keyboard', () => {
    const css = readFileSync(join(process.cwd(), 'components/music/liner/linernotes.css'), 'utf8');
    expect(css).toContain('.ln-file-label:has(:focus-visible)');
  });
});

describe('For Artists upload is not blocked on measuring', () => {
  it('uploads when analysis hangs, and does not invent tempo, key or loudness', async () => {
    expect(ANALYSIS_BUDGET_MS).toBe(8000);
    analyzeFile.mockImplementation(() => new Promise(() => {}));
    renderEditor();
    const input = await screen.findByTestId('ln-song-files');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const file = new File(['x'], 'night.mp3', { type: 'audio/mpeg' });
      fireEvent.change(input, { target: { files: [file] } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ANALYSIS_BUDGET_MS - 1);
      });
      expect(uploadTrackFile).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(uploadTrackFile).toHaveBeenCalledTimes(1);
      const [sent, title, duration] = uploadTrackFile.mock.calls[0];
      expect(sent).toBe(file);
      expect(title).toBe('night');
      expect(duration).toBe(0);
      expect(screen.getByText(/Couldn't measure on this device/)).toBeTruthy();
      const added = calls.find((c) => c.action === 'release-add-track');
      expect(added).toBeTruthy();
      expect(added!.input.bpm).toBeUndefined();
      expect(added!.input.key).toBeUndefined();
      expect(added!.input.lufs).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uploads when analysis rejects, and says the device could not measure', async () => {
    analyzeFile.mockRejectedValue(new Error('decode failed'));
    renderEditor();
    const input = await screen.findByTestId('ln-song-files');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'take.aiff', { type: 'audio/aiff' })] },
    });
    await waitFor(() => expect(uploadTrackFile).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Couldn't measure on this device/)).toBeTruthy();
    const added = calls.find((c) => c.action === 'release-add-track');
    expect(added!.input.bpm).toBeUndefined();
    expect(added!.input.key).toBeUndefined();
    expect(added!.input.lufs).toBeUndefined();
  });

  it('passes real measurements through when analysis finishes in time', async () => {
    analyzeFile.mockResolvedValue({
      bpm: 98,
      key: 'D major',
      lufs: -11.2,
      durationSec: 4.2,
      peaks: [0.1],
    });
    renderEditor();
    const input = await screen.findByTestId('ln-song-files');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'night.mp3', { type: 'audio/mpeg' })] },
    });
    await waitFor(() => expect(uploadTrackFile).toHaveBeenCalled());
    expect(uploadTrackFile.mock.calls[0][2]).toBe(4.2);
    await waitFor(() =>
      expect(calls.find((c) => c.action === 'release-add-track')?.input).toMatchObject({
        bpm: 98,
        key: 'D major',
        lufs: -11.2,
        title: 'night',
      })
    );
    expect(screen.getAllByText(/98 BPM · D major · -11\.2 LUFS/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Couldn't measure on this device/)).toBeNull();
  });

  it('still uploads a song dropped on the zone, including an AIFF the browser gives no MIME type', async () => {
    analyzeFile.mockResolvedValue(null);
    renderEditor();
    const input = await screen.findByTestId('ln-song-files');
    const zone = input.closest('div') as HTMLElement;
    const file = new File(['x'], 'take.aiff', { type: '' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(uploadTrackFile).toHaveBeenCalledTimes(1));
    expect(uploadTrackFile.mock.calls[0][0]).toBe(file);
    expect(uploadTrackFile.mock.calls[0][1]).toBe('take');
  });
});

describe('For Artists oversize files', () => {
  it('shows the over-95 MB message and does not measure or upload', async () => {
    analyzeFile.mockImplementation(() => new Promise(() => {}));
    renderEditor();
    const input = await screen.findByTestId('ln-song-files');
    const file = fileWithSize('huge.wav', 'audio/wav', MAX_TRACK_UPLOAD_BYTES + 1);
    expect(file.size).toBe(MAX_TRACK_UPLOAD_BYTES + 1);
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(trackTooLargeMessage('huge.wav'))).toBeTruthy();
    expect(analyzeFile).not.toHaveBeenCalled();
    expect(uploadTrackFile).not.toHaveBeenCalled();
  });
});

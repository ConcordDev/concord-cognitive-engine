import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) },
  lensRun: vi.fn(),
}));
vi.mock('@/lib/daw/playback-engine', () => ({ getStudioEngine: () => ({ ctx: { sampleRate: 48000 } }) }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));

import { collectEvents, type TimelineEvent } from '@/lib/daw/scheduler';
import { createTrack, createMidiClip, createProject, note } from '@/lib/daw/project';
import { placeableItems } from '@/components/studio/daw/BrowserPanel';
import { uploadMixToLibrary, LIBRARY_UPLOAD_MAX_BYTES } from '@/components/studio/daw/Dialogs';
import { DeviceCard, DEVICE_SPECS, newDevice } from '@/components/studio/daw/DevicePanel';

describe('MIDI clip gain reaches the audio graph', () => {
  it('note events carry the clip gain', () => {
    const t = createTrack('instrument', 0);
    const c = { ...createMidiClip(t, 0, 4, [note(60, 0, 1)]), gain: -6 };
    const ev = collectEvents(0, 4, { tracks: [{ ...t, clips: [c] }], beatsPerBar: 4, bpm: 120, metronome: false, mode: 'arrange' })
      .filter((e): e is Extract<TimelineEvent, { kind: 'note' }> => e.kind === 'note');
    expect(ev).toHaveLength(1);
    expect(ev[0].gainDb).toBe(-6);
  });
});

describe('Sounds browser lists only placeable files', () => {
  it('drops items without a file and kinds the timeline cannot take', () => {
    const items = placeableItems([
      { id: 'a', title: 'Take', kind: 'audio', bpm: null, key: null, url: '/api/artifact/a/download' },
      { id: 'b', title: 'Loop w/o file', kind: 'loop', bpm: 90, key: null, url: null },
      { id: 'c', title: 'Groove', kind: 'midi', bpm: null, key: null, url: '/x.mid' },
      { id: 'd', title: 'Preset', kind: 'preset', bpm: null, key: null, url: '/p.json' },
      { id: 'e', title: 'Song DTU', kind: 'music-dtu', bpm: null, key: null, url: '/s' },
    ] as never);
    expect(items.map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('Save to library uploads the rendered audio', () => {
  beforeEach(() => { post.mockReset(); patch.mockReset(); });
  it('posts the mix bytes as an audio artifact and tags it', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, dtuId: 'artifact_1' } });
    patch.mockResolvedValueOnce({ data: { ok: true } });
    const blob = new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0])], { type: 'audio/wav' });
    const p = createProject('My Song', 92);
    const id = await uploadMixToLibrary({ name: 'My Song.wav', blob }, 'My Song', p);
    expect(id).toBe('artifact_1');
    const [url, body, cfg] = post.mock.calls[0] as [string, Blob, { headers: Record<string, string> }];
    expect(url).toBe('/api/artifact/upload');
    expect(body).toBe(blob);
    expect(cfg.headers['Content-Type']).toBe('audio/wav');
    expect(cfg.headers['X-Domain']).toBe('music');
    expect(decodeURIComponent(cfg.headers['X-Title'])).toBe('My Song');
    expect(patch).toHaveBeenCalledWith('/api/dtus/artifact_1', expect.objectContaining({ tags: expect.arrayContaining(['music', 'studio', 'mix']) }));
  });

  it('refuses files over the upload limit instead of failing silently', async () => {
    const big = { size: LIBRARY_UPLOAD_MAX_BYTES + 1, type: 'audio/wav' } as Blob;
    await expect(uploadMixToLibrary({ name: 'x.wav', blob: big }, 'x', createProject('x', 120))).rejects.toThrow(/upload limit/);
    expect(post).not.toHaveBeenCalled();
  });

  it('surfaces a server rejection', async () => {
    post.mockResolvedValueOnce({ data: { ok: false, error: 'Storage quota reached.' } });
    const blob = new Blob([new Uint8Array(8)], { type: 'audio/wav' });
    await expect(uploadMixToLibrary({ name: 'x.wav', blob }, 'x', createProject('x', 120))).rejects.toThrow(/quota/);
  });
});

describe('legacy devices the engine skips', () => {
  it('render as unsupported with only a Remove action', () => {
    const onRemove = vi.fn();
    const onChange = vi.fn();
    render(<DeviceCard fx={{ id: 'p', type: 'phaser', name: 'Phaser', enabled: true, wet: 1, params: {} }} onChange={onChange} onRemove={onRemove} />);
    expect(screen.getByTestId('studio-device-unsupported').textContent).toMatch(/skipped/);
    expect(screen.queryByTitle('Bypass')).toBeNull();
    fireEvent.click(screen.getByTitle('Remove'));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('device card param labels stay readable', () => {
  it('shows Gate Threshold, Range, and Release in full (not truncated)', () => {
    render(<DeviceCard fx={newDevice('gate')} onChange={vi.fn()} />);
    for (const name of ['Threshold', 'Range', 'Release']) {
      const label = screen.getByText(name);
      expect(label).toHaveAttribute('title', name);
      expect(label.className).toMatch(/shrink-0/);
      expect(label.className).not.toMatch(/truncate/);
    }
  });

  it('keeps every Add-device param label readable on the same-width card', () => {
    for (const spec of DEVICE_SPECS) {
      const { unmount } = render(<DeviceCard fx={newDevice(spec.type)} onChange={vi.fn()} />);
      const card = screen.getByTestId('studio-device');
      expect(card.className).toMatch(/\bw-48\b/);
      for (const ps of spec.params) {
        const label = within(card).getByTitle(ps.label);
        expect(label.textContent).toBe(ps.label);
        expect(label.className).toMatch(/shrink-0/);
        expect(label.className).not.toMatch(/truncate/);
      }
      unmount();
    }
  });
});

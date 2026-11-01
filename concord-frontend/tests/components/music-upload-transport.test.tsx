import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TrackCard } from '@/components/music/TrackCard';
import { UploadFlow } from '@/components/music/UploadFlow';
import {
  describeUploadError, freeListenOnlyTiers, normalizeTrackRow, rawUploadQuery,
} from '@/lib/music/upload';

vi.mock('@/components/lens/PullToSubstrate', () => ({ PullToSubstrate: () => null }));

afterEach(cleanup);

describe('upload transport helpers', () => {
  it('sends the file as the body: query carries metadata, free listen-only tiers, public privacy', () => {
    const q = new URLSearchParams(rawUploadQuery({
      title: 'Song', filename: 'song.m4a', duration: 200, previewStart: 0, previewDuration: 30, tags: ['a', 'b'],
    }));
    expect(q.get('title')).toBe('Song');
    expect(q.get('filename')).toBe('song.m4a');
    expect(q.get('privacy')).toBe('public');
    expect(q.get('tags')).toBe('a,b');
    const tiers = JSON.parse(q.get('tiers') || '[]');
    expect(tiers.find((t: { tier: string }) => t.tier === 'listen')).toMatchObject({ enabled: true, price: 0 });
    for (const t of tiers.filter((x: { tier: string }) => x.tier !== 'listen')) {
      expect(t).toMatchObject({ enabled: false, price: 0 });
    }
  });

  it('money is off: no tier is ever priced', () => {
    expect(freeListenOnlyTiers().every((t) => t.price === 0)).toBe(true);
  });

  it('413 reads as "File too large" with the size', () => {
    const msg = describeUploadError(
      { response: { status: 413, data: { error: 'payload_too_large' } } },
      { name: 'a.mp3', type: 'audio/mpeg', size: 3.2 * 1024 * 1024 },
    );
    expect(msg).toMatch(/File too large \(3\.2 MB\)/);
  });

  it('an unsupported type names the format and what is accepted', () => {
    const msg = describeUploadError(
      { response: { status: 400, data: { error: 'File type not allowed: audio/x-foo' } } },
      { name: 'a.foo', type: 'audio/x-foo', size: 10 },
    );
    expect(msg).toMatch(/Format not supported: audio\/x-foo/);
    expect(msg).toMatch(/mp3, wav, flac, m4a, aac, ogg, mp4 or mov/);
  });

  it('a truncated-upload refusal surfaces the server reason, not a bare status', () => {
    const msg = describeUploadError({ response: { status: 413, data: { error: 'upload_truncated', message: 'Only 7500 of 900000 bytes arrived.' } } });
    expect(msg).toMatch(/Only 7500 of 900000 bytes arrived/);
  });
});

describe('malformed track rows cannot brick the lens', () => {
  it('a row with no tiers/tags/stems normalises to empty collections', () => {
    const t = normalizeTrackRow({ audioUrl: '/x' }, 'r1', 'T');
    expect(t.tiers).toEqual([]);
    expect(t.tags).toEqual([]);
    expect(t.stems).toEqual([]);
    expect(t.id).toBe('r1');
  });

  it('TrackCard renders a normalised minimal row with tiers shown (was: undefined.filter crash)', () => {
    const t = normalizeTrackRow({ audioUrl: '/api/media/r1/stream', artistName: 'Ada' }, 'r1', 'Minimal');
    render(<TrackCard track={t} showTiers />);
    expect(screen.getAllByText('Minimal').length).toBeGreaterThan(0);
  });

  it('non-object row data does not throw', () => {
    expect(() => normalizeTrackRow(null, 'r2', 'N')).not.toThrow();
  });
});

describe('upload error stays on screen until dismissed', () => {
  it('shows the specific message and a Dismiss button that clears it', () => {
    const onDismiss = vi.fn();
    render(
      <UploadFlow
        onUpload={() => {}}
        onCancel={() => {}}
        progress={{ stage: 'error', progress: 0, audioAnalysis: null, error: 'File too large (3.2 MB). Limit exceeded.' }}
        onDismissError={onDismiss}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/File too large \(3\.2 MB\)/);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

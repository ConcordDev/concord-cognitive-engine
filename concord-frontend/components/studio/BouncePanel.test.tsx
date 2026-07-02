/**
 * BouncePanel — the studio bounce/export surface. Pins the HONEST D1 contract:
 * a `pending` render shows "render happens in your browser — not yet available
 * here" and NO download link; only a `completed` render WITH a real downloadUrl
 * renders a download anchor; `failed` shows its reason. Also covers the four UX
 * states (loading / empty / populated) + the bounce + publish actions, driven by
 * a mocked lensRun standing in for /api/lens/run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
// Stub the publish dialog to an inert marker so the panel is isolated.
vi.mock('./PublishAsAdaptiveMusicDialog', () => ({
  PublishAsAdaptiveMusicDialog: () => <div data-testid="publish-dialog" />,
}));

import { BouncePanel } from './BouncePanel';

const envelope = (renders: unknown[]) => ({ data: { result: { renders } } });
const RENDERS = [
  { id: 'r1', projectId: 'p1', projectName: 'Pending One', trackId: null, format: 'wav_24', sampleRate: 48000, kind: 'master', durationSec: 4, status: 'pending', bouncedAt: 't' },
  { id: 'r2', projectId: 'p1', projectName: 'Failed One', trackId: null, format: 'mp3_320', sampleRate: 44100, kind: 'master', durationSec: 4, status: 'failed', reason: 'no renderer', bouncedAt: 't' },
  { id: 'r3', projectId: 'p1', projectName: 'Done One', trackId: null, format: 'flac', sampleRate: 96000, kind: 'master', durationSec: 4, status: 'completed', downloadUrl: 'https://x/a.flac', sizeBytes: 1234, bouncedAt: 't' },
];

beforeEach(() => { lensRun.mockReset(); });

describe('BouncePanel', () => {
  it('LOADING then POPULATED: honest pending/failed/completed rows', async () => {
    lensRun.mockResolvedValue(envelope(RENDERS));
    const { getByText, container } = render(<BouncePanel projectId="p1" />);
    // loading spinner first
    expect(getByText(/Loading/i)).toBeInTheDocument();
    // pending row: the honest "in your browser — not yet available" note, no download link
    await waitFor(() => expect(getByText(/not yet available here/i)).toBeInTheDocument());
    expect(getByText(/no renderer/i)).toBeInTheDocument(); // failed reason
    // exactly one real download anchor — only the completed render with a downloadUrl
    const dl = container.querySelectorAll('a[download]');
    expect(dl.length).toBe(1);
    expect((dl[0] as HTMLAnchorElement).getAttribute('href')).toBe('https://x/a.flac');
    expect(getByText('Done One')).toBeInTheDocument();
  });

  it('EMPTY: shows the no-bounces state when the list is empty', async () => {
    lensRun.mockResolvedValue(envelope([]));
    const { getByText } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(getByText(/No bounces yet/i)).toBeInTheDocument());
  });

  it('bounce: posts studio.bounce then re-fetches the list', async () => {
    lensRun.mockResolvedValue(envelope([]));
    const { getByText } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(getByText(/No bounces yet/i)).toBeInTheDocument());
    lensRun.mockClear();
    fireEvent.click(getByText('Bounce'));
    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => (c[0] as { action?: string })?.action === 'bounce')).toBe(true),
    );
  });

  it('publish: renders via OfflineAudioContext and opens the publish dialog', async () => {
    lensRun.mockResolvedValue(envelope([]));
    const startRendering = vi.fn().mockResolvedValue({} as AudioBuffer);
    // Minimal OfflineAudioContext stand-in so bouncePlaceholder runs end-to-end.
    (window as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = class {
      destination = {};
      createOscillator() { return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { value: 0 }, connect() {} }; }
      startRendering = startRendering;
    };
    const { getByText, getByTestId } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(getByText(/No bounces yet/i)).toBeInTheDocument());
    fireEvent.click(getByText('Publish'));
    await waitFor(() => expect(startRendering).toHaveBeenCalled());
    await waitFor(() => expect(getByTestId('publish-dialog')).toBeInTheDocument());
  });

  it('publish row discloses the placeholder reference tone', async () => {
    lensRun.mockResolvedValue(envelope([]));
    const { getByText, getByTitle } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(getByText(/No bounces yet/i)).toBeInTheDocument());
    // Visible one-line note next to the publish row — the published artifact's
    // reference audio is a generated tone, not the project mix.
    expect(getByText(/generated reference tone — in-browser mix rendering coming soon/i)).toBeInTheDocument();
    // Tooltip on the button explains the placeholder.
    expect(getByTitle(/generated placeholder tone/i)).toBeInTheDocument();
  });

  it('no projectId: hides the bounce form + publish row', async () => {
    lensRun.mockResolvedValue(envelope([]));
    const { queryByText } = render(<BouncePanel />);
    await waitFor(() => expect(queryByText(/No bounces yet/i)).toBeInTheDocument());
    expect(queryByText('Bounce')).toBeNull();
    expect(queryByText(/Publish as adaptive music/i)).toBeNull();
  });
});

/**
 * BouncePanel — the studio bounce/export surface. Pins the HONEST D1 contract:
 * a `pending` render shows "no audio was rendered for this bounce" and NO
 * download link; only a `completed` render WITH a real downloadUrl renders a
 * download anchor; `failed` shows its reason. Also covers the four UX states
 * (loading / empty / populated) + the bounce + publish actions, driven by a
 * mocked lensRun standing in for /api/lens/run. Q31: bounce/publish render
 * the REAL project mix in-browser (lib/daw/workbench-render.ts) — the old
 * 220 Hz placeholder tone is gone, and publish with nothing renderable
 * shows why instead of opening the dialog.
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

const PROJECT = { id: 'p1', name: 'Test Song', bpm: 120, tracks: [{ id: 't1', name: 'Melody', kind: 'midi', volume: 0.8, pan: 0, muted: false, solo: false }] };
const CLIPS = [{ id: 'c1', trackId: 't1', name: 'Melody clip', kind: 'midi', startBeats: 0, lengthBeats: 4, audioUrl: null, loop: false, muted: false }];
const NOTES = [{ clipId: 'c1', pitch: 69, velocity: 96, startBeats: 0, lengthBeats: 1 }];

// A workbench data router over the mocked lensRun: serves the project,
// its clips and notes, the renders list, and accepts the bounce.
function routeWorkbench(renders: unknown[] = []) {
  lensRun.mockImplementation((arg: { action?: string }) => {
    switch (arg?.action) {
      case 'project-get': return Promise.resolve({ data: { result: { project: PROJECT } } });
      case 'clips-list': return Promise.resolve({ data: { result: { clips: CLIPS } } });
      case 'midi-notes-list': return Promise.resolve({ data: { result: { notes: NOTES } } });
      case 'bounce': return Promise.resolve({ data: { ok: true, result: { render: {} } } });
      default: return Promise.resolve(envelope(renders));
    }
  });
}

const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
const fakeAudioBuffer = () => ({ duration: 2.25, numberOfChannels: 2, sampleRate: 48000, getChannelData: () => new Float32Array(108000) });

// Full OfflineAudioContext stand-in for the real workbench renderer:
// gains, panners, oscillators, buffer sources, decode + render.
function installFakeOfflineContext() {
  (window as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = class {
    destination = {};
    sampleRate = 48000;
    createGain() { return { gain: param(), connect() {} }; }
    createStereoPanner() { return { pan: param(), connect() {} }; }
    createOscillator() { return { type: '', frequency: param(), connect() {}, start() {}, stop() {} }; }
    createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {}, stop() {} }; }
    createBuffer(_ch: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
    createBiquadFilter() { return { type: '', frequency: param(), connect() {} }; }
    decodeAudioData() { return Promise.resolve(fakeAudioBuffer()); }
    startRendering() { return Promise.resolve(fakeAudioBuffer()); }
  };
  (globalThis as unknown as { AudioBuffer: unknown }).AudioBuffer = class {
    length = 0; numberOfChannels = 2; sampleRate = 48000; duration = 2.25;
    constructor(opts: { length: number }) { this.length = opts.length; }
    copyToChannel() {}
    getChannelData() { return new Float32Array(this.length); }
  };
}

beforeEach(() => { lensRun.mockReset(); });

describe('BouncePanel', () => {
  it('LOADING then POPULATED: honest pending/failed/completed rows', async () => {
    lensRun.mockResolvedValue(envelope(RENDERS));
    const { getByText, container } = render(<BouncePanel projectId="p1" />);
    // loading spinner first
    expect(getByText(/Loading/i)).toBeInTheDocument();
    // pending row: the honest "no audio was rendered" note, no download link
    await waitFor(() => expect(getByText(/no audio was rendered for this bounce/i)).toBeInTheDocument());
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

  it('bounce: renders the real mix and posts studio.bounce WITH audioDataUrl', async () => {
    routeWorkbench([]);
    installFakeOfflineContext();
    const { getByText } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(getByText(/No bounces yet/i)).toBeInTheDocument());
    fireEvent.click(getByText('Bounce'));
    await waitFor(() => expect(getByText(/Rendered 1 clip/i)).toBeInTheDocument());
    const bounceCall = lensRun.mock.calls.find((c) => (c[0] as { action?: string })?.action === 'bounce');
    expect(bounceCall).toBeTruthy();
    const input = (bounceCall![0] as { input: { audioDataUrl?: string; durationSec?: number } }).input;
    expect(input.audioDataUrl?.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(input.durationSec).toBe(2); // 4 beats @120bpm = 2s (+tail, rounded by the panel's Math.round on 2.25)
  });

  it('publish: renders the real mix and opens the publish dialog', async () => {
    routeWorkbench([]);
    installFakeOfflineContext();
    const { getByText, getByTestId } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(getByText(/No bounces yet/i)).toBeInTheDocument());
    fireEvent.click(getByText('Publish'));
    await waitFor(() => expect(getByTestId('publish-dialog')).toBeInTheDocument());
  });

  it('publish row describes the real mixdown — no placeholder tone anywhere', async () => {
    lensRun.mockResolvedValue(envelope([]));
    const { getByText, queryByText } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(getByText(/No bounces yet/i)).toBeInTheDocument());
    expect(getByText(/real mixdown of your project/i)).toBeInTheDocument();
    expect(queryByText(/placeholder/i)).toBeNull();
    expect(queryByText(/220/i)).toBeNull();
  });

  it('publish with nothing renderable: shows why and does NOT open the dialog', async () => {
    lensRun.mockImplementation((arg: { action?: string }) => {
      switch (arg?.action) {
        case 'project-get': return Promise.resolve({ data: { result: { project: PROJECT } } });
        case 'clips-list': return Promise.resolve({ data: { result: { clips: [] } } });
        default: return Promise.resolve(envelope([]));
      }
    });
    installFakeOfflineContext();
    const { getByText, queryByTestId } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(getByText(/No bounces yet/i)).toBeInTheDocument());
    fireEvent.click(getByText('Publish'));
    await waitFor(() => expect(getByText(/Can't publish yet/i)).toBeInTheDocument());
    expect(queryByTestId('publish-dialog')).toBeNull();
  });

  it('no projectId: hides the bounce form + publish row', async () => {
    lensRun.mockResolvedValue(envelope([]));
    const { queryByText } = render(<BouncePanel />);
    await waitFor(() => expect(queryByText(/No bounces yet/i)).toBeInTheDocument());
    expect(queryByText('Bounce')).toBeNull();
    expect(queryByText(/Publish as adaptive music/i)).toBeNull();
  });
});

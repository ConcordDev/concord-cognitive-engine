/**
 * VoiceRecordingStudio — "Auto-label speakers" button, the new frontend
 * surface for voice.recording-auto-label-speakers (previously UNSURFACED —
 * see docs/WAVE4_INVENTORY.md's voice row and
 * docs/lens-specs/voice-capability-map.md). Now that recording-create /
 * live-finalize can attach a real per-segment `.vector`, the macro is
 * genuinely reachable; this pins that clicking the button calls the macro
 * and renders its REAL result (per-segment match/no-match, with the actual
 * enrolled speaker name + distance/confidence the backend computed) rather
 * than a static/fabricated label.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

interface Call { action: string; params: Record<string, unknown> }
const calls: Call[] = [];

const RECORDING_BASE = {
  id: 'rec_1',
  title: 'Team Sync',
  durationSec: 30,
  summary: null,
  segments: [
    { id: 'sg_1', speaker: 'Speaker 1', text: 'This is definitely Ana talking.', startSec: 0, highlighted: false },
    { id: 'sg_2', speaker: 'Speaker 1', text: 'No vector was ever captured here.', startSec: 8, highlighted: false },
  ],
};

const RECORDING_AFTER_LABEL = {
  ...RECORDING_BASE,
  segments: [
    { ...RECORDING_BASE.segments[0], speaker: 'Ana', speakerSource: 'voiceprint' },
    RECORDING_BASE.segments[1],
  ],
};

let autoLabelCallCount = 0;

const lensRunMock = vi.fn(async (domain: string, action: string, params: Record<string, unknown> = {}) => {
  calls.push({ action, params });
  if (action === 'recording-list') {
    return { data: { ok: true, result: { recordings: [{ id: 'rec_1', title: 'Team Sync', durationSec: 30, segmentCount: 2, speakerCount: 1 }] } } };
  }
  if (action === 'recording-detail') {
    return { data: { ok: true, result: { recording: autoLabelCallCount > 0 ? RECORDING_AFTER_LABEL : RECORDING_BASE } } };
  }
  if (action === 'share-detail') {
    return { data: { ok: true, result: { shared: false, share: null } } };
  }
  if (action === 'transcript-translations-list') {
    return { data: { ok: true, result: { translations: [], count: 0 } } };
  }
  if (action === 'recording-auto-label-speakers') {
    autoLabelCallCount += 1;
    return {
      data: {
        ok: true,
        result: {
          relabeled: 1,
          unmatched: 1,
          totalSegments: 2,
          matches: [
            { segmentId: 'sg_1', matched: true, speaker: 'Ana', distance: 0.05, confidence: 0.86 },
            { segmentId: 'sg_2', matched: false, speaker: 'Speaker 1', reason: 'no_vector' },
          ],
        },
      },
    };
  }
  return { data: { ok: true, result: {} } };
});

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: [string, string, Record<string, unknown>?]) => lensRunMock(...args),
}));

import { VoiceRecordingStudio } from '@/components/voice/VoiceRecordingStudio';

describe('VoiceRecordingStudio — Auto-label speakers (real macro result rendering)', () => {
  beforeEach(() => {
    calls.length = 0;
    autoLabelCallCount = 0;
    lensRunMock.mockClear();
  });

  it('clicking "Auto-label speakers" calls voice.recording-auto-label-speakers with the open recording id', async () => {
    const { getByText } = render(<VoiceRecordingStudio />);
    await waitFor(() => expect(getByText('Team Sync')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Team Sync')); });
    await waitFor(() => expect(getByText('Auto-label speakers')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText('Auto-label speakers')); });

    const autoLabelCall = calls.find((c) => c.action === 'recording-auto-label-speakers');
    expect(autoLabelCall).toBeDefined();
    expect(autoLabelCall!.params).toEqual({ id: 'rec_1' });
  });

  it('renders the REAL per-segment result: which segment matched which enrolled voice-print, with real distance/confidence — and the honest unmatched reason for the other', async () => {
    const { getByText } = render(<VoiceRecordingStudio />);
    await waitFor(() => expect(getByText('Team Sync')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Team Sync')); });
    await waitFor(() => expect(getByText('Auto-label speakers')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText('Auto-label speakers')); });

    // Summary line reflects the real counts from the macro's response.
    await waitFor(() => expect(getByText(/Matched 1 of 2 segments/)).toBeInTheDocument());
    expect(getByText(/1 unmatched/)).toBeInTheDocument();

    // Per-segment detail: the matched segment names the real enrolled
    // speaker + the real computed distance/confidence — not a placeholder.
    expect(getByText(/→ Ana · dist 0\.05 · conf 86%/)).toBeInTheDocument();
    // The unmatched segment honestly reports why, rather than guessing a name.
    expect(getByText(/no match \(no captured vector\)/)).toBeInTheDocument();

    // The reload after auto-labeling picks up the recording's real updated
    // speaker label (server-applied, not client-invented) — segment 1's
    // displayed speaker in the transcript now reads "Ana".
    await waitFor(() => expect(getByText('Ana')).toBeInTheDocument());
  });

  it('does not render a result banner before the button has been clicked (no fabricated pre-emptive result)', async () => {
    const { getByText, queryByText } = render(<VoiceRecordingStudio />);
    await waitFor(() => expect(getByText('Team Sync')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Team Sync')); });
    await waitFor(() => expect(getByText('Auto-label speakers')).toBeInTheDocument());

    expect(queryByText(/Matched \d+ of \d+ segments/)).toBeNull();
  });
});

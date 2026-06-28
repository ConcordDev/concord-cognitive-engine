/**
 * BouncePanel truthful-render contract.
 *
 * studio.bounce used to fake the expensive last mile (status:"completed" + a
 * dead /renders/*.wav URL). The honest backend now only reports "completed" when
 * a real artifact was persisted (carrying a downloadUrl), else "pending". This
 * pins that the panel mirrors that truth: a COMPLETED render shows a real
 * download link (href = the persisted artifact URL); a PENDING render shows an
 * honest "not yet available" note and renders NO download link (no dead button).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { BouncePanel } from '@/components/studio/BouncePanel';

function rendersList(renders: unknown[]) {
  return Promise.resolve({ data: { ok: true, result: { renders } } });
}

const completedRender = {
  id: 'bnc-1', projectId: 'p1', projectName: 'My Mix', trackId: null,
  format: 'wav_24', sampleRate: 48000, kind: 'stereo_mix', durationSec: 180,
  status: 'completed', downloadUrl: '/api/artifacts/abc-123/download', sizeBytes: 4096,
  bouncedAt: '2026-06-28T00:00:00.000Z',
};
const pendingRender = {
  id: 'bnc-2', projectId: 'p1', projectName: 'Pending Mix', trackId: null,
  format: 'wav_24', sampleRate: 48000, kind: 'stereo_mix', durationSec: 180,
  status: 'pending', reason: 'needs_client_render',
  bouncedAt: '2026-06-28T00:01:00.000Z',
};

beforeEach(() => { lensRunMock.mockReset(); });

describe('BouncePanel — truthful render states', () => {
  it('COMPLETED render shows a real download link to the persisted artifact', async () => {
    lensRunMock.mockReturnValue(rendersList([completedRender]));
    render(<BouncePanel />);
    const link = await screen.findByRole('link', { name: /download/i });
    expect(link).toHaveAttribute('href', '/api/artifacts/abc-123/download');
    expect(link).toHaveAttribute('download');
  });

  it('PENDING render shows an honest not-yet-available note and NO download link (no dead button)', async () => {
    lensRunMock.mockReturnValue(rendersList([pendingRender]));
    render(<BouncePanel />);
    await waitFor(() => expect(screen.getByText(/Pending Mix/)).toBeTruthy());
    // No download anchor for a not-produced render.
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
    // Honest pending disclosure is shown.
    expect(screen.getByText(/not yet available/i)).toBeTruthy();
  });
});

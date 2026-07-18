/**
 * Rotoscope-style reference-image import — closes docs/WAVE4_INVENTORY.md
 * row 93 ("No rotoscope-style photo-reference import onto a frame").
 *
 * Pins two things end to end:
 *   1. AnimationReferenceImages — the "Import onto frame" action honestly
 *      reflects whether a real Studio target exists (via
 *      animReferenceTarget.ts), calls the real
 *      `frame-layer-import-image` macro with the exact animId/frameId/
 *      imageRef when clicked, and surfaces success/failure truthfully
 *      (never a fabricated "Imported" on a backend rejection).
 *   2. AnimStudio — a frame whose layers include a real `type:'reference'`
 *      layer renders it as a visually distinct, non-paintable row (a "Ref"
 *      badge + dashed border), separate from ordinary paintable layers.
 *
 * No fabricated data: every assertion is driven by a mocked lensRun()
 * returning exactly the shapes server/domains/animation.js's macros
 * return, or by the real (unmocked) animReferenceTarget.ts localStorage
 * module — never invented fixture shapes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── the real macro channel + media API, mocked per-test ────────────────────
const lensRunMock = vi.fn();
const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', username: 'tester', email: 't@example.com', role: 'user' }, isLoading: false, isAuthenticated: true }),
}));

// Import AFTER the mocks are registered.
import { AnimationReferenceImages } from '@/components/animation/AnimationReferenceImages';
import { AnimStudio } from '@/components/animation/AnimStudio';
import { setActiveFrameTarget, getActiveFrameTarget } from '@/components/animation/animReferenceTarget';

function ok<T>(result: T) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const MEDIA_ITEM = {
  id: 'med_ref1', title: 'Pose sketch', mediaType: 'image', tags: ['animation', 'reference'], createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  window.localStorage.clear();
  lensRunMock.mockReset();
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  apiGetMock.mockResolvedValue({ data: { media: [MEDIA_ITEM] } });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('AnimationReferenceImages — "Import onto frame"', () => {
  it('renders an honest "open a frame first" state and a disabled import button when no Studio target exists', async () => {
    renderWithQuery(<AnimationReferenceImages />);
    expect(await screen.findByText(/open a frame in the studio tab first/i)).toBeInTheDocument();
    const importBtn = await screen.findByRole('button', { name: /import onto frame/i });
    expect(importBtn).toBeDisabled();
  });

  it('shows the real target (title + frame index) once animReferenceTarget has one, and enables the import button', async () => {
    setActiveFrameTarget({ animId: 'anm_1', frameId: 'frm_1', animTitle: 'Walk Cycle', frameIndex: 2, frameCount: 8 });
    renderWithQuery(<AnimationReferenceImages />);
    expect(await screen.findByText(/walk cycle/i)).toBeInTheDocument();
    expect(await screen.findByText(/frame 3\/8/i)).toBeInTheDocument();
    const importBtn = await screen.findByRole('button', { name: /import onto frame/i });
    await waitFor(() => expect(importBtn).not.toBeDisabled());
  });

  it('clicking "Import onto frame" calls frame-layer-import-image with the exact animId/frameId/imageRef, and shows success honestly', async () => {
    setActiveFrameTarget({ animId: 'anm_42', frameId: 'frm_7', animTitle: 'Lip Sync', frameIndex: 0, frameCount: 4 });
    lensRunMock.mockResolvedValue(ok({ layer: { id: 'lyr_ref1', type: 'reference', imageRef: '/api/media/med_ref1/stream', opacity: 0.5, isReference: true } }));

    renderWithQuery(<AnimationReferenceImages />);
    const importBtn = await screen.findByRole('button', { name: /import onto frame/i });
    await waitFor(() => expect(importBtn).not.toBeDisabled());
    fireEvent.click(importBtn);

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('animation', 'frame-layer-import-image', {
      animId: 'anm_42',
      frameId: 'frm_7',
      imageRef: '/api/media/med_ref1/stream',
      name: 'Pose sketch',
    }));
    expect(await screen.findByRole('button', { name: /imported/i })).toBeInTheDocument();
  });

  it('surfaces a real backend rejection (e.g. layer limit reached) as an honest error, never a fabricated success', async () => {
    setActiveFrameTarget({ animId: 'anm_full', frameId: 'frm_full', animTitle: 'Full Frame', frameIndex: 0, frameCount: 1 });
    lensRunMock.mockResolvedValue(err('layer limit (10) reached'));

    renderWithQuery(<AnimationReferenceImages />);
    const importBtn = await screen.findByRole('button', { name: /import onto frame/i });
    await waitFor(() => expect(importBtn).not.toBeDisabled());
    fireEvent.click(importBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent(/layer limit \(10\) reached/i);
    // Never silently flips to "Imported" on a rejection.
    expect(screen.queryByRole('button', { name: /imported/i })).not.toBeInTheDocument();
  });

  it('a thrown network error is also surfaced honestly, not swallowed', async () => {
    setActiveFrameTarget({ animId: 'anm_x', frameId: 'frm_x', animTitle: 'Net Fail', frameIndex: 0, frameCount: 1 });
    lensRunMock.mockRejectedValue(new Error('network down'));

    renderWithQuery(<AnimationReferenceImages />);
    const importBtn = await screen.findByRole('button', { name: /import onto frame/i });
    await waitFor(() => expect(importBtn).not.toBeDisabled());
    fireEvent.click(importBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent(/network down/i);
  });
});

describe('animReferenceTarget — the cross-tab pointer module itself', () => {
  it('round-trips a target through localStorage', () => {
    expect(getActiveFrameTarget()).toBeNull();
    setActiveFrameTarget({ animId: 'a', frameId: 'f', animTitle: 'T', frameIndex: 1, frameCount: 2 });
    expect(getActiveFrameTarget()).toEqual({ animId: 'a', frameId: 'f', animTitle: 'T', frameIndex: 1, frameCount: 2 });
  });
});

describe('AnimStudio — reference layers render distinctly from paintable layers', () => {
  const ANIM = {
    id: 'anm_studio', title: 'Studio Anim', width: 200, height: 100, fps: 12, background: '#ffffff',
    frames: [
      {
        id: 'frm_studio_1',
        exposure: 1,
        layers: [
          { id: 'lyr_paint', name: 'Layer 1', visible: true, opacity: 1, type: 'paintable', strokes: [] },
          { id: 'lyr_ref', name: 'Sketch ref', visible: true, opacity: 0.5, type: 'reference', isReference: true, imageRef: '/api/media/med_ref1/stream', strokes: [] },
        ],
      },
    ],
  };

  beforeEach(() => {
    // jsdom has no real 2D canvas context; the component already null-checks
    // getContext('2d') and no-ops its draw effect, so this keeps the render
    // clean without pulling in the `canvas` npm package (same pattern as
    // tests/components/whiteboard-canvas-vote-click.test.tsx).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'anim-get') return ok({ animation: ANIM });
      if (action === 'playback-frames') return ok({ totalFrames: 1, durationSec: 0.08 });
      if (action === 'brush-list') return ok({ brushes: [] });
      return ok({});
    });
  });

  it('renders a "Ref" badge on the reference layer and not on the paintable layer', async () => {
    render(<AnimStudio animId="anm_studio" onExit={() => {}} />);
    await screen.findByText('Sketch ref');
    expect(screen.getByText(/^ref$/i)).toBeInTheDocument();
    // The paintable layer's name is a real activation button; the reference
    // layer's name is a static (non-activatable) label — distinct DOM roles.
    expect(screen.getByRole('button', { name: 'Layer 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sketch ref' })).not.toBeInTheDocument();
  });

  it('the reference layer still exposes the shared opacity slider (no separate opacity-update UI needed)', async () => {
    render(<AnimStudio animId="anm_studio" onExit={() => {}} />);
    await screen.findByText('Sketch ref');
    const refOpacitySlider = screen.getByLabelText('Reference opacity') as HTMLInputElement;
    expect(refOpacitySlider.value).toBe('0.5');
    const paintableOpacitySlider = screen.getByLabelText('Layer opacity') as HTMLInputElement;
    expect(paintableOpacitySlider.value).toBe('1');
  });
});

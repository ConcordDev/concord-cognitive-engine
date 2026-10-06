/** AnimStudio — rename through anim-rename, clear a layer or the whole frame through frame-clear. */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { AnimStudio } from '@/components/animation/AnimStudio';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const LAYER = { id: 'lyr_1', name: 'Layer 1', visible: true, opacity: 1, type: 'paintable' as const, strokes: [] };
const ANIM = { id: 'anm_1', title: 'Bounce', width: 200, height: 100, fps: 12, background: '#ffffff', frames: [{ id: 'frm_1', exposure: 1, layers: [LAYER] }] };
const ok = <T,>(result: T) => Promise.resolve({ data: { ok: true, result, error: null } });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    if (action === 'anim-get') return ok({ animation: ANIM, canUndo: false, canRedo: false });
    if (action === 'playback-frames') return ok({ totalFrames: 1, durationSec: 0.08 });
    if (action === 'brush-list') return ok({ brushes: [] });
    if (action === 'anim-rename') return ok({ id: 'anm_1', title: 'Bounce v2' });
    return ok({});
  });
});

describe('AnimStudio rename + clear', () => {
  it('renames inline and commits on Enter', async () => {
    render(<AnimStudio animId="anm_1" onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /bounce/i }));
    const input = screen.getByLabelText('Animation title');
    fireEvent.change(input, { target: { value: 'Bounce v2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('animation', 'anim-rename', { id: 'anm_1', title: 'Bounce v2' }));
    await screen.findByText('Bounce v2');
  });

  it('clears the active layer, or every layer of the frame', async () => {
    render(<AnimStudio animId="anm_1" onExit={() => {}} />);
    await screen.findByText('Bounce');
    fireEvent.click(screen.getByRole('button', { name: /clear layer/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('animation', 'frame-clear', { animId: 'anm_1', frameId: 'frm_1', layerId: 'lyr_1', allLayers: false }));
    fireEvent.click(screen.getByRole('button', { name: /clear frame/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('animation', 'frame-clear', expect.objectContaining({ allLayers: true })));
  });
});

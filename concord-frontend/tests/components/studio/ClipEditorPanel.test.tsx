import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ClipEditorPanel } from '@/components/studio/ClipEditorPanel';

const CLIPS = [
  {
    id: 'c1', projectId: 'p1', trackId: 't1', name: 'Loop A', kind: 'audio',
    startBeats: 0, lengthBeats: 8, warpEnabled: true, warpMode: 'beats',
    warpMarkers: [{ beat: 0, sampleSec: 0 }, { beat: 4, sampleSec: 2 }],
    fadeInBeats: 1, fadeOutBeats: 0.5, fadeInCurve: 'linear', fadeOutCurve: 'exp', gainDb: -3,
  },
  {
    id: 'c2', projectId: 'p1', trackId: 't1', name: 'Loop B', kind: 'midi',
    startBeats: 8, lengthBeats: 4, warpEnabled: false, warpMarkers: [],
  },
];

beforeEach(() => { lensRun.mockReset(); });

describe('ClipEditorPanel', () => {
  it('shows the no-project state', async () => {
    render(<ClipEditorPanel />);
    await waitFor(() => expect(screen.getByText(/Open a project to edit clips/)).toBeInTheDocument());
  });

  it('shows the no-clips state', async () => {
    lensRun.mockResolvedValue(okResult({ clips: [] }));
    render(<ClipEditorPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No clips yet/)).toBeInTheDocument());
  });

  it('renders clip list and selects the first clip with warp markers', async () => {
    lensRun.mockResolvedValue(okResult({ clips: CLIPS }));
    render(<ClipEditorPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Loop A')).toBeInTheDocument());
    expect(screen.getByText(/beat 0 → 0s/)).toBeInTheDocument();
  });

  it('switches selected clip and shows the no-markers hint', async () => {
    lensRun.mockResolvedValue(okResult({ clips: CLIPS }));
    render(<ClipEditorPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Loop A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Loop B'));
    await waitFor(() => expect(screen.getByText(/No warp markers/)).toBeInTheDocument());
  });

  it('adds and removes a warp marker', async () => {
    lensRun.mockResolvedValue(okResult({ clips: CLIPS }));
    render(<ClipEditorPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Loop A')).toBeInTheDocument());

    const beatInput = screen.getByText('Beat').querySelector('input')!;
    fireEvent.change(beatInput, { target: { value: '6' } });
    fireEvent.click(screen.getByText('Marker'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'clip-warp-set', expect.objectContaining({ warpEnabled: true }),
    ));

    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'clip-warp-set', expect.objectContaining({ clipId: 'c1' }),
    ));
  });

  it('sets a warp mode', async () => {
    lensRun.mockResolvedValue(okResult({ clips: CLIPS }));
    render(<ClipEditorPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Loop A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('complex'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'clip-warp-set', expect.objectContaining({ warpMode: 'complex' }),
    ));
  });

  it('slices the clip when an at-beat is provided', async () => {
    lensRun.mockResolvedValue(okResult({ clips: CLIPS }));
    render(<ClipEditorPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Loop A')).toBeInTheDocument());
    const sliceInput = screen.getByText('At beat').querySelector('input')!;
    fireEvent.change(sliceInput, { target: { value: '4' } });
    fireEvent.click(screen.getByText('Slice clip'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'clip-slice', { clipId: 'c1', atBeats: 4 },
    ));
  });

  it('sets fade params via blur and select change and gain via mouseup', async () => {
    lensRun.mockResolvedValue(okResult({ clips: CLIPS }));
    const { container } = render(<ClipEditorPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Loop A')).toBeInTheDocument());

    const fadeInNum = container.querySelectorAll('input[type="number"][step="0.25"][min="0"]')[0];
    fireEvent.blur(fadeInNum, { target: { value: '2' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'clip-fade-set', expect.objectContaining({ fadeInBeats: 2 }),
    ));

    const curveSelects = container.querySelectorAll('select');
    fireEvent.change(curveSelects[0], { target: { value: 'scurve' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'clip-fade-set', expect.objectContaining({ fadeInCurve: 'scurve' }),
    ));

    const gain = container.querySelector('input[type="range"]')!;
    fireEvent.mouseUp(gain, { target: { value: '-10' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'clip-fade-set', expect.objectContaining({ gainDb: -10 }),
    ));
  });

  it('handles a list error', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<ClipEditorPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No clips yet/)).toBeInTheDocument());
  });
});

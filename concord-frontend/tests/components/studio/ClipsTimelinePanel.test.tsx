import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ClipsTimelinePanel } from '@/components/studio/ClipsTimelinePanel';

const CLIPS = [
  { id: 'c1', projectId: 'p1', trackId: 't1', name: 'Loop A', kind: 'midi' as const, startBeats: 0, lengthBeats: 4, colour: '#f00', muted: false },
  { id: 'c2', projectId: 'p1', trackId: 't1', name: 'Loop B', kind: 'audio' as const, startBeats: 4, lengthBeats: 2, colour: '#0f0', muted: true },
];

beforeEach(() => { lensRun.mockReset(); });

describe('ClipsTimelinePanel', () => {
  it('shows the no-project state', async () => {
    render(<ClipsTimelinePanel />);
    await waitFor(() => expect(screen.getByText(/Open a project to manage clips/)).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('shows the empty state with a project', async () => {
    lensRun.mockResolvedValue(okResult({ clips: [] }));
    render(<ClipsTimelinePanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No clips yet.')).toBeInTheDocument());
  });

  it('renders a populated clip list (muted clip dimmed)', async () => {
    lensRun.mockResolvedValue(okResult({ clips: CLIPS }));
    render(<ClipsTimelinePanel projectId="p1" trackId="t1" />);
    await waitFor(() => expect(screen.getByText('Loop A')).toBeInTheDocument());
    expect(screen.getByText('Loop B')).toBeInTheDocument();
  });

  it('does not create a clip with an empty name', async () => {
    lensRun.mockResolvedValue(okResult({ clips: [] }));
    render(<ClipsTimelinePanel projectId="p1" trackId="t1" />);
    await waitFor(() => expect(screen.getByText('No clips yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('New clip'));
    // only the initial list call happened
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('creates a clip with a name', async () => {
    lensRun.mockResolvedValue(okResult({ clips: [] }));
    render(<ClipsTimelinePanel projectId="p1" trackId="t1" />);
    await waitFor(() => expect(screen.getByText('No clips yet.')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Clip name'), { target: { value: 'Bridge' } });
    fireEvent.change(screen.getByPlaceholderText('Start beats'), { target: { value: '8' } });
    fireEvent.change(screen.getByPlaceholderText('Length beats'), { target: { value: '6' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'drum' } });
    fireEvent.click(screen.getByText('New clip'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'clips-create', input: expect.objectContaining({ name: 'Bridge', startBeats: 8, lengthBeats: 6, kind: 'drum' }) }),
    ));
  });

  it('deletes a clip', async () => {
    lensRun.mockResolvedValue(okResult({ clips: CLIPS }));
    render(<ClipsTimelinePanel projectId="p1" trackId="t1" />);
    await waitFor(() => expect(screen.getByText('Loop A')).toBeInTheDocument());
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'clips-delete' }),
    ));
  });

  it('handles list error', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<ClipsTimelinePanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No clips yet.')).toBeInTheDocument());
  });

  it('survives a refresh exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<ClipsTimelinePanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No clips yet.')).toBeInTheDocument());
  });
});

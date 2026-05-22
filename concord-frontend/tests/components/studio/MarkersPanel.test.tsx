import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MarkersPanel } from '@/components/studio/MarkersPanel';

const MARKERS = [
  { id: 'm1', projectId: 'p1', name: 'Verse', timeBeats: 8, colour: '#fbbf24', kind: 'section' },
  { id: 'm2', projectId: 'p1', name: 'Loop A', timeBeats: 16, colour: '#22d3ee', kind: 'loop_start' },
];

beforeEach(() => { lensRun.mockReset(); });

describe('MarkersPanel', () => {
  it('shows the no-project state', async () => {
    render(<MarkersPanel />);
    await waitFor(() => expect(screen.getByText('Select a project.')).toBeInTheDocument());
  });

  it('shows the empty state with a project', async () => {
    lensRun.mockResolvedValue(okResult({ markers: [] }));
    render(<MarkersPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No markers yet.')).toBeInTheDocument());
  });

  it('renders populated markers (kind underscore replaced)', async () => {
    lensRun.mockResolvedValue(okResult({ markers: MARKERS }));
    render(<MarkersPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Verse')).toBeInTheDocument());
    expect(screen.getByText('loop start')).toBeInTheDocument();
  });

  it('ignores add with empty name', async () => {
    lensRun.mockResolvedValue(okResult({ markers: [] }));
    render(<MarkersPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No markers yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add marker'));
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('adds a marker', async () => {
    lensRun.mockResolvedValue(okResult({ markers: [] }));
    render(<MarkersPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No markers yet.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Marker name'), { target: { value: 'Drop' } });
    fireEvent.change(screen.getByPlaceholderText('Time beats'), { target: { value: '12' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cue' } });
    fireEvent.click(screen.getByText('Add marker'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'markers-add', input: expect.objectContaining({ name: 'Drop', timeBeats: 12, kind: 'cue' }) }),
    ));
  });

  it('deletes a marker', async () => {
    lensRun.mockResolvedValue(okResult({ markers: MARKERS }));
    render(<MarkersPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Verse')).toBeInTheDocument());
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'markers-delete' }),
    ));
  });

  it('handles list error envelope', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<MarkersPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No markers yet.')).toBeInTheDocument());
  });

  it('survives a refresh exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<MarkersPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No markers yet.')).toBeInTheDocument());
  });
});

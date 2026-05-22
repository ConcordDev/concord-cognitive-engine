import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MidiPianoRoll } from '@/components/studio/MidiPianoRoll';

const NOTES = [
  { id: 'n1', clipId: 'c1', pitch: 60, velocity: 96, startBeats: 0, lengthBeats: 1 },
  { id: 'n2', clipId: 'c1', pitch: 67, velocity: 40, startBeats: 2, lengthBeats: 0.5 },
];

beforeEach(() => { lensRun.mockReset(); });

describe('MidiPianoRoll', () => {
  it('shows the no-clip state', async () => {
    render(<MidiPianoRoll />);
    await waitFor(() => expect(screen.getByText(/Select a MIDI clip to edit notes/)).toBeInTheDocument());
  });

  it('renders an empty list with a clip', async () => {
    lensRun.mockResolvedValue(okResult({ notes: [] }));
    render(<MidiPianoRoll clipId="c1" />);
    await waitFor(() => expect(screen.getByText('0 notes')).toBeInTheDocument());
  });

  it('renders populated notes with note names', async () => {
    lensRun.mockResolvedValue(okResult({ notes: NOTES }));
    render(<MidiPianoRoll clipId="c1" />);
    await waitFor(() => expect(screen.getByText('2 notes')).toBeInTheDocument());
    expect(screen.getByText('C4')).toBeInTheDocument();
    expect(screen.getByText('G4')).toBeInTheDocument();
  });

  it('adds a note', async () => {
    lensRun.mockResolvedValue(okResult({ notes: [] }));
    render(<MidiPianoRoll clipId="c1" />);
    await waitFor(() => expect(screen.getByText('0 notes')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Pitch 0-127'), { target: { value: '64' } });
    fireEvent.change(screen.getByPlaceholderText('Velocity'), { target: { value: '110' } });
    fireEvent.change(screen.getByPlaceholderText('Start'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Length'), { target: { value: '0.25' } });
    fireEvent.click(screen.getByText('Add note'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'midi-notes-add', input: expect.objectContaining({ pitch: 64, velocity: 110, startBeats: 1, lengthBeats: 0.25 }) }),
    ));
  });

  it('deletes a note via the row trash button', async () => {
    lensRun.mockResolvedValue(okResult({ notes: NOTES }));
    render(<MidiPianoRoll clipId="c1" />);
    await waitFor(() => expect(screen.getByText('C4')).toBeInTheDocument());
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'midi-notes-delete' }),
    ));
  });

  it('deletes a note via double-click on the piano roll block', async () => {
    lensRun.mockResolvedValue(okResult({ notes: NOTES }));
    const { container } = render(<MidiPianoRoll clipId="c1" />);
    await waitFor(() => expect(screen.getByText('C4')).toBeInTheDocument());
    const block = container.querySelector('div[title^="C4"]')!;
    fireEvent.doubleClick(block);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'midi-notes-delete' }),
    ));
  });

  it('handles list error and refresh exception', async () => {
    lensRun.mockResolvedValueOnce(errResult());
    const { rerender } = render(<MidiPianoRoll clipId="c1" />);
    await waitFor(() => expect(screen.getByText('0 notes')).toBeInTheDocument());
    lensRun.mockRejectedValueOnce(new Error('x'));
    rerender(<MidiPianoRoll clipId="c2" />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
  });
});

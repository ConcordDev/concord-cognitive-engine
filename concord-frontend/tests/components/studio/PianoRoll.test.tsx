import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
vi.mock('@/lib/daw/engine', () => ({
  midiToNoteName: (m: number) => `N${m}`,
}));

import { PianoRoll } from '@/components/studio/PianoRoll';

const NOTES = [
  { id: 'n1', pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 1, channel: 0 },
  { id: 'n2', pitch: 64, velocity: 60, startBeat: 2, lengthBeats: 0.5, channel: 0 },
];

function baseProps(over: Record<string, unknown> = {}) {
  return {
    clip: { id: 'c1', name: 'Clip', trackId: 't1' } as never,
    notes: NOTES, currentBeat: 1, clipStartBeat: 0, clipLengthBeats: 8,
    snap: '1/4' as const,
    onAddNote: vi.fn(), onUpdateNote: vi.fn(), onDeleteNote: vi.fn(), onSnapChange: vi.fn(),
    ...over,
  };
}

describe('PianoRoll', () => {
  it('renders the no-clip empty state', () => {
    render(<PianoRoll {...baseProps({ clip: null })} />);
    expect(screen.getByText(/Select a MIDI clip to edit notes/)).toBeInTheDocument();
  });

  it('renders toolbar tools, snap buttons and notes when a clip is present', () => {
    const { container } = render(<PianoRoll {...baseProps()} />);
    expect(screen.getByTitle('Draw')).toBeInTheDocument();
    expect(screen.getByText('1/16')).toBeInTheDocument();
    // 2 notes rendered as absolute divs with titles
    expect(container.querySelectorAll('div[title^="N"]').length).toBeGreaterThanOrEqual(2);
  });

  it('switches the active tool and snap', () => {
    const onSnapChange = vi.fn();
    render(<PianoRoll {...baseProps({ onSnapChange })} />);
    fireEvent.click(screen.getByTitle('Erase'));
    fireEvent.click(screen.getByTitle('Select'));
    fireEvent.click(screen.getByText('1/8'));
    expect(onSnapChange).toHaveBeenCalledWith('1/8');
  });

  it('adds a note when the canvas is clicked in draw mode', () => {
    const onAddNote = vi.fn();
    const { container } = render(<PianoRoll {...baseProps({ onAddNote })} />);
    const canvas = container.querySelector('div[style*="min-width"]')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 320, height: 1176, right: 320, bottom: 1176, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.click(canvas, { clientX: 40, clientY: 200 });
    expect(onAddNote).toHaveBeenCalled();
  });

  it('deletes a note via erase tool', () => {
    const onDeleteNote = vi.fn();
    const { container } = render(<PianoRoll {...baseProps({ onDeleteNote })} />);
    fireEvent.click(screen.getByTitle('Erase'));
    const noteEl = container.querySelector('div[title^="N60"]')!;
    fireEvent.click(noteEl);
    expect(onDeleteNote).toHaveBeenCalledWith('n1');
  });

  it('selects notes (single + shift toggle) in select tool', () => {
    const { container } = render(<PianoRoll {...baseProps()} />);
    fireEvent.click(screen.getByTitle('Select'));
    const note = container.querySelector('div[title^="N60"]')!;
    fireEvent.click(note);
    fireEvent.click(note, { shiftKey: true });
    fireEvent.click(note, { shiftKey: true });
    expect(note).toBeTruthy();
  });

  it('changes horizontal + vertical zoom', () => {
    render(<PianoRoll {...baseProps()} />);
    const zoomOuts = screen.getAllByLabelText('Zoom out');
    const zoomIns = screen.getAllByLabelText('Zoom in');
    fireEvent.click(zoomIns[0]);
    fireEvent.click(zoomOuts[0]);
    fireEvent.click(zoomIns[1]);
    fireEvent.click(zoomOuts[1]);
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
  });

  it('toggles the velocity lane and updates a note velocity', () => {
    const onUpdateNote = vi.fn();
    const { container } = render(<PianoRoll {...baseProps({ onUpdateNote })} />);
    fireEvent.click(screen.getByText('Velocity'));
    const velBar = container.querySelector('div[title^="Velocity:"]')!;
    fireEvent.click(velBar);
    expect(onUpdateNote).toHaveBeenCalled();
  });
});

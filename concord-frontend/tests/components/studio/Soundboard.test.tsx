import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));

import { Soundboard } from '@/components/studio/Soundboard';

const SYNTH_PRESETS = [
  { id: 'sp1', name: 'House Lead', type: 'subtractive', tags: ['house', 'bright'] },
  { id: 'sp2', name: 'Deep Pad', type: 'subtractive', tags: ['pad'] },
] as never[];

const DRUM_PATTERNS = [
  { id: 'dp1', name: 'Four Floor' },
] as never[];

const DTU_EVENTS = [
  { type: 'instrument', timestamp: 100, tags: ['lead'], data: { presetId: 'i1', presetName: 'Saved Lead' }, meta: { presetName: 'Saved Lead' } },
  { type: 'effect', timestamp: 200, tags: ['fx'], data: { context: 'Verb Chain', effects: [{ id: 'e1' }] }, meta: {} },
  { type: 'pattern', timestamp: 300, tags: ['drums'], data: { genre: 'techno' }, meta: {} },
  { type: 'audio', timestamp: 400, tags: ['vox'], data: { bufferId: 'ab1', name: 'Vocal Chop' }, meta: {} },
] as never[];

function baseProps(over: Record<string, unknown> = {}) {
  return {
    dtuEvents: DTU_EVENTS, synthPresets: SYNTH_PRESETS, effectPresets: [] as never[],
    drumPatterns: DRUM_PATTERNS, currentKey: 'C', currentBpm: 128, currentGenre: 'house',
    onLoadPreset: vi.fn(), onLoadEffectChain: vi.fn(), onLoadPattern: vi.fn(), onDragToTrack: vi.fn(),
    ...over,
  };
}

describe('Soundboard', () => {
  it('renders the header, tabs and grid items', () => {
    render(<Soundboard {...baseProps()} />);
    expect(screen.getByText('Soundboard')).toBeInTheDocument();
    expect(screen.getByText('House Lead')).toBeInTheDocument();
    expect(screen.getByText(/Context: C 128BPM/)).toBeInTheDocument();
  });

  it('filters items by search', () => {
    render(<Soundboard {...baseProps()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search sounds/), { target: { value: 'deep' } });
    expect(screen.getByText('Deep Pad')).toBeInTheDocument();
    expect(screen.queryByText('House Lead')).not.toBeInTheDocument();
  });

  it('shows the no-items empty state when search matches nothing', () => {
    render(<Soundboard {...baseProps()} />);
    fireEvent.change(screen.getByPlaceholderText(/Search sounds/), { target: { value: 'zzzzz' } });
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('switches between tabs', () => {
    render(<Soundboard {...baseProps()} />);
    fireEvent.click(screen.getByText(/^Effects/));
    expect(screen.getByText('Verb Chain')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Patterns/));
    expect(screen.getByText('Four Floor')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Audio/));
    expect(screen.getByText('Vocal Chop')).toBeInTheDocument();
  });

  it('shows AI suggestions on that tab', () => {
    render(<Soundboard {...baseProps()} />);
    fireEvent.click(screen.getByText(/AI Suggests/));
    expect(screen.getByText(/Smart suggestions based on your project/)).toBeInTheDocument();
    expect(screen.getByText('House Lead')).toBeInTheDocument(); // genre-matched suggestion
  });

  it('loads a preset by clicking a grid item', () => {
    const onLoadPreset = vi.fn();
    render(<Soundboard {...baseProps({ onLoadPreset })} />);
    fireEvent.click(screen.getByText('House Lead'));
    expect(onLoadPreset).toHaveBeenCalled();
  });

  it('toggles a favorite (re-sorts the list)', () => {
    render(<Soundboard {...baseProps()} />);
    const favButtons = screen.getAllByLabelText('Favorite');
    fireEvent.click(favButtons[0]);
    expect(screen.getByText('House Lead')).toBeInTheDocument();
  });

  it('switches to list view and loads via the play button', () => {
    const onLoadPreset = vi.fn();
    render(<Soundboard {...baseProps({ onLoadPreset })} />);
    fireEvent.click(screen.getByLabelText('List view'));
    fireEvent.click(screen.getAllByLabelText('Play')[0]);
    expect(onLoadPreset).toHaveBeenCalled();
  });

  it('drag-starts an item onto a track', () => {
    const onDragToTrack = vi.fn();
    render(<Soundboard {...baseProps({ onDragToTrack })} />);
    fireEvent.dragStart(screen.getByText('House Lead').closest('div[draggable]')!);
    expect(onDragToTrack).toHaveBeenCalled();
  });

  it('loads an effect chain + pattern from suggestions', () => {
    const onLoadEffectChain = vi.fn();
    const onLoadPattern = vi.fn();
    render(<Soundboard {...baseProps({ onLoadEffectChain, onLoadPattern })} />);
    fireEvent.click(screen.getByText(/^Effects/));
    fireEvent.click(screen.getByText('Verb Chain'));
    expect(onLoadEffectChain).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/^Patterns/));
    fireEvent.click(screen.getByText('Four Floor'));
    expect(onLoadPattern).toHaveBeenCalled();
  });

  it('handles a null genre gracefully', () => {
    render(<Soundboard {...baseProps({ currentGenre: null })} />);
    expect(screen.getByText(/Context: C 128BPM/)).toBeInTheDocument();
  });
});

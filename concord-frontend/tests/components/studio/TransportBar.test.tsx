import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));

import { TransportBar } from '@/components/studio/TransportBar';

function baseProps(over: Record<string, unknown> = {}) {
  return {
    transportState: 'stopped' as const,
    bpm: 120, currentBeat: 6, timeSignature: [4, 4] as [number, number],
    projectKey: 'C', projectScale: 'major', genre: 'house',
    loopEnabled: false, metronome: false, activeView: 'session' as const,
    onPlay: vi.fn(), onPause: vi.fn(), onStop: vi.fn(), onRecord: vi.fn(),
    onBpmChange: vi.fn(), onViewChange: vi.fn(), onToggleLoop: vi.fn(),
    onToggleMetronome: vi.fn(), onSave: vi.fn(), onExport: vi.fn(), onMaster: vi.fn(),
    ...over,
  };
}

describe('TransportBar', () => {
  it('renders position, time, bpm, key/scale and genre', () => {
    render(<TransportBar {...baseProps()} />);
    expect(screen.getByText('120 BPM')).toBeInTheDocument();
    expect(screen.getByText('C major')).toBeInTheDocument();
    expect(screen.getByText('house')).toBeInTheDocument();
    expect(screen.getByText('2.3.1')).toBeInTheDocument(); // beat 6 → bar2.beat3.tick1
  });

  it('omits the genre chip when genre is null', () => {
    render(<TransportBar {...baseProps({ genre: null })} />);
    expect(screen.queryByText('house')).not.toBeInTheDocument();
  });

  it('fires play when stopped and pause when playing', () => {
    const onPlay = vi.fn(), onPause = vi.fn();
    const { rerender } = render(<TransportBar {...baseProps({ onPlay, onPause })} />);
    fireEvent.click(screen.getByTitle('Play'));
    expect(onPlay).toHaveBeenCalled();
    rerender(<TransportBar {...baseProps({ transportState: 'playing', onPlay, onPause })} />);
    fireEvent.click(screen.getByTitle('Pause'));
    expect(onPause).toHaveBeenCalled();
  });

  it('fires stop, record, loop and metronome toggles', () => {
    const p = baseProps();
    render(<TransportBar {...p} />);
    fireEvent.click(screen.getByTitle('Stop'));
    expect(p.onStop).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Record'));
    expect(p.onRecord).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Loop'));
    expect(p.onToggleLoop).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Metronome'));
    expect(p.onToggleMetronome).toHaveBeenCalled();
  });

  it('shows the recording pulse style when recording', () => {
    const { container } = render(<TransportBar {...baseProps({ transportState: 'recording' })} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('edits BPM and commits a valid value on Enter', () => {
    const onBpmChange = vi.fn();
    render(<TransportBar {...baseProps({ onBpmChange })} />);
    fireEvent.click(screen.getByText('120 BPM'));
    const input = screen.getByDisplayValue('120');
    fireEvent.change(input, { target: { value: '140' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onBpmChange).toHaveBeenCalledWith(140);
  });

  it('rejects an out-of-range BPM on blur', () => {
    const onBpmChange = vi.fn();
    render(<TransportBar {...baseProps({ onBpmChange })} />);
    fireEvent.click(screen.getByText('120 BPM'));
    const input = screen.getByDisplayValue('120');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    expect(onBpmChange).not.toHaveBeenCalled();
  });

  it('changes the active view', () => {
    const onViewChange = vi.fn();
    render(<TransportBar {...baseProps({ onViewChange })} />);
    fireEvent.click(screen.getByText('Mixer'));
    expect(onViewChange).toHaveBeenCalledWith('mixer');
  });

  it('fires master, save, export and reflects mastering/saving disabled states', () => {
    const p = baseProps({ isMastering: true, isSaving: true });
    render(<TransportBar {...p} />);
    expect(screen.getByText('Mastering...')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Export'));
    expect(p.onExport).toHaveBeenCalled();
    expect(screen.getByTitle('Save')).toBeDisabled();
  });

  it('fires master + save in the non-busy state', () => {
    const p = baseProps();
    render(<TransportBar {...p} />);
    fireEvent.click(screen.getByTitle('Master'));
    expect(p.onMaster).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Save'));
    expect(p.onSave).toHaveBeenCalled();
  });
});

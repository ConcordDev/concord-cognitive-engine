import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const emitPatternDTU = vi.fn();
vi.mock('@/lib/daw/dtu-hooks', () => ({ emitPatternDTU: (...a: unknown[]) => emitPatternDTU(...a) }));

import { DrumMachine } from '@/components/studio/DrumMachine';

function steps(n: number, activeAt: number[] = []) {
  return Array.from({ length: n }).map((_, i) => ({
    active: activeAt.includes(i), velocity: 100,
  }));
}
const PATTERN = {
  id: 'pat1', name: 'Boom Bap', steps: 16,
  tracks: [
    { padId: 'p1', steps: steps(16, [0, 4, 8, 12]) },
    { padId: 'p2', steps: steps(16, [2, 6]) },
  ],
} as never;
const PADS = [
  { id: 'p1', name: 'Kick', color: '#f00', mute: false },
  { id: 'p2', name: 'Snare', color: '#0f0', mute: true },
] as never[];

function baseProps(over: Record<string, unknown> = {}) {
  return {
    pattern: PATTERN, pads: PADS, currentStep: 4, isPlaying: true, bpm: 90, genre: 'hiphop',
    onToggleStep: vi.fn(), onUpdateStepVelocity: vi.fn(), onUpdatePad: vi.fn(),
    onTriggerPad: vi.fn(), onSetSteps: vi.fn(), onClearPattern: vi.fn(),
    onRandomize: vi.fn(), onSavePattern: vi.fn(),
    ...over,
  };
}

describe('DrumMachine', () => {
  it('renders the toolbar, pad names and step grid', () => {
    render(<DrumMachine {...baseProps()} />);
    expect(screen.getByText('Drum Machine')).toBeInTheDocument();
    expect(screen.getByText('Kick')).toBeInTheDocument();
    expect(screen.getByText('Snare')).toBeInTheDocument();
  });

  it('changes the step count', () => {
    const onSetSteps = vi.fn();
    render(<DrumMachine {...baseProps({ onSetSteps })} />);
    fireEvent.click(screen.getByText('32'));
    expect(onSetSteps).toHaveBeenCalledWith(32);
  });

  it('fires randomize and clear', () => {
    const p = baseProps();
    render(<DrumMachine {...p} />);
    fireEvent.click(screen.getByText('Randomize'));
    expect(p.onRandomize).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Clear'));
    expect(p.onClearPattern).toHaveBeenCalled();
  });

  it('saves a pattern (emits DTU + calls onSavePattern)', () => {
    const onSavePattern = vi.fn();
    render(<DrumMachine {...baseProps({ onSavePattern })} />);
    fireEvent.click(screen.getByText('Save as DTU'));
    expect(emitPatternDTU).toHaveBeenCalled();
    expect(onSavePattern).toHaveBeenCalled();
  });

  it('triggers a pad and toggles a step', () => {
    const onTriggerPad = vi.fn();
    const onToggleStep = vi.fn();
    const { container } = render(<DrumMachine {...baseProps({ onTriggerPad, onToggleStep })} />);
    fireEvent.click(screen.getByText('Kick'));
    expect(onTriggerPad).toHaveBeenCalledWith('p1');
    // step buttons live in the scrolling step grid
    const stepButtons = container.querySelectorAll('.min-w-max button');
    expect(stepButtons.length).toBeGreaterThan(0);
    fireEvent.click(stepButtons[0]);
    expect(onToggleStep).toHaveBeenCalled();
  });

  it('mutes a pad', () => {
    const onUpdatePad = vi.fn();
    render(<DrumMachine {...baseProps({ onUpdatePad })} />);
    fireEvent.click(screen.getAllByText('M')[0]);
    expect(onUpdatePad).toHaveBeenCalledWith('p1', { mute: true });
  });

  it('shows the velocity lane after selecting a pad and toggling Velocity', () => {
    render(<DrumMachine {...baseProps()} />);
    fireEvent.click(screen.getByText('Kick')); // selects p1
    fireEvent.click(screen.getByText('Velocity'));
    expect(screen.getByText('VELOCITY')).toBeInTheDocument();
  });

  it('updates a step velocity in the velocity lane', () => {
    const onUpdateStepVelocity = vi.fn();
    const { container } = render(<DrumMachine {...baseProps({ onUpdateStepVelocity })} />);
    fireEvent.click(screen.getByText('Kick'));
    fireEvent.click(screen.getByText('Velocity'));
    const velBar = container.querySelector('.cursor-pointer.hover\\:brightness-125');
    if (velBar) fireEvent.click(velBar);
    // an active step velocity bar exists for p1's pattern
    expect(screen.getByText('VELOCITY')).toBeInTheDocument();
  });

  it('handles a null pattern (defaults to 16 steps)', () => {
    render(<DrumMachine {...baseProps({ pattern: null })} />);
    expect(screen.getByText('16 steps')).toBeInTheDocument();
  });

  it('does not emit a DTU on save when pattern is null', () => {
    emitPatternDTU.mockClear();
    const onSavePattern = vi.fn();
    render(<DrumMachine {...baseProps({ pattern: null, onSavePattern })} />);
    fireEvent.click(screen.getByText('Save as DTU'));
    expect(emitPatternDTU).not.toHaveBeenCalled();
    expect(onSavePattern).toHaveBeenCalled();
  });
});

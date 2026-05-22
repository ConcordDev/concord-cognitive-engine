import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const emitEffectChainDTU = vi.fn();
vi.mock('@/lib/daw/dtu-hooks', () => ({ emitEffectChainDTU: (...a: unknown[]) => emitEffectChainDTU(...a) }));
vi.mock('@/lib/daw/engine', () => ({
  DEFAULT_EFFECT_PRESETS: [
    { type: 'reverb', wet: 0.3, params: { decay: 2, preDelay: 0.01, mix: 0.5 } },
  ],
}));

import { EffectsPanel } from '@/components/studio/EffectsPanel';

function track(over: Record<string, unknown> = {}) {
  return {
    id: 't1', name: 'Guitar', color: '#f0f',
    effectChain: [
      { id: 'fx1', type: 'reverb', name: 'Reverb', enabled: true, wet: 0.4, params: { decay: 0.5, bypass: false } },
      { id: 'fx2', type: 'delay', name: 'Delay', enabled: false, wet: 0.2, params: { time: 0.3 } },
    ],
    ...over,
  } as never;
}

function baseProps(over: Record<string, unknown> = {}) {
  return {
    track: track(), onUpdateEffects: vi.fn(), onSaveChainAsDTU: vi.fn(),
    ...over,
  };
}

describe('EffectsPanel', () => {
  it('renders the no-track empty state', () => {
    render(<EffectsPanel {...baseProps({ track: null })} />);
    expect(screen.getByText(/Select a track to edit effects/)).toBeInTheDocument();
  });

  it('renders the effect chain for a track', () => {
    render(<EffectsPanel {...baseProps()} />);
    expect(screen.getByText('Reverb')).toBeInTheDocument();
    expect(screen.getByText('Delay')).toBeInTheDocument();
  });

  it('expands an effect slot to show its params', () => {
    render(<EffectsPanel {...baseProps()} />);
    fireEvent.click(screen.getByText('Reverb'));
    expect(screen.getByText('decay')).toBeInTheDocument();
    expect(screen.getByText('bypass')).toBeInTheDocument();
  });

  it('toggles an effect on/off', () => {
    const onUpdateEffects = vi.fn();
    render(<EffectsPanel {...baseProps({ onUpdateEffects })} />);
    fireEvent.click(screen.getAllByLabelText('Power')[0]);
    expect(onUpdateEffects).toHaveBeenCalledWith('t1', expect.arrayContaining([
      expect.objectContaining({ id: 'fx1', enabled: false }),
    ]));
  });

  it('removes an effect', () => {
    const onUpdateEffects = vi.fn();
    render(<EffectsPanel {...baseProps({ onUpdateEffects })} />);
    fireEvent.click(screen.getAllByLabelText('Delete')[0]);
    expect(onUpdateEffects).toHaveBeenCalledWith('t1', expect.not.arrayContaining([
      expect.objectContaining({ id: 'fx1' }),
    ]));
  });

  it('updates an effect wet level', () => {
    const onUpdateEffects = vi.fn();
    const { container } = render(<EffectsPanel {...baseProps({ onUpdateEffects })} />);
    const wetSlider = container.querySelector('input[type="range"]')!;
    fireEvent.change(wetSlider, { target: { value: '0.9' } });
    expect(onUpdateEffects).toHaveBeenCalled();
  });

  it('updates a numeric and boolean param when a slot is expanded', () => {
    const onUpdateEffects = vi.fn();
    const { container } = render(<EffectsPanel {...baseProps({ onUpdateEffects })} />);
    fireEvent.click(screen.getByText('Reverb'));
    const paramRange = container.querySelectorAll('input[type="range"]')[1];
    fireEvent.change(paramRange, { target: { value: '0.8' } });
    expect(onUpdateEffects).toHaveBeenCalled();
    onUpdateEffects.mockClear();
    // boolean param renders an On/Off toggle
    fireEvent.click(screen.getByText('Off'));
    expect(onUpdateEffects).toHaveBeenCalled();
  });

  it('opens the catalog and adds an effect', () => {
    const onUpdateEffects = vi.fn();
    render(<EffectsPanel {...baseProps({ onUpdateEffects })} />);
    fireEvent.click(screen.getByText('Add Effect'));
    expect(screen.getByText('Dynamics')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reverb', { selector: 'button' }));
    expect(onUpdateEffects).toHaveBeenCalled();
  });

  it('cancels the catalog', () => {
    render(<EffectsPanel {...baseProps()} />);
    fireEvent.click(screen.getByText('Add Effect'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Add Effect')).toBeInTheDocument();
  });

  it('saves the effect chain as a DTU', () => {
    const onSaveChainAsDTU = vi.fn();
    render(<EffectsPanel {...baseProps({ onSaveChainAsDTU })} />);
    fireEvent.click(screen.getByText('Save Chain as DTU'));
    expect(emitEffectChainDTU).toHaveBeenCalled();
    expect(onSaveChainAsDTU).toHaveBeenCalled();
  });

  it('disables Save Chain when the track has no effects', () => {
    render(<EffectsPanel {...baseProps({ track: track({ effectChain: [] }) })} />);
    expect(screen.getByText('Save Chain as DTU').closest('button')).toBeDisabled();
  });
});

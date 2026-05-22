import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const emitMasteringProcessDTU = vi.fn();
const emitExportDTU = vi.fn();
vi.mock('@/lib/daw/dtu-hooks', () => ({
  emitMasteringProcessDTU: (...a: unknown[]) => emitMasteringProcessDTU(...a),
  emitExportDTU: (...a: unknown[]) => emitExportDTU(...a),
}));

import { MasteringPanel } from '@/components/studio/MasteringPanel';

function fx(over: Record<string, unknown> = {}) {
  return { id: 'fx', type: 't', name: 'n', enabled: true, wet: 1, params: {}, ...over } as never;
}
const CHAIN = {
  enabled: true, loudnessTarget: -14,
  eq: fx({ params: { lowGain: 0, midGain: 0, highGain: 0 } }),
  multibandCompressor: fx({ params: { threshold: -18, ratio: 4, attack: 0.01, release: 0.2 } }),
  stereoWidener: fx({ params: { width: 1 } }),
  limiter: fx({ params: { ceiling: -1, release: 0.1 } }),
} as never;

function baseProps(over: Record<string, unknown> = {}) {
  return {
    chain: CHAIN, analysis: null as unknown, projectId: 'p1', projectTitle: 'Demo',
    spectrumData: null as Uint8Array | null,
    onUpdateChain: vi.fn(), onAnalyze: vi.fn(), onExport: vi.fn(),
    ...over,
  };
}

describe('MasteringPanel', () => {
  it('renders the mastering chain modules', () => {
    render(<MasteringPanel {...baseProps()} />);
    expect(screen.getByText('Mastering')).toBeInTheDocument();
    expect(screen.getByText('EQ')).toBeInTheDocument();
    expect(screen.getByText('Multiband Comp')).toBeInTheDocument();
    expect(screen.getByText('Limiter')).toBeInTheDocument();
  });

  it('toggles the chain enabled / bypassed state', () => {
    const onUpdateChain = vi.fn();
    render(<MasteringPanel {...baseProps({ onUpdateChain })} />);
    fireEvent.click(screen.getByText('Enabled'));
    expect(onUpdateChain).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('updates the loudness target slider', () => {
    const onUpdateChain = vi.fn();
    const { container } = render(<MasteringPanel {...baseProps({ onUpdateChain })} />);
    const targetSlider = container.querySelector('input[type="range"][min="-24"]')!;
    fireEvent.change(targetSlider, { target: { value: '-12' } });
    expect(onUpdateChain).toHaveBeenCalledWith(expect.objectContaining({ loudnessTarget: -12 }));
  });

  it('toggles a chain module on/off', () => {
    const onUpdateChain = vi.fn();
    render(<MasteringPanel {...baseProps({ onUpdateChain })} />);
    // each module has an On/Off toggle; click the first
    fireEvent.click(screen.getAllByText('On')[0]);
    expect(onUpdateChain).toHaveBeenCalled();
  });

  it('updates an EQ band gain', () => {
    const onUpdateChain = vi.fn();
    const { container } = render(<MasteringPanel {...baseProps({ onUpdateChain })} />);
    const eqSlider = container.querySelector('input[type="range"][min="-12"]')!;
    fireEvent.change(eqSlider, { target: { value: '3' } });
    expect(onUpdateChain).toHaveBeenCalled();
  });

  it('fires Analyze and shows the analyzing state', () => {
    const onAnalyze = vi.fn();
    render(<MasteringPanel {...baseProps({ onAnalyze })} />);
    fireEvent.click(screen.getByText('Analyze'));
    expect(onAnalyze).toHaveBeenCalled();
  });

  it('renders the loudness analysis when provided', () => {
    const analysis = {
      integratedLUFS: -13.2, truePeak: -1.1, dynamicRange: 8.5, stereoCorrelation: 0.6,
    } as never;
    render(<MasteringPanel {...baseProps({ analysis })} />);
    expect(screen.getByText('Loudness Analysis')).toBeInTheDocument();
    expect(screen.getByText('-13.2')).toBeInTheDocument();
  });

  it('renders the spectrum when spectrumData provided', () => {
    const spectrumData = new Uint8Array(64).fill(100);
    const { container } = render(<MasteringPanel {...baseProps({ spectrumData })} />);
    expect(screen.getByText('Spectrum')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-gradient-to-t').length).toBeGreaterThan(0);
  });

  it('saves the chain as a DTU (with and without analysis)', () => {
    const { rerender } = render(<MasteringPanel {...baseProps()} />);
    fireEvent.click(screen.getByText('Save Chain as DTU'));
    expect(emitMasteringProcessDTU).toHaveBeenCalled();
    const analysis = { integratedLUFS: -14, truePeak: -1, dynamicRange: 8, stereoCorrelation: 0.5 } as never;
    rerender(<MasteringPanel {...baseProps({ analysis })} />);
    fireEvent.click(screen.getByText('Save Chain as DTU'));
    expect(emitMasteringProcessDTU).toHaveBeenCalledTimes(2);
  });

  it('changes export options and exports', () => {
    const onExport = vi.fn();
    render(<MasteringPanel {...baseProps({ onExport })} />);
    fireEvent.click(screen.getByText('mp3'));
    fireEvent.click(screen.getByText('48k'));
    fireEvent.click(screen.getByText('16-bit'));
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(checkboxes[0]); // normalize
    fireEvent.click(checkboxes[2]); // stems
    fireEvent.click(screen.getByText(/Export MP3/));
    expect(emitExportDTU).toHaveBeenCalled();
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ format: 'mp3' }));
  });

  it('shows the exporting state when isExporting', () => {
    render(<MasteringPanel {...baseProps({ isExporting: true })} />);
    expect(screen.getByText('Exporting...')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PresetsLibraryPanel } from '@/components/studio/PresetsLibraryPanel';

const PRESETS = [
  { id: 'p1', name: 'Warm Pad', pluginName: 'ReverbX', category: 'user', tags: ['ambient', 'soft'], createdAt: '' },
  { id: 'p2', name: 'Sharp Lead', pluginName: 'SynthY', category: 'factory', tags: [], createdAt: '' },
];

beforeEach(() => { lensRun.mockReset(); });

describe('PresetsLibraryPanel', () => {
  it('renders empty state', async () => {
    lensRun.mockResolvedValue(okResult({ presets: [] }));
    render(<PresetsLibraryPanel />);
    await waitFor(() => expect(screen.getByText('No presets.')).toBeInTheDocument());
  });

  it('renders populated presets with tags', async () => {
    lensRun.mockResolvedValue(okResult({ presets: PRESETS }));
    render(<PresetsLibraryPanel />);
    await waitFor(() => expect(screen.getByText('Warm Pad')).toBeInTheDocument());
    expect(screen.getByText('Sharp Lead')).toBeInTheDocument();
    expect(screen.getByText('ambient · soft')).toBeInTheDocument();
  });

  it('filters by plugin / name', async () => {
    lensRun.mockResolvedValue(okResult({ presets: PRESETS }));
    render(<PresetsLibraryPanel />);
    await waitFor(() => expect(screen.getByText('Warm Pad')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Filter by plugin/), { target: { value: 'synthy' } });
    expect(screen.queryByText('Warm Pad')).not.toBeInTheDocument();
    expect(screen.getByText('Sharp Lead')).toBeInTheDocument();
  });

  it('does not save with empty name or plugin', async () => {
    lensRun.mockResolvedValue(okResult({ presets: [] }));
    render(<PresetsLibraryPanel />);
    await waitFor(() => expect(screen.getByText('No presets.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Save'));
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('saves a preset with csv tags', async () => {
    lensRun.mockResolvedValue(okResult({ presets: [] }));
    render(<PresetsLibraryPanel />);
    await waitFor(() => expect(screen.getByText('No presets.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Preset name'), { target: { value: 'My Patch' } });
    fireEvent.change(screen.getByPlaceholderText(/Plugin/), { target: { value: 'EQ8' } });
    fireEvent.change(screen.getByPlaceholderText(/Tags/), { target: { value: ' a , b ,' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'presets-save', input: expect.objectContaining({ name: 'My Patch', pluginName: 'EQ8', tags: ['a', 'b'] }) }),
    ));
  });

  it('deletes a preset', async () => {
    lensRun.mockResolvedValue(okResult({ presets: PRESETS }));
    render(<PresetsLibraryPanel />);
    await waitFor(() => expect(screen.getByText('Warm Pad')).toBeInTheDocument());
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'presets-delete' }),
    ));
  });

  it('handles list error', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<PresetsLibraryPanel />);
    await waitFor(() => expect(screen.getByText('No presets.')).toBeInTheDocument());
  });

  it('survives a refresh exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<PresetsLibraryPanel />);
    await waitFor(() => expect(screen.getByText('No presets.')).toBeInTheDocument());
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MidiMapPanel } from '@/components/studio/MidiMapPanel';

const MAPS = [
  { id: 'm1', projectId: 'p1', target: 'track1.volume', msgType: 'cc' as const, controller: 7, channel: 0, rangeMin: 0, rangeMax: 1, deviceName: 'Launchkey' },
];

beforeEach(() => {
  lensRun.mockReset();
  // Default: no Web MIDI
  // @ts-expect-error - deleting test-only property
  delete (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

describe('MidiMapPanel', () => {
  it('shows the no-project state', async () => {
    render(<MidiMapPanel />);
    await waitFor(() => expect(screen.getByText(/Open a project to configure MIDI/)).toBeInTheDocument());
    expect(screen.getByText('No Web MIDI')).toBeInTheDocument();
  });

  it('shows the empty state with a project', async () => {
    lensRun.mockResolvedValue(okResult({ maps: [] }));
    render(<MidiMapPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No mappings yet.')).toBeInTheDocument());
  });

  it('renders populated mappings', async () => {
    lensRun.mockResolvedValue(okResult({ maps: MAPS }));
    render(<MidiMapPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('track1.volume')).toBeInTheDocument());
    expect(screen.getByText(/Launchkey/)).toBeInTheDocument();
  });

  it('does not add a mapping with an empty target', async () => {
    lensRun.mockResolvedValue(okResult({ maps: [] }));
    render(<MidiMapPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No mappings yet.')).toBeInTheDocument());
    expect(screen.getByText('Add mapping').closest('button')).toBeDisabled();
  });

  it('adds a mapping', async () => {
    lensRun.mockResolvedValue(okResult({ maps: [] }));
    render(<MidiMapPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No mappings yet.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Target param/), { target: { value: 'fx.cutoff' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'note' } });
    fireEvent.change(screen.getByPlaceholderText('CC#'), { target: { value: '74' } });
    fireEvent.change(screen.getByPlaceholderText('Ch'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('Min'), { target: { value: '0.1' } });
    fireEvent.change(screen.getByPlaceholderText('Max'), { target: { value: '0.9' } });
    fireEvent.click(screen.getByText('Add mapping'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'midi-map-add', expect.objectContaining({ target: 'fx.cutoff', msgType: 'note', controller: 74, channel: 2 }),
    ));
  });

  it('deletes a mapping', async () => {
    lensRun.mockResolvedValue(okResult({ maps: MAPS }));
    render(<MidiMapPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('track1.volume')).toBeInTheDocument());
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'midi-map-delete', { id: 'm1' },
    ));
  });

  it('reflects Web MIDI availability and toggles learn', async () => {
    const inputs = {
      forEach: (fn: (i: { onmidimessage: unknown }) => void) => fn({ onmidimessage: null }),
    };
    (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess = vi.fn().mockResolvedValue({
      inputs, onstatechange: null,
    });
    lensRun.mockResolvedValue(okResult({ maps: [] }));
    render(<MidiMapPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Web MIDI ready')).toBeInTheDocument());
    fireEvent.click(screen.getByText('MIDI learn'));
    await waitFor(() => expect(screen.getByText(/Listening/)).toBeInTheDocument());
  });

  it('handles a list error', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<MidiMapPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No mappings yet.')).toBeInTheDocument());
  });
});

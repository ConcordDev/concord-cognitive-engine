import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { RecordingPanel } from '@/components/studio/RecordingPanel';

const CONFIG = {
  id: 'rc1', projectId: 'p1', metronomeEnabled: true, metronomeVolume: 0.6,
  countInBars: 2, loopRecord: false, compMode: true, punchInBeats: null, punchOutBeats: null,
};
const TAKES = [
  { id: 'tk1', trackId: 't1', takeNumber: 1, name: 'Take One', durationSec: 12, startBeats: 0, selected: true },
  { id: 'tk2', trackId: 't1', takeNumber: 2, name: 'Take Two', durationSec: 8, startBeats: 0, selected: false },
];

beforeEach(() => { lensRun.mockReset(); });

describe('RecordingPanel', () => {
  it('shows the no-project state', async () => {
    render(<RecordingPanel />);
    await waitFor(() => expect(screen.getByText(/Open a project to configure recording/)).toBeInTheDocument());
  });

  it('renders the config form and the no-track takes hint', async () => {
    lensRun.mockResolvedValue(okResult({ config: CONFIG }));
    render(<RecordingPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Record config')).toBeInTheDocument());
    expect(screen.getByText(/Paste a Track ID/)).toBeInTheDocument();
  });

  it('toggles a config checkbox and persists', async () => {
    lensRun.mockResolvedValueOnce(okResult({ config: CONFIG }));
    render(<RecordingPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Record config')).toBeInTheDocument());
    lensRun.mockResolvedValueOnce(okResult({ config: { ...CONFIG, metronomeEnabled: false } }));
    fireEvent.click(screen.getByLabelText('Metronome'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'record-config-set', expect.objectContaining({ metronomeEnabled: false }),
    ));
  });

  it('changes count-in via the select', async () => {
    lensRun.mockResolvedValueOnce(okResult({ config: CONFIG }));
    render(<RecordingPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Record config')).toBeInTheDocument());
    lensRun.mockResolvedValueOnce(okResult({ config: CONFIG }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '4' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'record-config-set', expect.objectContaining({ countInBars: 4 }),
    ));
  });

  it('sets a punch-in beat on blur', async () => {
    lensRun.mockResolvedValueOnce(okResult({ config: CONFIG }));
    render(<RecordingPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Record config')).toBeInTheDocument());
    lensRun.mockResolvedValueOnce(okResult({ config: CONFIG }));
    const punchIn = screen.getByText('Punch-in beat').querySelector('input')!;
    fireEvent.blur(punchIn, { target: { value: '8' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'record-config-set', expect.objectContaining({ punchInBeats: 8 }),
    ));
  });

  it('renders takes for a track and adds one', async () => {
    lensRun.mockResolvedValueOnce(okResult({ config: CONFIG }));
    lensRun.mockResolvedValueOnce(okResult({ takes: TAKES }));
    render(<RecordingPanel projectId="p1" trackId="t1" />);
    await waitFor(() => expect(screen.getByText('#1 Take One')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Take name'), { target: { value: 'Take Three' } });
    fireEvent.change(screen.getByPlaceholderText('Dur s'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Add take'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'takes-add', expect.objectContaining({ name: 'Take Three', durationSec: 5 }),
    ));
  });

  it('selects and removes a take', async () => {
    lensRun.mockResolvedValueOnce(okResult({ config: CONFIG }));
    lensRun.mockResolvedValueOnce(okResult({ takes: TAKES }));
    render(<RecordingPanel projectId="p1" trackId="t1" />);
    await waitFor(() => expect(screen.getByText('#2 Take Two')).toBeInTheDocument());

    lensRun.mockResolvedValue(okResult({ config: CONFIG, takes: TAKES }));
    fireEvent.click(screen.getAllByTitle('Select for comp')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'takes-comp-select', expect.any(Object),
    ));
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'takes-delete', expect.any(Object),
    ));
  });

  it('shows empty takes hint when track has none', async () => {
    lensRun.mockResolvedValueOnce(okResult({ config: CONFIG }));
    lensRun.mockResolvedValueOnce(okResult({ takes: [] }));
    render(<RecordingPanel projectId="p1" trackId="t1" />);
    await waitFor(() => expect(screen.getByText('No takes recorded yet.')).toBeInTheDocument());
  });

  it('survives a refresh exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<RecordingPanel projectId="p1" />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });
});

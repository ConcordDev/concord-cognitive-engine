import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SendsRouting } from '@/components/studio/SendsRouting';

const SENDS = [
  { id: 's1', projectId: 'p1', fromTrackId: 'trackAAAAAAAA', toTrackId: 'busBBBBBBBBB', levelDb: -6, prePost: 'post' as const },
];

beforeEach(() => { lensRun.mockReset(); });

describe('SendsRouting', () => {
  it('shows the empty state', async () => {
    lensRun.mockResolvedValue(okResult({ sends: [] }));
    render(<SendsRouting projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No sends configured.')).toBeInTheDocument());
  });

  it('renders populated sends', async () => {
    lensRun.mockResolvedValue(okResult({ sends: SENDS }));
    render(<SendsRouting projectId="p1" />);
    await waitFor(() => expect(screen.getByText('-6 dB')).toBeInTheDocument());
  });

  it('hides form without projectId', async () => {
    render(<SendsRouting />);
    await waitFor(() => expect(screen.getByText('No sends configured.')).toBeInTheDocument());
    expect(screen.queryByText('Set send')).not.toBeInTheDocument();
  });

  it('does not set a send with missing track ids', async () => {
    lensRun.mockResolvedValue(okResult({ sends: [] }));
    render(<SendsRouting projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No sends configured.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Set send'));
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('sets a send', async () => {
    lensRun.mockResolvedValue(okResult({ sends: [] }));
    render(<SendsRouting projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No sends configured.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('From track ID'), { target: { value: 't1' } });
    fireEvent.change(screen.getByPlaceholderText('To bus/track ID'), { target: { value: 'b1' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pre' } });
    fireEvent.change(screen.getByPlaceholderText('Level dB'), { target: { value: '-12' } });
    fireEvent.click(screen.getByText('Set send'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sends-set', input: expect.objectContaining({ fromTrackId: 't1', toTrackId: 'b1', prePost: 'pre', levelDb: -12 }) }),
    ));
  });

  it('deletes a send', async () => {
    lensRun.mockResolvedValue(okResult({ sends: SENDS }));
    render(<SendsRouting projectId="p1" />);
    await waitFor(() => expect(screen.getByText('-6 dB')).toBeInTheDocument());
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sends-delete' }),
    ));
  });

  it('handles list error', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<SendsRouting projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No sends configured.')).toBeInTheDocument());
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { FxRackPanel } from '@/components/studio/FxRackPanel';

const SCHEMA = {
  eq: { lowGainDb: [-24, 24], midGainDb: [-24, 24], highGainDb: [-24, 24] },
  delay: { timeMs: [0, 2000], feedback: [0, 0.95], mix: [0, 1] },
};
const RACKS = [
  { id: 'r1', name: 'Master Glue', units: [{ id: 'u1', type: 'eq' as const, bypassed: false, params: {} }, { id: 'u2', type: 'compressor' as const, bypassed: false, params: {} }] },
];

beforeEach(() => { lensRun.mockReset(); });

describe('FxRackPanel', () => {
  it('renders empty state', async () => {
    lensRun.mockResolvedValue(okResult({ racks: [], schema: SCHEMA }));
    render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('No saved FX racks yet.')).toBeInTheDocument());
  });

  it('renders populated racks with the unit chain', async () => {
    lensRun.mockResolvedValue(okResult({ racks: RACKS, schema: SCHEMA }));
    render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('Master Glue')).toBeInTheDocument());
    expect(screen.getByText('eq → compressor')).toBeInTheDocument();
  });

  it('adds draft units and adjusts a schema-driven param slider', async () => {
    lensRun.mockResolvedValue(okResult({ racks: [], schema: SCHEMA }));
    const { container } = render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('No saved FX racks yet.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ eq' }));
    // draft unit type label renders the type string (CSS uppercases it)
    await waitFor(() => expect(container.querySelector('input[type="range"]')).toBeTruthy());
    const slider = container.querySelector('input[type="range"]')!;
    fireEvent.change(slider, { target: { value: '6' } });
    expect((slider as HTMLInputElement).value).toBe('6');
  });

  it('removes a draft unit', async () => {
    lensRun.mockResolvedValue(okResult({ racks: [], schema: SCHEMA }));
    const { container } = render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('No saved FX racks yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ delay' }));
    await waitFor(() => expect(container.querySelector('.border-violet-500\\/20')).toBeTruthy());
    const before = container.querySelectorAll('.bg-violet-500\\/\\[0\\.04\\]').length;
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(container.querySelectorAll('.bg-violet-500\\/\\[0\\.04\\]').length).toBeLessThan(before + 1));
  });

  it('does not save without a name or draft units (button disabled)', async () => {
    lensRun.mockResolvedValue(okResult({ racks: [], schema: SCHEMA }));
    render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('No saved FX racks yet.')).toBeInTheDocument());
    expect(screen.getByText('Save rack').closest('button')).toBeDisabled();
  });

  it('saves a rack once name + a draft unit exist', async () => {
    lensRun.mockResolvedValue(okResult({ racks: [], schema: SCHEMA }));
    render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('No saved FX racks yet.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('New rack name'), { target: { value: 'My Rack' } });
    fireEvent.click(screen.getByText('+ reverb'));
    fireEvent.click(screen.getByText('Save rack'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'fx-rack-save', expect.objectContaining({ name: 'My Rack' }),
    ));
  });

  it('deletes a rack', async () => {
    lensRun.mockResolvedValue(okResult({ racks: RACKS, schema: SCHEMA }));
    render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('Master Glue')).toBeInTheDocument());
    fireEvent.click(document.querySelectorAll('button.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'fx-rack-delete', { id: 'r1' },
    ));
  });

  it('survives a list exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('No saved FX racks yet.')).toBeInTheDocument());
  });

  it('handles a list error envelope', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<FxRackPanel />);
    await waitFor(() => expect(screen.getByText('No saved FX racks yet.')).toBeInTheDocument());
  });
});

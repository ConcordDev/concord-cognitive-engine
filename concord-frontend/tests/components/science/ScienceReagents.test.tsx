import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ScienceReagents } from '@/components/science/ScienceReagents';

const REAGENT = {
  id: 'rg1', name: 'Taq Polymerase', catalogNumber: 'C-1', lotNumber: 'L-9',
  vendor: 'NEB', quantity: 3, unit: 'vials', reorderThreshold: 5, location: 'Freezer A',
  hazardClass: 'biohazard', expiryDate: '2020-01-01', lowStock: true, expired: true,
  createdAt: 't', updatedAt: 't',
};

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { reagents: [], lowStockCount: 0, expiredCount: 0 } } });
});

describe('ScienceReagents', () => {
  it('shows the empty state', async () => {
    render(<ScienceReagents />);
    await waitFor(() => expect(screen.getByText(/No reagents tracked yet/)).toBeInTheDocument());
  });

  it('lists reagents with low-stock/expired/hazard badges', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {
      reagents: [REAGENT], lowStockCount: 1, expiredCount: 1,
    } } });
    render(<ScienceReagents />);
    await waitFor(() => expect(screen.getByText('Taq Polymerase')).toBeInTheDocument());
    expect(screen.getByText('1 low stock')).toBeInTheDocument();
    expect(screen.getByText('1 expired')).toBeInTheDocument();
    expect(screen.getByText('biohazard')).toBeInTheDocument();
    expect(screen.getByText('3 vials')).toBeInTheDocument();
  });

  it('opens the new-reagent form and validates name', async () => {
    render(<ScienceReagents />);
    await waitFor(() => screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Reagent/ }));
    expect(screen.getByText('New Reagent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save Reagent/ }));
    await waitFor(() => expect(screen.getByText('Reagent name required')).toBeInTheDocument());
  });

  it('validates non-negative quantity', async () => {
    render(<ScienceReagents />);
    await waitFor(() => screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.change(screen.getByPlaceholderText('Reagent name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('Quantity'), { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Reagent/ }));
    await waitFor(() => expect(screen.getByText(/Quantity must be ≥ 0/)).toBeInTheDocument());
  });

  it('saves a new reagent with hazard + expiry', async () => {
    render(<ScienceReagents />);
    await waitFor(() => screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.change(screen.getByPlaceholderText('Reagent name'), { target: { value: 'Ethanol' } });
    fireEvent.change(screen.getByPlaceholderText('Catalog #'), { target: { value: 'E-1' } });
    fireEvent.change(screen.getByPlaceholderText('Quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('Reorder at'), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'flammable' } });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2030-12-31' } });
    lensRun.mockResolvedValue({ data: { ok: true } });
    fireEvent.click(screen.getByRole('button', { name: /Save Reagent/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'reagent-save', expect.objectContaining({
      name: 'Ethanol', hazardClass: 'flammable', quantity: 10, expiryDate: '2030-12-31',
    })));
  });

  it('shows error on a failed save', async () => {
    render(<ScienceReagents />);
    await waitFor(() => screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.change(screen.getByPlaceholderText('Reagent name'), { target: { value: 'X' } });
    lensRun.mockResolvedValue({ data: { ok: false, error: 'save fail' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Reagent/ }));
    await waitFor(() => expect(screen.getByText('save fail')).toBeInTheDocument());
  });

  it('opens an existing reagent for editing', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'reagent-list') return { data: { ok: true, result: {
        reagents: [REAGENT], lowStockCount: 1, expiredCount: 1 } } };
      if (action === 'reagent-save') return { data: { ok: true } };
      return { data: { ok: true, result: { reagents: [] } } };
    });
    render(<ScienceReagents />);
    await waitFor(() => screen.getByText('Taq Polymerase'));
    fireEvent.click(screen.getByText('Taq Polymerase'));
    await waitFor(() => expect(screen.getByText('Edit Reagent')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Taq Polymerase')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save Reagent/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'reagent-save',
      expect.objectContaining({ id: 'rg1' })));
  });

  it('closes the editor with the back button', async () => {
    render(<ScienceReagents />);
    await waitFor(() => screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Reagent/ }));
    fireEvent.click(screen.getByLabelText('Back'));
    await waitFor(() => expect(screen.getByText(/No reagents tracked yet/)).toBeInTheDocument());
  });

  it('deletes a reagent', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'reagent-list') return { data: { ok: true, result: {
        reagents: [REAGENT], lowStockCount: 0, expiredCount: 0 } } };
      if (action === 'reagent-delete') return { data: { ok: true } };
      return { data: { ok: true, result: { reagents: [] } } };
    });
    render(<ScienceReagents />);
    await waitFor(() => screen.getByText('Taq Polymerase'));
    fireEvent.click(screen.getByLabelText('Delete reagent'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'reagent-delete', { id: 'rg1' }));
  });

  it('shows error on a failed delete', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'reagent-list') return { data: { ok: true, result: {
        reagents: [REAGENT], lowStockCount: 0, expiredCount: 0 } } };
      return { data: { ok: false, error: 'del fail' } };
    });
    render(<ScienceReagents />);
    await waitFor(() => screen.getByText('Taq Polymerase'));
    fireEvent.click(screen.getByLabelText('Delete reagent'));
    await waitFor(() => expect(screen.getByText('del fail')).toBeInTheDocument());
  });

  it('toggles the consume form and validates the amount', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {
      reagents: [REAGENT], lowStockCount: 0, expiredCount: 0 } } });
    render(<ScienceReagents />);
    await waitFor(() => screen.getByText('Taq Polymerase'));
    fireEvent.click(screen.getByLabelText('Consume'));
    expect(screen.getByPlaceholderText(/Amount/)).toBeInTheDocument();
    // invalid amount
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(screen.getByText(/Amount must be > 0/)).toBeInTheDocument());
  });

  it('logs a consumption (reagent-consume)', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'reagent-list') return { data: { ok: true, result: {
        reagents: [REAGENT], lowStockCount: 0, expiredCount: 0 } } };
      if (action === 'reagent-consume') return { data: { ok: true } };
      return { data: { ok: true, result: { reagents: [] } } };
    });
    render(<ScienceReagents />);
    await waitFor(() => screen.getByText('Taq Polymerase'));
    fireEvent.click(screen.getByLabelText('Consume'));
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'PCR setup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'reagent-consume', {
      id: 'rg1', amount: 2, reason: 'PCR setup',
    }));
  });

  it('shows error on a failed consume', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'reagent-list') return { data: { ok: true, result: {
        reagents: [REAGENT], lowStockCount: 0, expiredCount: 0 } } };
      return { data: { ok: false, error: 'consume fail' } };
    });
    render(<ScienceReagents />);
    await waitFor(() => screen.getByText('Taq Polymerase'));
    fireEvent.click(screen.getByLabelText('Consume'));
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(screen.getByText('consume fail')).toBeInTheDocument());
  });
});

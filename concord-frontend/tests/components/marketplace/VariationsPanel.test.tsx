import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { VariationsPanel } from '@/components/marketplace/VariationsPanel';

const LISTINGS = [
  { id: 'l1', title: 'Brass Ring' },
  { id: 'l2', title: 'Wool Hat' },
];

const VARIATIONS = [
  { id: 'v1', sku: 'SK-1', optionName: 'Size', optionValue: 'Large', priceUsd: 12, stockQty: 5 },
  { id: 'v2', sku: '', optionName: 'Size', optionValue: 'Small', priceUsd: 10, stockQty: null },
];

describe('VariationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: LISTINGS } } });
  });

  it('shows the pick-a-listing placeholder initially', async () => {
    render(<VariationsPanel />);
    expect(await screen.findByText(/Pick a listing to manage/)).toBeInTheDocument();
  });

  it('populates the listing dropdown', async () => {
    render(<VariationsPanel />);
    expect(await screen.findByText('Brass Ring')).toBeInTheDocument();
    expect(screen.getByText('Wool Hat')).toBeInTheDocument();
  });

  it('loads variations after selecting a listing', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list')
        return Promise.resolve({ data: { ok: true, result: { variations: VARIATIONS } } });
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    expect(await screen.findByDisplayValue('Large')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Small')).toBeInTheDocument();
  });

  it('shows the no-variations message for an empty listing', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list')
        return Promise.resolve({ data: { ok: true, result: { variations: [] } } });
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    expect(await screen.findByText(/No variations yet/)).toBeInTheDocument();
  });

  it('adds and removes a variation row', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list')
        return Promise.resolve({ data: { ok: true, result: { variations: [] } } });
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    await screen.findByText(/No variations yet/);
    fireEvent.click(screen.getByText('Add variation'));
    expect(screen.getByPlaceholderText('Large')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove variation'));
    expect(screen.queryByPlaceholderText('Large')).not.toBeInTheDocument();
  });

  it('edits a row value via updateRow', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list')
        return Promise.resolve({ data: { ok: true, result: { variations: [] } } });
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    await screen.findByText(/No variations yet/);
    fireEvent.click(screen.getByText('Add variation'));
    const valueInput = screen.getByPlaceholderText('Large');
    fireEvent.change(valueInput, { target: { value: 'Medium' } });
    expect(screen.getByDisplayValue('Medium')).toBeInTheDocument();
  });

  it('updates every input in a variation row', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list')
        return Promise.resolve({ data: { ok: true, result: { variations: [] } } });
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    await screen.findByText(/No variations yet/);
    fireEvent.click(screen.getByText('Add variation'));
    fireEvent.change(screen.getByPlaceholderText('Size'), { target: { value: 'Color' } });
    fireEvent.change(screen.getByPlaceholderText('Large'), { target: { value: 'Red' } });
    fireEvent.change(screen.getByPlaceholderText('auto'), { target: { value: 'CLR-1' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '15' } });
    fireEvent.change(screen.getByPlaceholderText('∞'), { target: { value: '8' } });
    expect(screen.getByDisplayValue('Color')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Red')).toBeInTheDocument();
    expect(screen.getByDisplayValue('CLR-1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('15')).toBeInTheDocument();
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
  });

  it('saves variations and shows the saved confirmation', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list')
        return Promise.resolve({ data: { ok: true, result: { variations: [] } } });
      if (a === 'variations-set')
        return Promise.resolve({ data: { ok: true, result: { variations: VARIATIONS } } });
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    await screen.findByText(/No variations yet/);
    fireEvent.click(screen.getByText('Add variation'));
    fireEvent.change(screen.getByPlaceholderText('Large'), { target: { value: 'XL' } });
    fireEvent.click(screen.getByText('Save variations'));
    expect(await screen.findByText('Variations saved.')).toBeInTheDocument();
  });

  it('shows an error when save returns ok:false', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list')
        return Promise.resolve({ data: { ok: true, result: { variations: [] } } });
      if (a === 'variations-set')
        return Promise.resolve({ data: { ok: false, error: 'duplicate sku' } });
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    await screen.findByText(/No variations yet/);
    fireEvent.click(screen.getByText('Save variations'));
    expect(await screen.findByText('duplicate sku')).toBeInTheDocument();
  });

  it('tolerates a save rejection', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list')
        return Promise.resolve({ data: { ok: true, result: { variations: [] } } });
      if (a === 'variations-set') return Promise.reject(new Error('down'));
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    await screen.findByText(/No variations yet/);
    fireEvent.click(screen.getByText('Save variations'));
    expect(await screen.findByText('Could not save variations')).toBeInTheDocument();
  });

  it('tolerates a variations-list rejection', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'variations-list') return Promise.reject(new Error('down'));
      return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
    });
    render(<VariationsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'l1' } });
    // resets to no-variations once loading completes
    expect(await screen.findByText(/No variations yet/)).toBeInTheDocument();
  });
});

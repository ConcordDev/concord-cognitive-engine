/**
 * GB-1538 / FIX-agriculture-011 — a field created at 42.0308, -93.6319
 * displayed as '42.031, 93.632': the create form's numeric draft fields
 * ran Number(e.target.value) on every keystroke, so typing '-' produced
 * '' → Number('') = 0, the minus vanished from the controlled input, and
 * the longitude was stored positive. The draft now holds strings and
 * parses + range-checks at save. Pins: the '-' survives typing, and the
 * field-create payload carries lng -93.6319.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { FarmWorkbench } from '@/components/agriculture/FarmWorkbench';

let createInput: Record<string, unknown> | null = null;

beforeEach(() => {
  createInput = null;
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (req: { action: string; input?: Record<string, unknown> }) => {
    if (req.action === 'field-list') return { data: { ok: true, result: { fields: [] } } };
    if (req.action === 'field-create') {
      createInput = req.input ?? null;
      return { data: { ok: true, result: { field: { id: 'fld_1', ...(req.input ?? {}) } } } };
    }
    return { data: { ok: true, result: {} } };
  });
});

describe('FarmWorkbench negative coordinates (FIX-agriculture-011)', () => {
  it("typing '-93.6319' into Longitude keeps the minus and saves lng -93.6319", async () => {
    render(<FarmWorkbench open onClose={() => undefined} />);
    fireEvent.click(await screen.findByText('New field'));
    fireEvent.change(screen.getByPlaceholderText(/Field name/), { target: { value: 'North 40' } });

    const lng = screen.getByLabelText(/Longitude/) as HTMLInputElement;
    const lat = screen.getByLabelText(/Latitude/) as HTMLInputElement;
    fireEvent.change(lat, { target: { value: '42.0308' } });
    for (const partial of ['-', '-9', '-93.6319']) {
      fireEvent.change(lng, { target: { value: partial } });
      expect(lng.value).toBe(partial);
    }

    fireEvent.click(screen.getByText('Save field'));
    await waitFor(() => expect(createInput).not.toBeNull());
    expect(createInput).toMatchObject({ lat: 42.0308, lng: -93.6319 });
  });

  it('an out-of-range longitude is refused by name and nothing is sent', async () => {
    render(<FarmWorkbench open onClose={() => undefined} />);
    fireEvent.click(await screen.findByText('New field'));
    fireEvent.change(screen.getByPlaceholderText(/Field name/), { target: { value: 'Far West' } });
    fireEvent.change(screen.getByLabelText(/Longitude/), { target: { value: '-190' } });
    fireEvent.click(screen.getByText('Save field'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Longitude'));
    expect(createInput).toBeNull();
  });
});

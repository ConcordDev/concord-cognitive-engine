// Audit fix sweep (PR #2356) — FIX-realestate-007 / -008 / -010:
// the Add-listing form validates in the open. A failed add keeps the form
// open with the entered values and names the field at fault; the title
// carries a live character counter at the 200-char limit; the numeric
// fields select their contents on focus so typing replaces, not appends.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
let addResult: unknown = { ok: true, result: { listing: { id: 'lst-1' } } };

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((spec: { domain: string; action: string; input: Record<string, unknown> }) => {
    calls.push({ action: spec.action, input: spec.input });
    if (spec.action === 'listings-add') return Promise.resolve({ data: addResult });
    if (spec.action === 'favourites-list') return Promise.resolve({ data: { ok: true, result: { ids: [] } } });
    return Promise.resolve({ data: { ok: true, result: { listings: [] } } });
  }),
}));

import { ListingsBrowser } from '@/components/realestate/ListingsBrowser';

async function openForm() {
  render(<ListingsBrowser />);
  fireEvent.click(screen.getByTitle('Add listing'));
  await waitFor(() => expect(screen.getByPlaceholderText('Title')).toBeTruthy());
}

describe('ListingsBrowser add-listing validation', () => {
  beforeEach(() => {
    calls.length = 0;
    addResult = { ok: true, result: { listing: { id: 'lst-1' } } };
  });

  it('refuses a negative price in the open: form stays, values stay, no add call', async () => {
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Maple St house' } });
    fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: '12 Maple St' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Price must be more than \$0/));
    expect(calls.some(c => c.action === 'listings-add')).toBe(false);
    expect((screen.getByPlaceholderText('Address') as HTMLInputElement).value).toBe('12 Maple St');
    expect((screen.getByPlaceholderText('Price') as HTMLInputElement).value).toBe('-5');
  });

  it('requires a title and says so', async () => {
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: '12 Maple St' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '250000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Title is required/));
    expect(calls.some(c => c.action === 'listings-add')).toBe(false);
  });

  it('shows a live counter and caps the title at 200 characters', async () => {
    await openForm();
    const title = screen.getByPlaceholderText('Title') as HTMLInputElement;
    expect(title.maxLength).toBe(200);
    fireEvent.change(title, { target: { value: 'abc' } });
    await waitFor(() => expect(screen.getByText('3/200')).toBeTruthy());
  });

  it('sends the title with a valid add and closes the form', async () => {
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Sunny condo' } });
    fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: '9 Oak Ave' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '310000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      const add = calls.find(c => c.action === 'listings-add');
      expect(add).toBeTruthy();
      expect(add!.input.title).toBe('Sunny condo');
      expect(add!.input.price).toBe(310000);
    });
    await waitFor(() => expect(screen.queryByPlaceholderText('Title')).toBeNull());
  });

  it('keeps the form open with values when the server refuses the add', async () => {
    addResult = { ok: false, error: 'price required' };
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Sunny condo' } });
    fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: '9 Oak Ave' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '310000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/price required/));
    expect((screen.getByPlaceholderText('Address') as HTMLInputElement).value).toBe('9 Oak Ave');
  });

  it('numeric fields select their contents on focus so typing replaces the value', async () => {
    await openForm();
    const price = screen.getByPlaceholderText('Price') as HTMLInputElement;
    fireEvent.change(price, { target: { value: '6.5' } });
    const selectSpy = vi.spyOn(price, 'select');
    fireEvent.focus(price);
    expect(selectSpy).toHaveBeenCalled();
  });
});

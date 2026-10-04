/** PetProfileCard — live detail, edit via pet-update, confirmed delete via pet-delete. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import { PetProfileCard } from '@/components/pets/PetProfileCard';

const DETAIL = {
  pet: { id: 'p1', name: 'Biscuit', species: 'dog', breed: 'Beagle', weightKg: 11, birthdate: '2021-04-01', microchipId: null, neutered: false, age: { years: 4, months: 6 } },
  counts: { vaccines: 3, medications: 1, vetVisits: 2, weightLogs: 5 },
  overdueVaccines: 1,
  openReminders: 2,
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) =>
    Promise.resolve({ data: { ok: true, result: action === 'pet-detail' ? DETAIL : {} } }));
});

describe('PetProfileCard', () => {
  it('renders the real detail counts, flagging overdue vaccines', async () => {
    render(<PetProfileCard petId="p1" onChange={() => {}} />);
    await screen.findByText('Biscuit');
    expect(screen.getByText(/3 vaccines · 1 overdue/)).toBeTruthy();
    expect(screen.getByText(/2 open reminders/)).toBeTruthy();
  });

  it('saves edits through pet-update', async () => {
    const onChange = vi.fn();
    render(<PetProfileCard petId="p1" onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '12.5' } });
    fireEvent.click(screen.getByLabelText(/spayed/i));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('pets', 'pet-update', expect.objectContaining({ id: 'p1', weightKg: 12.5, neutered: true, breed: 'Beagle' })));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('deletes only after the in-place confirmation', async () => {
    const onChange = vi.fn();
    render(<PetProfileCard petId="p1" onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Biscuit' }));
    expect(lensRunMock).not.toHaveBeenCalledWith('pets', 'pet-delete', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /remove biscuit and all records/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('pets', 'pet-delete', { id: 'p1' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});

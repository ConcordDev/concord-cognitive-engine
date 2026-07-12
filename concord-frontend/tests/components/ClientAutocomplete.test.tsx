import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ClientAutocomplete } from '@/components/plumbing/ClientAutocomplete';
import type { ClientRecord } from '@/components/plumbing/ClientAutocomplete';

const CLIENTS: ClientRecord[] = [
  { id: 'client_1', name: 'Acme Bakery', phone: '555-0100', email: '', address: '1 Main St', jobsCount: 3 },
  { id: 'client_2', name: 'Union Station HOA', phone: '', email: 'hoa@example.com', address: '', jobsCount: 0 },
];

describe('ClientAutocomplete', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('renders the free-text input with the given placeholder', () => {
    render(
      <ClientAutocomplete clients={CLIENTS} value="" clientId={null} onSelect={() => {}} placeholder="Client" />,
    );
    expect(screen.getByPlaceholderText('Client')).toBeInTheDocument();
  });

  it('typing opens a dropdown filtered by substring and shows contact info', () => {
    render(
      <ClientAutocomplete clients={CLIENTS} value="acme" clientId={null} onSelect={() => {}} />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Acme Bakery')).toBeInTheDocument();
    expect(screen.queryByText('Union Station HOA')).not.toBeInTheDocument();
    expect(screen.getByText(/555-0100/)).toBeInTheDocument();
    expect(screen.getByText(/3 jobs/)).toBeInTheDocument();
  });

  it('clicking a match calls onSelect with the full client record and closes the dropdown', () => {
    const onSelect = vi.fn();
    render(
      <ClientAutocomplete clients={CLIENTS} value="acme" clientId={null} onSelect={onSelect} />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Acme Bakery'));
    expect(onSelect).toHaveBeenCalledWith(CLIENTS[0], 'Acme Bakery');
  });

  it('typing after a client is linked clears the selection (free-text edit)', () => {
    const onSelect = vi.fn();
    render(
      <ClientAutocomplete clients={CLIENTS} value="Acme Bakery" clientId="client_1" onSelect={onSelect} />,
    );
    // linked indicator visible
    expect(screen.getByLabelText('Linked to a saved client')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Acme Bakery X' } });
    expect(onSelect).toHaveBeenCalledWith(null, 'Acme Bakery X');
  });

  it('keyboard navigation: ArrowDown then Enter selects the highlighted match', () => {
    const onSelect = vi.fn();
    render(
      <ClientAutocomplete clients={CLIENTS} value="" clientId={null} onSelect={onSelect} />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(CLIENTS[1], 'Union Station HOA');
  });

  it('no match: offers to add the typed name as a new client, and wires it through clientAdd', async () => {
    const newClient: ClientRecord = { id: 'client_new', name: 'Brand New Plumbing Co', phone: '', email: '', address: '' };
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { client: newClient }, error: null } });
    const onSelect = vi.fn();
    const onCreated = vi.fn();
    render(
      <ClientAutocomplete clients={CLIENTS} value="Brand New Plumbing Co" clientId={null} onSelect={onSelect} onCreated={onCreated} />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    const addBtn = screen.getByText(/Add .*Brand New Plumbing Co.* as new client/);
    await act(async () => { fireEvent.click(addBtn); });

    expect(lensRunMock).toHaveBeenCalledWith('plumbing', 'clientAdd', { name: 'Brand New Plumbing Co' });
    expect(onCreated).toHaveBeenCalledWith(newClient);
    expect(onSelect).toHaveBeenCalledWith(newClient, 'Brand New Plumbing Co');
  });

  it('does not offer "add new" when the typed text exactly matches an existing client', () => {
    render(
      <ClientAutocomplete clients={CLIENTS} value="Acme Bakery" clientId={null} onSelect={() => {}} />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.queryByText(/as new client/)).not.toBeInTheDocument();
  });
});

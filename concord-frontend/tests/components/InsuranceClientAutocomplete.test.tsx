import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ClientAutocomplete } from '@/components/insurance/ClientAutocomplete';
import type { ClientRecord } from '@/components/insurance/ClientAutocomplete';

const CLIENTS: ClientRecord[] = [
  { id: 'cli_1', name: 'Priya Nair', phone: '555-1010', email: '', address: '12 Elm St', policyCount: 2 },
  { id: 'cli_2', name: 'Riverside Property Mgmt', phone: '', email: 'contact@riverside.example', address: '', policyCount: 0 },
];

describe('insurance ClientAutocomplete', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('renders the free-text input with the given placeholder', () => {
    render(
      <ClientAutocomplete clients={CLIENTS} value="" clientId={null} onSelect={() => {}} placeholder="Insured" />,
    );
    expect(screen.getByPlaceholderText('Insured')).toBeInTheDocument();
  });

  it('typing opens a dropdown filtered by substring and shows contact info + policy count', () => {
    render(
      <ClientAutocomplete clients={CLIENTS} value="priya" clientId={null} onSelect={() => {}} />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('Priya Nair')).toBeInTheDocument();
    expect(screen.queryByText('Riverside Property Mgmt')).not.toBeInTheDocument();
    expect(screen.getByText(/555-1010/)).toBeInTheDocument();
    expect(screen.getByText(/2 policies/)).toBeInTheDocument();
  });

  it('clicking a match calls onSelect with the full client record and closes the dropdown', () => {
    const onSelect = vi.fn();
    render(
      <ClientAutocomplete clients={CLIENTS} value="priya" clientId={null} onSelect={onSelect} />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Priya Nair'));
    expect(onSelect).toHaveBeenCalledWith(CLIENTS[0], 'Priya Nair');
  });

  it('typing after a client is linked clears the selection (free-text edit)', () => {
    const onSelect = vi.fn();
    render(
      <ClientAutocomplete clients={CLIENTS} value="Priya Nair" clientId="cli_1" onSelect={onSelect} />,
    );
    expect(screen.getByLabelText('Linked to a saved client')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Priya Nair X' } });
    expect(onSelect).toHaveBeenCalledWith(null, 'Priya Nair X');
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
    expect(onSelect).toHaveBeenCalledWith(CLIENTS[1], 'Riverside Property Mgmt');
  });

  it('no match: offers to add the typed name as a new client, and wires it through insurance.client-add', async () => {
    const newClient: ClientRecord = { id: 'cli_new', name: 'Marcus Webb', phone: '', email: '', address: '' };
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { client: newClient }, error: null } });
    const onSelect = vi.fn();
    const onCreated = vi.fn();
    render(
      <ClientAutocomplete clients={CLIENTS} value="Marcus Webb" clientId={null} onSelect={onSelect} onCreated={onCreated} />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    const addBtn = screen.getByText(/Add .*Marcus Webb.* as new client/);
    await act(async () => { fireEvent.click(addBtn); });

    expect(lensRunMock).toHaveBeenCalledWith('insurance', 'client-add', { name: 'Marcus Webb' });
    expect(onCreated).toHaveBeenCalledWith(newClient);
    expect(onSelect).toHaveBeenCalledWith(newClient, 'Marcus Webb');
  });

  it('does not offer "add new" when the typed text exactly matches an existing client', () => {
    render(
      <ClientAutocomplete clients={CLIENTS} value="Priya Nair" clientId={null} onSelect={() => {}} />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.queryByText(/as new client/)).not.toBeInTheDocument();
  });
});

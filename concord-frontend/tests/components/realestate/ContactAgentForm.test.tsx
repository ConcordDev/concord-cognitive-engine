import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ContactAgentForm } from '@/components/realestate/ContactAgentForm';

const AGENTS = [{ id: 'a1', name: 'Alice', brokerage: 'Acme' }];
const LEADS = [
  {
    id: 'l1', name: 'Buyer Bob', contact: 'bob@x.com', message: 'Want a showing', intent: 'buying',
    preferredDate: '2026-06-01', preferredTime: '14:00', status: 'new', submittedAt: '2026-05-10T00:00:00Z',
  },
  {
    id: 'l2', name: 'Seller Sue', contact: '555-2', message: 'Selling soon', intent: 'selling',
    preferredDate: null, preferredTime: null, status: 'contacted', submittedAt: '2026-05-11T00:00:00Z',
  },
];

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('ContactAgentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('renders the form and empty lead history', async () => {
    render(<ContactAgentForm />);
    expect(screen.getByText('Contact an agent')).toBeInTheDocument();
    expect(await screen.findByText('No leads submitted yet.')).toBeInTheDocument();
  });

  it('renders the "about this listing" tag when listingId is given', async () => {
    render(<ContactAgentForm listingId="L9" />);
    expect(screen.getByText('about this listing')).toBeInTheDocument();
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'leads-list', input: { listingId: 'L9' } }),
      ),
    );
  });

  it('lists agents in the select and renders lead history with both date variants', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: AGENTS } } };
      if (action === 'leads-list') return { data: { ok: true, result: { leads: LEADS } } };
      return { data: { ok: true } };
    });
    render(<ContactAgentForm />);
    expect(await screen.findByText('Buyer Bob')).toBeInTheDocument();
    expect(screen.getByText('Seller Sue')).toBeInTheDocument();
    expect(screen.getByText(/prefers 2026-06-01 14:00/)).toBeInTheDocument();
  });

  it('shows a validation error when required fields are missing', async () => {
    render(<ContactAgentForm />);
    await screen.findByText('No leads submitted yet.');
    fireEvent.click(screen.getByRole('button', { name: /Send to agent/ }));
    expect(await screen.findByText('Name, contact, and message are required.')).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'agent-lead-submit' }));
  });

  it('submits a lead successfully and shows the sent message', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: AGENTS } } };
      if (action === 'leads-list') return { data: { ok: true, result: { leads: [] } } };
      if (action === 'agent-lead-submit') return { data: { ok: true } };
      return { data: { ok: true } };
    });
    render(<ContactAgentForm listingId="L1" />);
    await screen.findByText('No leads submitted yet.');
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Me' } });
    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: 'me@x.com' } });
    fireEvent.change(screen.getByPlaceholderText(/What would you like to ask/), { target: { value: 'Tour please' } });
    fireEvent.change(screen.getByDisplayValue('Any agent'), { target: { value: 'a1' } });
    fireEvent.change(screen.getByPlaceholderText('Your name').parentElement!.parentElement!.querySelector('input[type=date]')!, { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByPlaceholderText('Your name').parentElement!.parentElement!.querySelector('input[type=time]')!, { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to agent/ }));
    expect(await screen.findByText('Lead submitted — an agent will follow up.')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent-lead-submit',
        input: expect.objectContaining({ name: 'Me', contact: 'me@x.com', agentId: 'a1', listingId: 'L1', preferredDate: '2026-07-01', preferredTime: '10:00' }),
      }),
    );
  });

  it('shows the server error when submit returns ok:false', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: [] } } };
      if (action === 'leads-list') return { data: { ok: true, result: { leads: [] } } };
      if (action === 'agent-lead-submit') return { data: { ok: false, error: 'rate limited' } };
      return { data: { ok: true } };
    });
    render(<ContactAgentForm />);
    await screen.findByText('No leads submitted yet.');
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Me' } });
    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: 'm' } });
    fireEvent.change(screen.getByPlaceholderText(/What would you like to ask/), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to agent/ }));
    expect(await screen.findByText('rate limited')).toBeInTheDocument();
  });

  it('shows a generic error when submit rejects', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: [] } } };
      if (action === 'leads-list') return { data: { ok: true, result: { leads: [] } } };
      if (action === 'agent-lead-submit') return Promise.reject(new Error('net'));
      return { data: { ok: true } };
    });
    render(<ContactAgentForm />);
    await screen.findByText('No leads submitted yet.');
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Me' } });
    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: 'm' } });
    fireEvent.change(screen.getByPlaceholderText(/What would you like to ask/), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to agent/ }));
    expect(await screen.findByText('Could not submit lead.')).toBeInTheDocument();
  });

  it('updates a lead status optimistically', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: [] } } };
      if (action === 'leads-list') return { data: { ok: true, result: { leads: LEADS } } };
      if (action === 'lead-update-status') return { data: { ok: true } };
      return { data: { ok: true } };
    });
    render(<ContactAgentForm />);
    await screen.findByText('Buyer Bob');
    const selects = screen.getAllByRole('combobox');
    const statusSelect = selects.find((s) => (s as HTMLSelectElement).value === 'new')!;
    fireEvent.change(statusSelect, { target: { value: 'scheduled' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lead-update-status', input: { id: 'l1', status: 'scheduled' } }),
      ),
    );
  });

  it('tolerates a rejected status update', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: [] } } };
      if (action === 'leads-list') return { data: { ok: true, result: { leads: LEADS } } };
      if (action === 'lead-update-status') return Promise.reject(new Error('x'));
      return { data: { ok: true } };
    });
    render(<ContactAgentForm />);
    await screen.findByText('Buyer Bob');
    const selects = screen.getAllByRole('combobox');
    const statusSelect = selects.find((s) => (s as HTMLSelectElement).value === 'new')!;
    fireEvent.change(statusSelect, { target: { value: 'lost' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead-update-status' })));
  });

  it('tolerates a rejected initial refresh', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ContactAgentForm />);
    expect(await screen.findByText('No leads submitted yet.')).toBeInTheDocument();
  });
});

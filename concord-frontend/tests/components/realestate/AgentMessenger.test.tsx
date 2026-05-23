import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AgentMessenger } from '@/components/realestate/AgentMessenger';

const AGENTS = [
  { id: 'a1', name: 'Alice Realtor', brokerage: 'Acme Homes', phone: '555-1', email: 'alice@x.com', rating: 4.8, reviewCount: 12 },
  { id: 'a2', name: 'Bob Broker', brokerage: 'Bob LLC', phone: '', email: '', rating: 4.2, reviewCount: 3 },
];
const MESSAGES = [
  { id: 'm1', agentId: 'a1', text: 'Hi there', from: 'user' as const, timestamp: '2026-05-01T10:00:00Z', listingId: null },
  { id: 'm2', agentId: 'a1', text: 'Hello back', from: 'agent' as const, timestamp: '2026-05-01T11:00:00Z', listingId: 'L1' },
];

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('AgentMessenger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { agents: [] } } });
  });

  it('shows empty state when there are no agents', async () => {
    render(<AgentMessenger />);
    expect(await screen.findByText('No agents yet')).toBeInTheDocument();
    expect(screen.getByText('Select an agent to message')).toBeInTheDocument();
  });

  it('lists agents, auto-selects the first and loads its messages', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: AGENTS } } };
      if (action === 'messages-list') return { data: { ok: true, result: { messages: MESSAGES } } };
      return { data: { ok: true } };
    });
    render(<AgentMessenger />);
    expect((await screen.findAllByText('Alice Realtor')).length).toBeGreaterThan(0);
    expect(screen.getByText('Bob Broker')).toBeInTheDocument();
    expect(await screen.findByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('Hello back')).toBeInTheDocument();
    expect(screen.getByText('alice@x.com')).toBeInTheDocument();
  });

  it('shows the no-messages prompt when a selected agent has no messages', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: AGENTS } } };
      if (action === 'messages-list') return { data: { ok: true, result: { messages: [] } } };
      return { data: { ok: true } };
    });
    render(<AgentMessenger />);
    (await screen.findAllByText("Alice Realtor"))[0];
    expect(await screen.findByText('No messages yet — say hello.')).toBeInTheDocument();
  });

  it('switches the active agent on click', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: AGENTS } } };
      if (action === 'messages-list') return { data: { ok: true, result: { messages: [] } } };
      return { data: { ok: true } };
    });
    render(<AgentMessenger />);
    await screen.findByText('Bob Broker');
    fireEvent.click(screen.getByText('Bob Broker'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'messages-list', input: { agentId: 'a2' } }),
      ),
    );
  });

  it('toggles the add-agent form and adds an agent', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: AGENTS } } };
      if (action === 'messages-list') return { data: { ok: true, result: { messages: [] } } };
      return { data: { ok: true } };
    });
    render(<AgentMessenger />);
    (await screen.findAllByText("Alice Realtor"))[0];
    // open add form via the Plus button (first header button — no aria-label)
    const headerBtns = screen.getAllByRole('button');
    fireEvent.click(headerBtns[0]);
    const nameInput = await screen.findByPlaceholderText('Name');
    fireEvent.change(nameInput, { target: { value: 'Carol Agent' } });
    fireEvent.change(screen.getByPlaceholderText('Brokerage'), { target: { value: 'Carol Co' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'c@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Phone'), { target: { value: '555-9' } });
    fireEvent.click(screen.getByText('Add agent'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'agents-add', input: expect.objectContaining({ name: 'Carol Agent', rating: 5 }) }),
      ),
    );
  });

  it('does not add an agent when name is blank', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: [] } } };
      return { data: { ok: true } };
    });
    render(<AgentMessenger />);
    await screen.findByText('No agents yet');
    const headerBtns = screen.getAllByRole('button');
    fireEvent.click(headerBtns[0]);
    fireEvent.click(await screen.findByText('Add agent'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'agents-add' }));
  });

  it('sends a message and clears the draft', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: AGENTS } } };
      if (action === 'messages-list') return { data: { ok: true, result: { messages: [] } } };
      return { data: { ok: true } };
    });
    render(<AgentMessenger />);
    (await screen.findAllByText("Alice Realtor"))[0];
    const input = await screen.findByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'Can I tour?' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'agent-message', input: { agentId: 'a1', text: 'Can I tour?' } }),
      ),
    );
  });

  it('does not send when the draft is empty', async () => {
    route((action) => {
      if (action === 'agents-list') return { data: { ok: true, result: { agents: AGENTS } } };
      if (action === 'messages-list') return { data: { ok: true, result: { messages: [] } } };
      return { data: { ok: true } };
    });
    render(<AgentMessenger />);
    (await screen.findAllByText("Alice Realtor"))[0];
    const input = await screen.findByPlaceholderText('Type a message…');
    fireEvent.submit(input.closest('form')!);
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'agent-message' }));
  });

  it('tolerates a rejected agents-list', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<AgentMessenger />);
    expect(await screen.findByText('No agents yet')).toBeInTheDocument();
  });
});

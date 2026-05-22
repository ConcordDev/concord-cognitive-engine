import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MessagesPanel } from '@/components/marketplace/MessagesPanel';

const THREADS = [
  { id: 't1', number: 'T-1', orderId: 'o1', subject: 'Shipping question', buyerName: 'Alice', messageCount: 2, unread: true, lastMessageAt: '2026-05-01' },
  { id: 't2', number: 'T-2', orderId: '', subject: 'Custom order', buyerName: 'Bob', messageCount: 0, unread: false, lastMessageAt: '2026-05-02' },
];

const THREAD_OPEN = {
  id: 't1', number: 'T-1', orderId: 'o1', subject: 'Shipping question',
  buyerName: 'Alice', messageCount: 2, unread: false, lastMessageAt: '2026-05-01',
  messages: [
    { id: 'm1', from: 'buyer', text: 'When will it ship?', at: '2026-05-01T10:00:00Z', read: true },
    { id: 'm2', from: 'seller', text: 'Tomorrow!', at: '2026-05-01T11:00:00Z', read: true },
  ],
};

describe('MessagesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { threads: [], orders: [] } } });
  });

  it('shows empty thread list and the no-conversation placeholder', async () => {
    render(<MessagesPanel />);
    expect(await screen.findByText('No conversations.')).toBeInTheDocument();
    expect(screen.getByText(/Select a conversation/)).toBeInTheDocument();
  });

  it('renders thread list with unread dot and message count', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'messages-threads')
        return Promise.resolve({ data: { ok: true, result: { threads: THREADS } } });
      return Promise.resolve({ data: { ok: true, result: { orders: [] } } });
    });
    render(<MessagesPanel />);
    expect(await screen.findByText('Shipping question')).toBeInTheDocument();
    expect(screen.getByText('Custom order')).toBeInTheDocument();
    expect(screen.getByText(/Alice · 2 msg/)).toBeInTheDocument();
  });

  it('opens a thread and renders its messages', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'messages-threads')
        return Promise.resolve({ data: { ok: true, result: { threads: THREADS } } });
      if (a === 'messages-thread-open')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      return Promise.resolve({ data: { ok: true, result: { orders: [] } } });
    });
    render(<MessagesPanel />);
    fireEvent.click(await screen.findByText('Shipping question'));
    expect(await screen.findByText('When will it ship?')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow!')).toBeInTheDocument();
  });

  it('shows the empty-conversation hint for a thread with no messages', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'messages-threads')
        return Promise.resolve({ data: { ok: true, result: { threads: THREADS } } });
      if (a === 'messages-thread-open')
        return Promise.resolve({ data: { ok: true, result: { thread: { ...THREAD_OPEN, messages: [] } } } });
      return Promise.resolve({ data: { ok: true, result: { orders: [] } } });
    });
    render(<MessagesPanel />);
    fireEvent.click(await screen.findByText('Shipping question'));
    expect(await screen.findByText(/say hello/)).toBeInTheDocument();
  });

  it('toggles the new-thread form and lists orders', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'orders-list')
        return Promise.resolve({
          data: { ok: true, result: { orders: [{ id: 'o1', number: 'ORD-1', buyerName: 'Alice' }] } },
        });
      return Promise.resolve({ data: { ok: true, result: { threads: [] } } });
    });
    render(<MessagesPanel />);
    await screen.findByText('No conversations.');
    fireEvent.click(screen.getByLabelText('New conversation'));
    expect(screen.getByPlaceholderText('Subject')).toBeInTheDocument();
    expect(await screen.findByText(/ORD-1 — Alice/)).toBeInTheDocument();
  });

  it('creates a new thread', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'messages-thread-open')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      return Promise.resolve({ data: { ok: true, result: { threads: [], orders: [] } } });
    });
    render(<MessagesPanel />);
    await screen.findByText('No conversations.');
    fireEvent.click(screen.getByLabelText('New conversation'));
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'Hi there' } });
    fireEvent.change(screen.getByPlaceholderText('Buyer name'), { target: { value: 'Carol' } });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'messages-thread-open',
        expect.objectContaining({ subject: 'Hi there', buyerName: 'Carol' }),
      ),
    );
  });

  it('sends a message in the open thread', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'messages-threads')
        return Promise.resolve({ data: { ok: true, result: { threads: THREADS } } });
      if (a === 'messages-thread-open')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      if (a === 'messages-send')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      return Promise.resolve({ data: { ok: true, result: { orders: [] } } });
    });
    render(<MessagesPanel />);
    fireEvent.click(await screen.findByText('Shipping question'));
    await screen.findByText('Tomorrow!');
    fireEvent.change(screen.getByPlaceholderText('Type a message…'), { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'messages-send',
        expect.objectContaining({ id: 't1', text: 'Thanks', from: 'seller' }),
      ),
    );
  });

  it('sends a message on Enter key', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'messages-threads')
        return Promise.resolve({ data: { ok: true, result: { threads: THREADS } } });
      if (a === 'messages-thread-open')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      if (a === 'messages-send')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      return Promise.resolve({ data: { ok: true, result: { orders: [] } } });
    });
    render(<MessagesPanel />);
    fireEvent.click(await screen.findByText('Shipping question'));
    await screen.findByText('Tomorrow!');
    const input = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(input, { target: { value: 'Quick reply' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('marketplace', 'messages-send', expect.anything()),
    );
  });

  it('switches the from-role select to buyer', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'messages-threads')
        return Promise.resolve({ data: { ok: true, result: { threads: THREADS } } });
      if (a === 'messages-thread-open')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      if (a === 'messages-send')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      return Promise.resolve({ data: { ok: true, result: { orders: [] } } });
    });
    render(<MessagesPanel />);
    fireEvent.click(await screen.findByText('Shipping question'));
    await screen.findByText('Tomorrow!');
    fireEvent.change(screen.getByDisplayValue('As seller'), { target: { value: 'buyer' } });
    fireEvent.change(screen.getByPlaceholderText('Type a message…'), { target: { value: 'Buyer msg' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'messages-send', expect.objectContaining({ from: 'buyer' }),
      ),
    );
  });

  it('does not send an empty message', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'messages-threads')
        return Promise.resolve({ data: { ok: true, result: { threads: THREADS } } });
      if (a === 'messages-thread-open')
        return Promise.resolve({ data: { ok: true, result: { thread: THREAD_OPEN } } });
      return Promise.resolve({ data: { ok: true, result: { orders: [] } } });
    });
    render(<MessagesPanel />);
    fireEvent.click(await screen.findByText('Shipping question'));
    await screen.findByText('Tomorrow!');
    lensRun.mockClear();
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(lensRun).not.toHaveBeenCalledWith('marketplace', 'messages-send', expect.anything());
  });

  it('tolerates a threads fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<MessagesPanel />);
    expect(await screen.findByText('No conversations.')).toBeInTheDocument();
  });
});

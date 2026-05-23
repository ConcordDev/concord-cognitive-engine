import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { NotificationsPanel } from '@/components/government/NotificationsPanel';

const NOTIFS = [
  { id: 'n1', kind: 'status_change', subjectKind: 'permit', subjectId: 'PMT-1', message: 'Permit approved', channel: 'email', contact: 'a@x.com', read: false, createdAt: '2026-01-01' },
  { id: 'n2', kind: 'status_change', subjectKind: 'service_request', subjectId: 'SR-1', message: 'SR closed', channel: 'sms', contact: '555-1', read: true, createdAt: '2026-01-02' },
];

describe('NotificationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { notifications: [], unreadCount: 0 } } });
  });

  it('shows empty state', async () => {
    render(<NotificationsPanel />);
    expect(await screen.findByText(/No notifications yet/)).toBeInTheDocument();
  });

  it('renders notifications and the unread badge', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { notifications: NOTIFS, unreadCount: 1 } } });
    render(<NotificationsPanel />);
    expect(await screen.findByText('Permit approved')).toBeInTheDocument();
    expect(screen.getByText('SR closed')).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it('toggles unread-only and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { notifications: NOTIFS, unreadCount: 1 } } });
    render(<NotificationsPanel />);
    await screen.findByText('Permit approved');
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notifications-list', input: { unreadOnly: true } }),
      ),
    );
  });

  it('marks all read', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'notifications-list'
        ? Promise.resolve({ data: { ok: true, result: { notifications: NOTIFS, unreadCount: 1 } } })
        : Promise.resolve({ data: { ok: true } }),
    );
    render(<NotificationsPanel />);
    await screen.findByText('Permit approved');
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notifications-mark-read', input: {} }),
      ),
    );
  });

  it('marks a single notification read', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'notifications-list'
        ? Promise.resolve({ data: { ok: true, result: { notifications: NOTIFS, unreadCount: 1 } } })
        : Promise.resolve({ data: { ok: true } }),
    );
    render(<NotificationsPanel />);
    await screen.findByText('Permit approved');
    fireEvent.click(screen.getByText('Mark read'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notifications-mark-read', input: { id: 'n1' } }),
      ),
    );
  });

  it('rejects subscribe with missing fields', async () => {
    render(<NotificationsPanel />);
    await screen.findByText(/No notifications yet/);
    fireEvent.click(screen.getByText('Sub'));
    expect(await screen.findByText('Subject ID and contact required.')).toBeInTheDocument();
  });

  it('subscribes and shows the new subscription chip', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'notifications-subscribe'
        ? Promise.resolve({ data: { ok: true, result: { subscription: { id: 'sub1', subjectKind: 'permit', subjectId: 'PMT-99', channel: 'email', contact: 'a@x.com', createdAt: '2026-01-01' } } } })
        : Promise.resolve({ data: { ok: true, result: { notifications: [], unreadCount: 0 } } }),
    );
    render(<NotificationsPanel />);
    await screen.findByText(/No notifications yet/);
    fireEvent.change(screen.getByPlaceholderText('Case / record ID'), { target: { value: 'PMT-99' } });
    fireEvent.change(screen.getByPlaceholderText('Email address or phone number'), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByText('Sub'));
    expect(await screen.findByText(/a@x.com/)).toBeInTheDocument();
  });

  it('surfaces a subscribe error on ok:false', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'notifications-subscribe'
        ? Promise.resolve({ data: { ok: false, error: 'invalid contact' } })
        : Promise.resolve({ data: { ok: true, result: { notifications: [], unreadCount: 0 } } }),
    );
    render(<NotificationsPanel />);
    await screen.findByText(/No notifications yet/);
    fireEvent.change(screen.getByPlaceholderText('Case / record ID'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('Email address or phone number'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByText('Sub'));
    expect(await screen.findByText('invalid contact')).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<NotificationsPanel />);
    expect(await screen.findByText(/No notifications yet/)).toBeInTheDocument();
  });
});

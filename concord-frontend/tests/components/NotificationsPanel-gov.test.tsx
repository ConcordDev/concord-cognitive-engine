/// <reference types="@testing-library/jest-dom/vitest" />
/** INC-SWEEP government F6 — notices copy must not promise email/SMS delivery. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { NotificationsPanel } from '@/components/government/NotificationsPanel';

describe('NotificationsPanel government (F6)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { notifications: [], unreadCount: 0 } },
    });
  });
  afterEach(() => { cleanup(); });

  it('heading and channel labels describe in-app notices, not email/SMS delivery', async () => {
    render(<NotificationsPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    expect(screen.getByText(/In-app case notices/i)).toBeInTheDocument();
    expect(screen.getByText(/Subscribe to in-app notices for a case/i)).toBeInTheDocument();
    expect(screen.queryByText(/email \/ SMS updates/i)).not.toBeInTheDocument();
    const channel = screen.getByLabelText(/Notice label/i) as HTMLSelectElement;
    expect(channel.options[0].textContent).toMatch(/In-app \(email label\)/i);
    expect(channel.options[1].textContent).toMatch(/In-app \(SMS label\)/i);
    expect(channel.options[2].textContent).toMatch(/In-app \(both labels\)/i);
  });
});

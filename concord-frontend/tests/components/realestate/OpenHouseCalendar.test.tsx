import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { OpenHouseCalendar } from '@/components/realestate/OpenHouseCalendar';

const EVENTS = [
  { listingId: 'l1', address: '1 Maple Dr', date: '2026-06-12', startTime: '11:00', endTime: '13:00', price: 450000 },
  { listingId: 'l2', address: '2 Oak Ave', date: '2026-06-15', startTime: '14:00', endTime: '16:00', price: 720000 },
];

describe('OpenHouseCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { events: [] } } });
  });

  it('shows empty state when no events', async () => {
    render(<OpenHouseCalendar />);
    expect(await screen.findByText('No upcoming open houses.')).toBeInTheDocument();
  });

  it('renders events with dates and prices', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { events: EVENTS } } });
    render(<OpenHouseCalendar />);
    expect(await screen.findByText('1 Maple Dr')).toBeInTheDocument();
    expect(screen.getByText('2 Oak Ave')).toBeInTheDocument();
    expect(screen.getByText('$450,000')).toBeInTheDocument();
    expect(screen.getByText('11:00 – 13:00')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls the open-houses-upcoming macro with a 21-day window', async () => {
    render(<OpenHouseCalendar />);
    await screen.findByText('No upcoming open houses.');
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'open-houses-upcoming', input: { days: 21 } }),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<OpenHouseCalendar />);
    expect(await screen.findByText('No upcoming open houses.')).toBeInTheDocument();
  });

  it('tolerates a missing events array', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<OpenHouseCalendar />);
    expect(await screen.findByText('No upcoming open houses.')).toBeInTheDocument();
  });
});

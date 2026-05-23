import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MeetingsPanel } from '@/components/government/MeetingsPanel';

const MEETINGS = [
  {
    id: 'm1', title: 'Budget Hearing', body: 'budget_committee', scheduledAt: '2026-06-01T18:00:00Z',
    location: 'Chambers', virtualUrl: 'https://zoom/x', agenda: ['Item A', 'Item B'], minutes: '',
    status: 'scheduled', createdAt: '2026-01-01',
  },
  {
    id: 'm2', title: 'Past Council', body: 'city_council', scheduledAt: '2026-01-01T18:00:00Z',
    location: '', virtualUrl: '', agenda: [], minutes: 'Approved budget.',
    status: 'minutes_published', createdAt: '2026-01-01', minutesPublishedAt: '2026-01-02',
  },
];

describe('MeetingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { meetings: [] } } });
  });

  it('shows empty state', async () => {
    render(<MeetingsPanel />);
    expect(await screen.findByText('No meetings scheduled yet.')).toBeInTheDocument();
  });

  it('renders meetings with status badges', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { meetings: MEETINGS } } });
    render(<MeetingsPanel />);
    expect(await screen.findByText('Budget Hearing')).toBeInTheDocument();
    expect(screen.getByText('Past Council')).toBeInTheDocument();
    expect(screen.getByText('scheduled')).toBeInTheDocument();
    expect(screen.getByText('minutes published')).toBeInTheDocument();
  });

  it('toggles upcoming-only and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { meetings: MEETINGS } } });
    render(<MeetingsPanel />);
    await screen.findByText('Budget Hearing');
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'meetings-list', input: { upcoming: true } }),
      ),
    );
  });

  it('does not schedule with missing title/date', async () => {
    render(<MeetingsPanel />);
    await screen.findByText('No meetings scheduled yet.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Schedule meeting'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'meetings-schedule' }));
  });

  it('schedules a meeting and splits agenda by line', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'meetings-schedule'
        ? Promise.resolve({ data: { ok: true } })
        : Promise.resolve({ data: { ok: true, result: { meetings: [] } } }),
    );
    render(<MeetingsPanel />);
    await screen.findByText('No meetings scheduled yet.');
    fireEvent.change(screen.getByPlaceholderText('Meeting title'), { target: { value: 'New Meeting' } });
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(dt, { target: { value: '2026-07-01T10:00' } });
    fireEvent.change(screen.getByPlaceholderText('Agenda items, one per line'), { target: { value: 'A\nB\n\nC' } });
    fireEvent.click(screen.getByText('Schedule meeting'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'meetings-schedule', input: expect.objectContaining({ agenda: ['A', 'B', 'C'] }) }),
      ),
    );
  });

  it('expands a scheduled meeting and publishes minutes', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'meetings-list'
        ? Promise.resolve({ data: { ok: true, result: { meetings: MEETINGS } } })
        : Promise.resolve({ data: { ok: true } }),
    );
    render(<MeetingsPanel />);
    fireEvent.click(await screen.findByText('Budget Hearing'));
    expect(await screen.findByText('Item A')).toBeInTheDocument();
    const draft = screen.getByPlaceholderText('Draft minutes…');
    fireEvent.change(draft, { target: { value: 'Meeting notes here.' } });
    fireEvent.click(screen.getByText('Publish minutes'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'meetings-publish-minutes', input: { id: 'm1', minutes: 'Meeting notes here.' } }),
      ),
    );
  });

  it('expands a published meeting showing minutes and no-agenda fallback', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { meetings: MEETINGS } } });
    render(<MeetingsPanel />);
    fireEvent.click(await screen.findByText('Past Council'));
    expect(await screen.findByText('Approved budget.')).toBeInTheDocument();
    expect(screen.getByText('No agenda items.')).toBeInTheDocument();
  });

  it('deletes a meeting', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { meetings: MEETINGS } } });
    render(<MeetingsPanel />);
    await screen.findByText('Budget Hearing');
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true } });
    const trash = document.querySelectorAll('li button.text-rose-400');
    fireEvent.click(trash[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'meetings-delete' })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<MeetingsPanel />);
    expect(await screen.findByText('No meetings scheduled yet.')).toBeInTheDocument();
  });
});

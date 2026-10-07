/**
 * /lenses/command-center — the one alert.
 *
 * Refresh re-reads. File, edit, and acknowledge show the line and the
 * note only after alert-detail returns them. The cockpit stays off
 * this card.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import CommandCenterPage from '@/app/lenses/command-center/page';

interface Stored {
  id: string;
  title: string;
  status: 'open' | 'acknowledged';
  line: string;
  ackNote: string | null;
}

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function install(alerts: Stored[], extra?: (name: string, input: Record<string, unknown>) => unknown) {
  lensRun.mockImplementation(async (_domain: string, name: string, input: Record<string, unknown> = {}) => {
    if (extra) {
      const overridden = extra(name, input);
      if (overridden) return overridden;
    }
    if (name === 'alert-list') {
      return ok({
        alerts: alerts.map((item) => ({ id: item.id, title: item.title, status: item.status })),
        count: alerts.length,
      });
    }
    if (name === 'alert-front') {
      const front = alerts.find((item) => item.status === 'open') || null;
      return ok({ alert: front ? { id: front.id, title: front.title, status: front.status } : null });
    }
    if (name === 'alert-detail') {
      const row = alerts.find((item) => item.id === input.id);
      if (!row) return { data: { ok: false, result: null, error: 'alert_not_found' } };
      return ok({
        alert: { id: row.id, title: row.title, line: row.line, status: row.status, ackNote: row.ackNote },
      });
    }
    return { data: { ok: false, result: null, error: `unexpected ${name}` } };
  });
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('command center alert desk', () => {
  it('EMPTY: says no alert is in front and offers file plus refresh', async () => {
    install([]);
    const view = render(<CommandCenterPage />);
    expect(await view.findByText('No alert in front of you.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The one alert' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(view.getByRole('button', { name: 'File an alert' })).toBeInTheDocument();
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByText('Ops Cockpit')).toBeNull();
    expect(view.queryByText('Vitals')).toBeNull();
  });

  it('WARMING: a shed list retries and then shows the empty card', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockImplementation(async () => ok({ alerts: [], count: 0, alert: null }));
    const view = render(<CommandCenterPage />);
    expect(await view.findByText('No alert in front of you.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<CommandCenterPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    install([]);
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No alert in front of you.')).toBeInTheDocument();
  });

  it('does not send a blank title or a blank line', async () => {
    install([]);
    const view = render(<CommandCenterPage />);
    fireEvent.click(await view.findByRole('button', { name: 'File an alert' }));
    fireEvent.click(view.getByRole('button', { name: 'Put it in front' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/title is required/i);
    expect(lensRun).not.toHaveBeenCalledWith('command-center', 'alert-file', expect.anything());
    fireEvent.change(view.getByTestId('cc-title'), { target: { value: 'Disk pressure' } });
    fireEvent.click(view.getByRole('button', { name: 'Put it in front' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/line is required/i);
    expect(lensRun).not.toHaveBeenCalledWith('command-center', 'alert-file', expect.anything());
  });

  it('shows the title and the line only after list and detail match', async () => {
    const alerts: Stored[] = [];
    install(alerts, (name, input) => {
      if (name !== 'alert-file') return undefined;
      alerts.push({
        id: 'al_1',
        title: String(input.title),
        status: 'open',
        line: String(input.line),
        ackNote: null,
      });
      return ok({ alertId: 'al_1', alert: { id: 'al_1', title: input.title, status: 'open' } });
    });
    const view = render(<CommandCenterPage />);
    fireEvent.click(await view.findByRole('button', { name: 'File an alert' }));
    fireEvent.change(view.getByTestId('cc-title'), { target: { value: 'Disk pressure' } });
    fireEvent.change(view.getByTestId('cc-line-input'), { target: { value: 'the volume is tight' } });
    fireEvent.click(view.getByRole('button', { name: 'Put it in front' }));
    expect(await view.findByTestId('cc-front')).toHaveTextContent('Disk pressure');
    expect(view.getByTestId('cc-line')).toHaveTextContent('the volume is tight');
    expect(view.getByTestId('cc-status')).toHaveTextContent('Open');
    expect(view.queryByText('No alert in front of you.')).toBeNull();
    expect(view.container.querySelector('input')).toBeNull();
  });

  it('stays on the composer when the list does not echo the title', async () => {
    install([], (name) => {
      if (name === 'alert-file') return ok({ alertId: 'al_1', alert: { id: 'al_1', title: 'Disk pressure', status: 'open' } });
      if (name === 'alert-list') return ok({ alerts: [], count: 0 });
      return undefined;
    });
    const view = render(<CommandCenterPage />);
    fireEvent.click(await view.findByRole('button', { name: 'File an alert' }));
    fireEvent.change(view.getByTestId('cc-title'), { target: { value: 'Disk pressure' } });
    fireEvent.change(view.getByTestId('cc-line-input'), { target: { value: 'the volume is tight' } });
    fireEvent.click(view.getByRole('button', { name: 'Put it in front' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.getByTestId('cc-title')).toBeInTheDocument();
    expect(view.queryByTestId('cc-front')).toBeNull();
  });

  it('edits the line only after detail reads the new line', async () => {
    const alerts: Stored[] = [{ id: 'al_1', title: 'Disk pressure', status: 'open', line: 'the volume is tight', ackNote: null }];
    install(alerts, (name, input) => {
      if (name !== 'alert-edit') return undefined;
      const row = alerts.find((item) => item.id === input.id);
      if (row) row.line = String(input.line);
      return ok({ alertId: 'al_1', alert: { id: 'al_1', title: 'Disk pressure', status: 'open' } });
    });
    const view = render(<CommandCenterPage />);
    expect(await view.findByTestId('cc-line')).toHaveTextContent('the volume is tight');
    fireEvent.click(view.getByRole('button', { name: 'Edit the line' }));
    fireEvent.change(view.getByTestId('cc-edit-line'), { target: { value: 'freed the proof db' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the line' }));
    expect(await view.findByTestId('cc-line')).toHaveTextContent('freed the proof db');
    expect(lensRun).toHaveBeenCalledWith('command-center', 'alert-edit', { id: 'al_1', line: 'freed the proof db' });
  });

  it('acknowledges only after detail returns the note and moves the front alert', async () => {
    const alerts: Stored[] = [
      { id: 'al_1', title: 'Disk pressure', status: 'open', line: 'tight', ackNote: null },
      { id: 'al_2', title: 'Queue lag', status: 'open', line: 'waiting', ackNote: null },
    ];
    install(alerts, (name, input) => {
      if (name !== 'alert-acknowledge') return undefined;
      const row = alerts.find((item) => item.id === input.id);
      if (row) {
        row.status = 'acknowledged';
        row.ackNote = String(input.note);
      }
      return ok({ alertId: input.id, alert: { id: input.id, title: row?.title, status: 'acknowledged' } });
    });
    const view = render(<CommandCenterPage />);
    expect(await view.findByTestId('cc-front')).toHaveTextContent('Disk pressure');
    fireEvent.click(view.getByRole('button', { name: 'Acknowledge' }));
    fireEvent.click(view.getByRole('button', { name: 'Save the acknowledgement' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/note is required/i);
    fireEvent.change(view.getByTestId('cc-ack-input'), { target: { value: 'cleared' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the acknowledgement' }));
    expect(await view.findByTestId('cc-front')).toHaveTextContent('Queue lag');
    fireEvent.click(view.getByTestId('cc-row-al_1'));
    expect(await view.findByTestId('cc-ack-note')).toHaveTextContent('cleared');
    expect(view.getByTestId('cc-status')).toHaveTextContent('Acknowledged');
    expect(view.getByTestId('cc-line')).toHaveTextContent('tight');
  });

  it('Refresh re-reads the desk', async () => {
    install([{ id: 'al_1', title: 'Disk pressure', status: 'open', line: 'tight', ackNote: null }]);
    const view = render(<CommandCenterPage />);
    expect(await view.findByTestId('cc-front')).toHaveTextContent('Disk pressure');
    const before = lensRun.mock.calls.filter((call) => call[1] === 'alert-list').length;
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }));
    expect(await view.findByTestId('cc-front')).toHaveTextContent('Disk pressure');
    const after = lensRun.mock.calls.filter((call) => call[1] === 'alert-list').length;
    expect(after).toBeGreaterThan(before);
  });

  it('greets the signed-in operator and stays on the composer when filing is refused', async () => {
    authUser.current = { username: 'ramaj' };
    install([]);
    const view = render(<CommandCenterPage />);
    expect(await view.findByRole('heading', { name: 'The one alert, Ramaj' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'File an alert' }));
    fireEvent.change(view.getByTestId('cc-title'), { target: { value: 'Disk pressure' } });
    fireEvent.change(view.getByTestId('cc-line-input'), { target: { value: 'tight' } });
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'alert_not_saved' } });
    fireEvent.click(view.getByRole('button', { name: 'Put it in front' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/alert_not_saved/);
    expect(view.getByTestId('cc-title')).toBeInTheDocument();
  });
});

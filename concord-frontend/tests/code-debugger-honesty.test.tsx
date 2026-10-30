import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/hooks/useSmartPolling', () => ({ useSmartPolling: vi.fn() }));
vi.mock('@/lib/hooks/useYjsDoc', () => ({ useYjsDoc: () => ({ doc: null, synced: false }) }));
vi.mock('@/hooks/useYjsAwareness', () => ({ useYjsAwareness: () => ({ collaborators: [], setCursor: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'ada' } }) }));
vi.mock('@/components/code/ProjectSwitcher', () => ({ ProjectSwitcher: () => null }));
vi.mock('@/components/code/CodeProjectContext', () => ({ useCodeProject: () => ({ projectId: 'p1', setProjectId: vi.fn() }) }));
vi.mock('@/lib/realtime/socket', () => ({ SOCKET_URL: 'http://localhost' }));

import { CodeAdvancedPanel } from '@/components/code/CodeAdvancedPanel';

const FILE_CODE = 'const x = 1;\nconsole.log(x);\n';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'files-tree') {
      return { data: { ok: true, result: { tree: [{ path: 'main.js', language: 'javascript', size: 24 }] } } };
    }
    if (action === 'files-read') {
      return { data: { ok: true, result: { content: FILE_CODE } } };
    }
    return { data: { ok: true, result: {} } };
  });
});

describe('Debugger panel honesty (S2)', () => {
  it('states the retirement in user words and never promises a call stack', async () => {
    render(<CodeAdvancedPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /breakpoints/i }));
    await waitFor(() => expect(screen.getByText(/Step debugging is unavailable/i)).toBeTruthy());
    expect(screen.getByText(/no debugger to run against/i)).toBeTruthy();
    expect(screen.queryByText(/real call stack/i)).toBeNull();
    expect(screen.queryByText(/Watch expressions/i)).toBeNull();
  });

  it('never calls the retired debug-run macro and offers no Debug run button', async () => {
    render(<CodeAdvancedPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /breakpoints/i }));
    await waitFor(() => expect(screen.getByText(/Step debugging is unavailable/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^debug$/i })).toBeNull();
    const actions = lensRunMock.mock.calls.map((c) => c[1]);
    expect(actions).not.toContain('debug-run');
  });

  it('line markers still toggle as reading aids', async () => {
    render(<CodeAdvancedPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /breakpoints/i }));
    const lineCell = await screen.findByText('1', { selector: 'td' });
    fireEvent.click(lineCell);
    await waitFor(() => expect(screen.getByText(/1 marker set/i)).toBeTruthy());
    fireEvent.click(lineCell);
    await waitFor(() => expect(screen.queryByText(/marker set/i)).toBeNull());
  });
});

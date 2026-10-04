import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { CodeRunMenu } from '@/components/code/CodeRunMenu';
import type { RunFacts } from '@/components/code/codeRunReport';

const facts: RunFacts = {
  name: 'fib.js',
  language: 'javascript',
  scriptType: 'snippet',
  code: 'console.log(1)',
  result: { stdout: '1\n', stderr: '', exitCode: 0, supported: true },
  elapsedMs: 12,
};

const save = () => screen.getByRole('button', { name: /Save run as DTU/i });
const draft = () => screen.getByRole('button', { name: /Draft in Thread/i });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('code run report handoff', () => {
  it('will not draft before the run is saved', () => {
    render(<CodeRunMenu facts={facts} />);
    expect(draft()).toBeDisabled();
    expect(screen.getByText(/fib\.js/)).toBeTruthy();
  });

  it('saves, reads back, then drafts citing that exact DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_run1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_run1' } } } };
      if (domain === 'thread' && action === 'thread-draft') {
        return { data: { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_run1' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    render(<CodeRunMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_run1\./)).toBeTruthy());

    const order = () => lensRunMock.mock.calls.map((c) => `${c[0]}.${c[1]}`);
    expect(order().indexOf('dtu.create')).toBeLessThan(order().indexOf('dtu.get'));

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_1, citing dtu_run1\. Not posted\./)).toBeTruthy());

    expect(order().indexOf('thread.thread-draft')).toBeGreaterThan(order().indexOf('dtu.get'));

    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect((draftCall?.[2] as Record<string, unknown>).citedDtuId).toBe('dtu_run1');
    expect((draftCall?.[2] as Record<string, unknown>).content).toContain('Nothing was published');
  });

  it('does not claim a save when the read-back does not return the record', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_run1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_other' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<CodeRunMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/read-back did not return it/)).toBeTruthy());
    expect(screen.queryByText(/^Saved as private DTU/)).toBeNull();
    expect(draft()).toBeDisabled();
  });

  it('repeats a refused save instead of reporting one', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu') return { data: { ok: false, error: 'duplicate_blocked' } };
      return { data: { ok: true, result: {} } };
    });

    render(<CodeRunMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Not saved\. duplicate_blocked/)).toBeTruthy());
    expect(screen.queryByText(/^Saved as private DTU/)).toBeNull();
  });

  it('repeats a refused draft instead of reporting one', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_run1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_run1' } } } };
      if (domain === 'thread' && action === 'thread-draft') return { data: { ok: false, error: 'cited DTU not found: dtu_run1' } };
      return { data: { ok: true, result: {} } };
    });

    render(<CodeRunMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_run1\./)).toBeTruthy());
    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Not drafted\. cited DTU not found: dtu_run1/)).toBeTruthy());
  });

  it('shows the existing draft after a reload without drafting again', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [{ id: 'th_9' }] } } };
      if (domain === 'thread' && action === 'draft-detail') {
        return { data: { ok: true, result: { draft: { id: 'th_9', status: 'draft', citedDtuId: 'dtu_run1' } } } };
      }
      if (domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_run1' } } } };
      if (domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_run1' } } } };
      return { data: { ok: true, result: {} } };
    });

    render(<CodeRunMenu facts={facts} />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_run1\./)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: /Drafted/i })).toBeTruthy());
    expect(screen.getByText(/Drafted in Thread as th_9\. Not posted\./)).toBeTruthy();
  });

  it('teaches the job when there is no run to report on', () => {
    render(<CodeRunMenu facts={{ ...facts, result: null }} />);
    expect(screen.getByText(/Run a script to build a report/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save run as DTU/i })).toBeNull();
  });

  it('does not offer a save when the sandbox refused the language', () => {
    render(
      <CodeRunMenu
        facts={{ ...facts, name: 'main.go', language: 'go', result: { supported: false, stdout: '', stderr: 'cannot run go', exitCode: -1 } }}
      />,
    );
    expect(screen.getByText(/does not run go/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save run as DTU/i })).toBeNull();
  });
});
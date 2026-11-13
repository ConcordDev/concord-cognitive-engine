/**
 * CB-0496 Part B — disabled with no word: a control disabled for a missing
 * value states why, beside the control, while it is disabled (the
 * worldmodel-003 shape).
 *   personas-003 Create persona · disputes-009 Open Case ·
 *   repos-007 issue Create (leg) · global-004 CountryPicker at max (leg) ·
 *   event-timeline-006 CrossLensRecentsPanel refresh without a lens.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  lensRunBatch: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
vi.mock('@/lib/errors/error-store', () => ({
  useErrorStore: () => ({ addToast: vi.fn(), addError: vi.fn() }),
  useAddError: () => vi.fn(),
  useAddToast: () => vi.fn(),
}));
vi.mock('@/hooks/useSmartPolling', () => ({ useSmartPolling: () => {} }));

import { PersonaEditor } from '@/components/personas/PersonaEditor';
import { CaseWorkbench } from '@/components/disputes/CaseWorkbench';
import { ConcordRepoWorkspace } from '@/components/repos/ConcordRepoWorkspace';
import { CountryPicker } from '@/components/global/CountryPicker';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

const R = (result: unknown) => ({ data: { ok: true, result, error: null } });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_d: string, action: string) => {
    switch (action) {
      case 'case-list': return R({ cases: [] });
      case 'repo-list': return R({ repos: [{ id: 'r1', name: 'concord', description: '', stars: 0, language: 'TypeScript', updatedAt: '2026-11-01' }] });
      case 'issue-list': return R({ issues: [] });
      case 'tree': return R({ entries: [] });
      case 'branch-list': return R({ branches: [] });
      default: return R({});
    }
  });
});

describe('CB-0496 Part B — disabled controls say why', () => {
  it('personas-003: Create explains itself while the name is blank, and unlocks with a name', async () => {
    wrap(<PersonaEditor onSaved={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText(/A name is required/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create persona' }) as HTMLButtonElement).disabled).toBe(true);
    const nameInput = screen.getByPlaceholderText(/persona name|e\.g\./i);
    fireEvent.change(nameInput, { target: { value: 'Ada' } });
    expect(screen.queryByText(/A name is required/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Create persona' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disputes-009: Open Case states the missing title, and the note clears once typed', async () => {
    wrap(<CaseWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /New Case/ }));
    expect(await screen.findByText(/A case title is required/)).toBeTruthy();
    const openBtn = () => screen.getAllByRole('button', { name: /Open Case/ })
      .find((b) => (b as HTMLButtonElement).disabled) as HTMLButtonElement;
    expect(openBtn()).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Item arrived damaged'), { target: { value: 'Broken vase' } });
    expect(screen.queryByText(/A case title is required/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /Open Case/ })
      .every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('repos-007 (leg): issue Create states the missing title', async () => {
    wrap(<ConcordRepoWorkspace />);
    fireEvent.click(await screen.findByText('concord'));
    fireEvent.click(await screen.findByRole('button', { name: /Issues/ }));
    expect(await screen.findByText(/Give the issue a title/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Issue title'), { target: { value: 'Crash on save' } });
    expect(screen.queryByText(/Give the issue a title/)).toBeNull();
  });

  it('global-004 (leg): at the compare maximum the picker says why the rest are disabled', async () => {
    function Harness() {
      const [codes, setCodes] = React.useState<string[]>([]);
      return <CountryPicker label="Countries (2–6)" value={codes} multi max={3} onChangeMulti={setCodes} />;
    }
    const view = render(<Harness />);
    const names = ['United States', 'China', 'India'];
    for (const n of names) {
      fireEvent.click(view.getByRole('button', { name: n }));
    }
    expect(await screen.findByText(/Up to 3 countries at a time/)).toBeTruthy();
    expect((view.getByRole('button', { name: 'Brazil' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('event-timeline-006: refresh without a lens context explains itself', async () => {
    wrap(<CrossLensRecentsPanel lensId="" hideWhenEmpty={false} />);
    expect(await screen.findByText(/Refresh is unavailable here/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Refresh items from other lenses' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/lens context/);
  });
});

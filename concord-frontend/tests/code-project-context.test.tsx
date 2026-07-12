// CodeProjectContext — cross-component project-sharing behavioral test.
//
// The code lens has three independent surfaces that each used to carry
// their own "which project is active" state (see
// docs/lens-specs/code-capability-map.md's "Honest observation, not fixed
// this pass"): the quick-script tabs (no picker at all), the virtual-git
// `CodeWorkbenchSection` (its own `ProjectSwitcher`), and `CodeAdvancedPanel`
// (a second, disconnected `ProjectSwitcher` instance). Picking a project in
// one had zero effect on the other two.
//
// This pins the fix: all three now read/write the same `projectId` via
// `CodeProjectContext`. The test renders the REAL production components
// (not stand-ins) side by side under one `CodeProjectProvider` — exactly
// how `app/lenses/code/page.tsx` composes them — and asserts that a
// selection made in ANY one surface is immediately reflected in the
// others, both by the displayed `<select>` value and by a project-gated
// panel switching out of its "no project selected" state.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

Element.prototype.scrollIntoView = vi.fn();

// EditorPane (mounted unconditionally inside CodeWorkbenchSection's editor
// slot) dynamically imports Monaco — stub it out, this test doesn't touch
// the editor surface.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

const PROJECTS = [
  { id: 'proj-alpha', number: 'P-0001', name: 'Alpha', description: '', language: 'ts', createdAt: '2026-01-01' },
  { id: 'proj-beta', number: 'P-0002', name: 'Beta', description: '', language: 'ts', createdAt: '2026-01-02' },
];

vi.mock('@/lib/api/client', () => ({
  // Supports both lensRun call forms used across these components:
  //   lensRun({ domain, action, input })   — ProjectSwitcher, QuickScriptProjectBadge, CodeWorkbenchSection
  //   lensRun(domain, action, input)       — CodeAdvancedPanel's tabs
  lensRun: vi.fn((specOrDomain: unknown, actionArg?: string) => {
    const action = typeof specOrDomain === 'string'
      ? actionArg
      : (specOrDomain as { action?: string })?.action;
    if (action === 'projects-list') {
      return Promise.resolve({ data: { ok: true, result: { projects: PROJECTS } } });
    }
    if (action === 'git-status') {
      return Promise.resolve({ data: { ok: true, result: { branch: 'main', modified: [], staged: [] } } });
    }
    if (action === 'diagnostics') {
      return Promise.resolve({ data: { ok: true, result: { bySeverity: { error: 0, warning: 0 } } } });
    }
    if (action === 'workspace-summary') {
      return Promise.resolve({ data: { ok: true, result: { projectCount: 2, fileCount: 0, runningTasks: 0, dirtyProjects: 0 } } });
    }
    if (action === 'files-tree') {
      return Promise.resolve({ data: { ok: true, result: { tree: [] } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  }),
}));

import { CodeProjectProvider } from '@/components/code/CodeProjectContext';
import { CodeWorkbenchSection } from '@/components/code/CodeWorkbenchSection';
import { CodeAdvancedPanel } from '@/components/code/CodeAdvancedPanel';
import { QuickScriptProjectBadge } from '@/components/code/QuickScriptProjectBadge';

describe('CodeProjectContext — shared project across the code lens surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('selecting a project in the virtual-git workspace updates the Advanced IDE panel (and vice versa)', async () => {
    render(
      <CodeProjectProvider>
        <div data-testid="workbench"><CodeWorkbenchSection /></div>
        <div data-testid="advanced"><CodeAdvancedPanel /></div>
      </CodeProjectProvider>
    );

    const workbenchPane = screen.getByTestId('workbench');
    const advancedPane = screen.getByTestId('advanced');
    // ProjectSwitcher's <select> is uniquely named "Select project" — needed
    // because once a project is chosen, CodeAdvancedPanel's IntelliSense tab
    // mounts a SECOND, unrelated <select> (file picker) in the same pane.
    const projectSelectName = /select project/i;

    // Both surfaces start with no project selected.
    await waitFor(() => {
      expect(within(workbenchPane).getByRole('combobox', { name: projectSelectName })).toBeInTheDocument();
      expect(within(advancedPane).getByRole('combobox', { name: projectSelectName })).toBeInTheDocument();
    });
    expect(within(advancedPane).getByText(/Select or create a project/i)).toBeInTheDocument();

    // Select "Alpha" from the virtual-git workspace's ProjectSwitcher.
    const workbenchSelect = within(workbenchPane).getByRole('combobox', { name: projectSelectName }) as HTMLSelectElement;
    fireEvent.change(workbenchSelect, { target: { value: 'proj-alpha' } });

    // The Advanced IDE panel's independent ProjectSwitcher instance reflects
    // the SAME selection — this is the actual regression this test pins.
    await waitFor(() => {
      const advancedSelect = within(advancedPane).getByRole('combobox', { name: projectSelectName }) as HTMLSelectElement;
      expect(advancedSelect.value).toBe('proj-alpha');
    });
    // And the project-gated Advanced IDE tools are no longer blocked behind
    // "select a project" — proof this is a real behavioral change, not just
    // two <select> elements coincidentally matching.
    await waitFor(() => {
      expect(within(advancedPane).queryByText(/Select or create a project/i)).not.toBeInTheDocument();
    });

    // Now flip it from the Advanced panel and confirm the workbench follows.
    const advancedSelect = within(advancedPane).getByRole('combobox', { name: projectSelectName }) as HTMLSelectElement;
    fireEvent.change(advancedSelect, { target: { value: 'proj-beta' } });
    await waitFor(() => {
      const wbSelect = within(workbenchPane).getByRole('combobox', { name: projectSelectName }) as HTMLSelectElement;
      expect(wbSelect.value).toBe('proj-beta');
    });
  });

  it('the quick-script project badge shares the same projectId as the virtual-git workspace', async () => {
    render(
      <CodeProjectProvider>
        <div data-testid="badge"><QuickScriptProjectBadge /></div>
        <div data-testid="workbench"><CodeWorkbenchSection /></div>
      </CodeProjectProvider>
    );

    const badgePane = screen.getByTestId('badge');
    const workbenchPane = screen.getByTestId('workbench');
    const projectSelectName = /select project/i;

    await waitFor(() => {
      expect(within(badgePane).getByRole('combobox', { name: /shared project/i })).toBeInTheDocument();
      expect(within(workbenchPane).getByRole('combobox', { name: projectSelectName })).toBeInTheDocument();
    });

    // "No project (scratch)" is the default, valid state for the quick-script
    // surface — selecting Beta here is purely a shared-pointer update.
    const badgeSelect = within(badgePane).getByRole('combobox', { name: /shared project/i }) as HTMLSelectElement;
    fireEvent.change(badgeSelect, { target: { value: 'proj-beta' } });

    await waitFor(() => {
      const wbSelect = within(workbenchPane).getByRole('combobox', { name: projectSelectName }) as HTMLSelectElement;
      expect(wbSelect.value).toBe('proj-beta');
    });

    // And clearing it back to scratch from the workbench side propagates too.
    const wbSelect = within(workbenchPane).getByRole('combobox', { name: projectSelectName }) as HTMLSelectElement;
    fireEvent.change(wbSelect, { target: { value: '' } });
    await waitFor(() => {
      expect((within(badgePane).getByRole('combobox', { name: /shared project/i }) as HTMLSelectElement).value).toBe('');
    });
  });

  it('useCodeProject falls back to local, non-shared state outside a provider (never crashes)', async () => {
    // Two badges rendered with NO shared provider — each gets its own local
    // state, proving the hook degrades safely instead of throwing when a
    // consumer is mounted in isolation (e.g. a future standalone test).
    render(
      <>
        <div data-testid="a"><QuickScriptProjectBadge /></div>
        <div data-testid="b"><QuickScriptProjectBadge /></div>
      </>
    );

    await waitFor(() => {
      expect(within(screen.getByTestId('a')).getByRole('combobox', { name: /shared project/i })).toBeInTheDocument();
      expect(within(screen.getByTestId('b')).getByRole('combobox', { name: /shared project/i })).toBeInTheDocument();
    });

    const aSelect = within(screen.getByTestId('a')).getByRole('combobox', { name: /shared project/i }) as HTMLSelectElement;
    fireEvent.change(aSelect, { target: { value: 'proj-alpha' } });

    // "b" must NOT have picked up "a"'s selection — no shared provider means
    // no sharing, by design.
    await waitFor(() => {
      expect(aSelect.value).toBe('proj-alpha');
    });
    const bSelect = within(screen.getByTestId('b')).getByRole('combobox', { name: /shared project/i }) as HTMLSelectElement;
    expect(bSelect.value).toBe('');
  });
});

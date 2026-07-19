/**
 * Wave-4 gap-closure — docs/WAVE4_INVENTORY.md studio row / studio-capability-map.md
 * "Project picker doesn't auto-refresh cross-panel (separate PipingProvider trees)".
 *
 * Before this fix, `DawWorkbenchSection`'s project picker and `StudioActionPanel`'s
 * project-create lived under separate `PipingProvider` trees (in fact only
 * StudioActionPanel was inside a provider at all), so creating a project in the
 * action panel below never updated the workbench's project list until the user
 * clicked the manual "⟳ Refresh project list" button.
 *
 * This test pins the fix: both components now share one `PipingProvider`, and
 * `DawWorkbenchSection` subscribes to the `studio.project` pipe key that
 * `StudioActionPanel#actCreate` publishes immediately after a successful
 * project-create — so the picker updates with ZERO manual interaction.
 *
 * The manual refresh button is left in place as the honest fallback (per the
 * capability map's own framing) and is NOT exercised by this test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const runDomainMock = vi.fn();
const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiHelpers: {
    lens: {
      runDomain: (...args: unknown[]) => runDomainMock(...args),
    },
  },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PipingProvider } from '@/components/panel-polish';
import { StudioActionPanel } from '@/components/studio/StudioActionPanel';
import { DawWorkbenchSection } from '@/components/studio/DawWorkbenchSection';

const createdProject = { id: 'proj-created-1', name: 'New Song', bpm: 120 };

beforeEach(() => {
  runDomainMock.mockReset();
  lensRunMock.mockReset();
});

describe('Studio — DawWorkbenchSection auto-refreshes via the shared PipingProvider', () => {
  it('picks up a project created in StudioActionPanel without the manual refresh button', async () => {
    // Mutable "server state" the project-list mock reads from, so the second
    // fetch (triggered by the pipe) reflects the project StudioActionPanel
    // just created — same as a real backend would after project-create persists.
    let serverProjects: Array<{ id: string; name: string; bpm?: number }> = [];

    // DawWorkbenchSection calls lensRun('studio', 'project-list', {}) (positional form).
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'studio' && action === 'project-list') {
        return Promise.resolve({ data: { ok: true, result: { projects: serverProjects }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: null, error: null } });
    });

    // StudioActionPanel's callMacro() calls apiHelpers.lens.runDomain('studio', action, { input }).
    runDomainMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'studio' && action === 'project-create') {
        serverProjects = [...serverProjects, createdProject];
        return Promise.resolve({ data: { ok: true, result: { project: createdProject } } });
      }
      if (domain === 'studio' && action === 'project-list') {
        return Promise.resolve({ data: { ok: true, result: { projects: serverProjects } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    render(
      <PipingProvider>
        <DawWorkbenchSection />
        <StudioActionPanel />
      </PipingProvider>
    );

    // Both DawWorkbenchSection and StudioActionPanel render the identical
    // "— pick a project (N) —" placeholder text, so assert on counts (via
    // getAllByText) rather than a single-match getByText, which would throw
    // on the expected duplicate.
    await waitFor(() => {
      expect(screen.getAllByText(/— pick a project \(0\) —/).length).toBe(2);
    });

    // Create a project via StudioActionPanel — fill the name field and hit Create.
    const nameInput = screen.getByPlaceholderText('Project name');
    fireEvent.change(nameInput, { target: { value: 'New Song' } });
    const createButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(createButton);

    // The load-bearing assertion: BOTH pickers now read "(1)" — StudioActionPanel's
    // own list (expected regardless) AND DawWorkbenchSection's, which only updates
    // because it re-fetched project-list in response to the `studio.project` pipe
    // publish. NO click on the "⟳ Refresh project list" button happens in this test;
    // if the auto-refresh wiring regressed, DawWorkbenchSection would stay stuck at
    // "(0)" and this assertion would fail with a single remaining match.
    await waitFor(() => {
      expect(screen.getAllByText(/— pick a project \(1\) —/).length).toBe(2);
    });
    expect(screen.queryByText(/— pick a project \(0\) —/)).toBeNull();

    // The manual refresh button must still exist (honest fallback preserved).
    expect(screen.getByTitle('Refresh project list')).toBeTruthy();
  });
});

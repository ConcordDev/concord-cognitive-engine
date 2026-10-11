import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ada' } }) }));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/code/CodeProjectContext', () => ({ CodeProjectProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/code/CodeEditorWorkspacePanel', () => ({ CodeEditorWorkspacePanel: ({ onOpenExtras }: { onOpenExtras: () => void }) => <button onClick={onOpenExtras}>open advanced</button> }));
vi.mock('@/components/code/CodeAdvancedPanel', () => ({ CodeAdvancedPanel: () => <div>advanced panel</div> }));
vi.mock('@/components/code/GithubTrending', () => ({ GithubTrending: () => <div>trending panel</div> }));
vi.mock('@/components/code/CodeActionPanel', () => ({ CodeActionPanel: () => <div>actions panel</div> }));

import CodeApp from '@/components/code/CodeApp';
import { resetExecStatusForTests } from '@/components/code/codeExecGate';

beforeEach(() => {
  resetExecStatusForTests();
  lensRunMock.mockReset();
});

describe('CodeApp', () => {
  it('switches every workspace and runs only after execution is confirmed on', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { enabled: true, reason: '' } } });
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    render(<CodeApp />);
    fireEvent.click(screen.getByRole('button', { name: /open advanced/i }));
    fireEvent.click(screen.getByRole('tab', { name: /GitHub trending/i }));
    fireEvent.click(screen.getByRole('tab', { name: /Review workbench/i }));
    fireEvent.click(screen.getByRole('tab', { name: /Editor/i }));
    const run = await screen.findByRole('button', { name: /^Run$/ });
    await waitFor(() => expect(run).not.toBeDisabled());
    fireEvent.click(run);
    window.dispatchEvent(new CustomEvent('concord:code-run-state', { detail: { running: true } }));
    expect(dispatched).toHaveBeenCalled();
    expect(lensRunMock).toHaveBeenCalledWith('code', 'exec-status', {});
  });

  it('disables Run and names the reason when execution is off', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { enabled: false, reason: 'Live code execution is disabled in this environment.' } },
    });
    render(<CodeApp />);
    const run = await screen.findByRole('button', { name: /Run off/ });
    await waitFor(() => expect(run).toBeDisabled());
    expect(run).toHaveAttribute('title', expect.stringMatching(/disabled/i));
  });
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('CodeApp', () => {
  it('switches every workspace and handles real run-state events', () => {
    const dispatched = vi.spyOn(window, 'dispatchEvent');
    render(<CodeApp />);
    fireEvent.click(screen.getByRole('button', { name: /open advanced/i }));
    fireEvent.click(screen.getByRole('tab', { name: /GitHub trending/i }));
    fireEvent.click(screen.getByRole('tab', { name: /Review workbench/i }));
    fireEvent.click(screen.getByRole('tab', { name: /Editor/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    window.dispatchEvent(new CustomEvent('concord:code-run-state', { detail: { running: true } }));
    expect(dispatched).toHaveBeenCalled();
  });
});

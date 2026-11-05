/**
 * /lenses/animation — the studio shell.
 *
 * The page's own responsibility is just the admission-gate warm-up
 * retry on the first anim-list call (loading/error/retry) and the
 * Studio / Reference images tab switch — once the gate clears it hands
 * off entirely to <AnimationStudioSection> (gallery, create, open,
 * rename, delete, playback — all already covered directly by
 * animation-rename-clear.test.tsx, animation-undo-redo.test.tsx, and
 * animation-reference-import.test.tsx) and <AnimationReferenceImages>.
 * Both are mocked here so this file stays focused on the page's own
 * phase-gating contract, the tab switch, and the "+ New shot" affordance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
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
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/animation/AnimationStudioSection', () => ({
  AnimationStudioSection: () =>
    React.createElement('div', { 'data-testid': 'anim-studio-section' },
      React.createElement('input', { id: 'anim-new-title', placeholder: 'Title' })),
}));
vi.mock('@/components/animation/AnimationReferenceImages', () => ({
  AnimationReferenceImages: () =>
    React.createElement('div', { 'data-testid': 'anim-reference-section' }, 'Reference images panel'),
}));

import AnimationPage from '@/app/lenses/animation/page';

function listed(ok = true, error: string | null = null) {
  return { data: { ok, result: ok ? { animations: [], count: 0 } : null, error } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('animation studio shell', () => {
  it('LOADING: shows a loading message and no panel yet', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const view = render(<AnimationPage />);
    expect(view.getByTestId('animation-loading')).toBeInTheDocument();
    expect(view.queryByTestId('anim-studio-section')).toBeNull();
    expect(view.getByRole('button', { name: '+ New shot' })).toBeDisabled();
  });

  it('READY: mounts the Studio tab once anim-list clears the admission gate', async () => {
    lensRun.mockResolvedValue(listed(true));
    const view = render(<AnimationPage />);
    expect(await view.findByTestId('anim-studio-section')).toBeInTheDocument();
    expect(view.queryByTestId('animation-loading')).toBeNull();
    expect(view.getByRole('heading', { name: 'Animation' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '+ New shot' })).toBeEnabled();
  });

  it('WARMING: a shed anim-list retries and then mounts the studio', async () => {
    lensRun
      .mockResolvedValueOnce(listed(false, 'service_overloaded'))
      .mockResolvedValue(listed(true));
    const view = render(<AnimationPage />);
    expect(await view.findByTestId('anim-studio-section', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce(listed(false, 'state_unavailable'));
    const view = render(<AnimationPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    expect(view.queryByTestId('anim-studio-section')).toBeNull();
    lensRun.mockResolvedValue(listed(true));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByTestId('anim-studio-section')).toBeInTheDocument();
  });

  it('TABS: Reference images swaps the panel without unmounting the page', async () => {
    lensRun.mockResolvedValue(listed(true));
    const view = render(<AnimationPage />);
    await view.findByTestId('anim-studio-section');
    fireEvent.click(view.getByRole('tab', { name: 'Reference images' }));
    expect(await view.findByTestId('anim-reference-section')).toBeInTheDocument();
    expect(view.queryByTestId('anim-studio-section')).toBeNull();
    fireEvent.click(view.getByRole('tab', { name: 'Studio' }));
    expect(await view.findByTestId('anim-studio-section')).toBeInTheDocument();
    expect(view.queryByTestId('anim-reference-section')).toBeNull();
  });

  it('+ New shot switches to Studio and focuses the title input', async () => {
    lensRun.mockResolvedValue(listed(true));
    const view = render(<AnimationPage />);
    await view.findByTestId('anim-studio-section');
    fireEvent.click(view.getByRole('tab', { name: 'Reference images' }));
    await view.findByTestId('anim-reference-section');
    fireEvent.click(view.getByRole('button', { name: '+ New shot' }));
    expect(await view.findByTestId('anim-studio-section')).toBeInTheDocument();
    await waitFor(() => {
      const input = view.container.querySelector('#anim-new-title');
      expect(input).toBe(document.activeElement);
    });
  });

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed(true));
    const view = render(<AnimationPage />);
    expect(await view.findByRole('heading', { name: 'Animation' })).toBeInTheDocument();
    expect(await view.findByTestId('anim-studio-section')).toBeInTheDocument();
  });
});

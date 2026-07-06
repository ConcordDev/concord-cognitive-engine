/**
 * /lenses/dx-platform — onboarding progress restore.
 *
 * Regression pin: POST /api/lens/run always responds { ok: true, result:
 * PAYLOAD } where the outer `ok` is a transport flag only. Before the fix,
 * this page read `data?.progress` straight off the transport envelope
 * (always undefined against dx.onboarding_progress's real `{ ok, progress }`
 * payload, which lives under `.result`), so a returning user's onboarding
 * steps never restored as done — every step showed as not-yet-complete on
 * every page load.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/dx-platform/DevToolingPulse', () => ({ DevToolingPulse: () => null }));
vi.mock('@/components/dx-platform/DxWorkbench', () => ({ DxWorkbench: () => null }));

import DxPlatformPage from '@/app/lenses/dx-platform/page';

function jsonOf(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('/lenses/dx-platform — onboarding progress restore (nested envelope)', () => {
  it('restores step-done state from { ok, result: { progress } } instead of a flat top-level `progress`', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({
      ok: true,
      result: { ok: true, progress: { installed: { vscode: true }, signedIn: true, firstDetector: true, firstDebit: false } },
    })));
    const { getByText } = render(<DxPlatformPage />);
    // Step 1-3 flip to their "done" (✓) glyph once progress is restored.
    await waitFor(() => {
      const step2 = getByText("Click 'Sign in with Concord'").closest('div.rounded');
      expect(step2?.textContent).toMatch(/✓/);
    });
    const step4 = getByText('See your first wallet debit').closest('div.rounded');
    // Step 4 (firstDebit: false) stays un-done.
    expect(step4?.textContent).toMatch(/4/);
  });

  it('leaves steps not-done when the fetch fails (no crash, honest default state)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const { getByText } = render(<DxPlatformPage />);
    await waitFor(() => expect(getByText('Concord DX Platform')).toBeInTheDocument());
    const step2 = getByText("Click 'Sign in with Concord'").closest('div.rounded');
    expect(step2?.textContent).not.toMatch(/✓/);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    apps: { list: vi.fn().mockResolvedValue({ data: { apps: [] } }), create: vi.fn(), validate: vi.fn(), promote: vi.fn() },
  },
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));
vi.mock('@/components/app-maker/StudioPanel', () => ({ StudioPanel: () => <div>studio</div> }));
vi.mock('@/components/app-maker/ActionsPanel', () => ({ ActionsPanel: () => <div>actions</div> }));
vi.mock('@/components/app-maker/PackagesPanel', () => ({ PackagesPanel: () => <div>packages</div> }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';
import AppMakerLens from '@/app/lenses/app-maker/page';

// F7: the review's walk flagged the advertised "(press N to focus)" shortcut
// as dead ("bare N from the page body does nothing"). Verified during the
// app-maker audit that this was already fixed on main by PR #1797 — this is
// a regression test locking the correct behavior in, not a new fix.
describe('app-maker: bare N shortcut focuses new-app input (F7 regression)', () => {
  it('focuses the new-app input after switching to Apps via click, then pressing n', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <KeyboardProvider>
          <AppMakerLens />
        </KeyboardProvider>
      </QueryClientProvider>
    );
    const user = userEvent.setup();
    // Switch to Apps tab the way a real user would (click, like the review harness).
    const appsTab = await screen.findByRole('button', { name: /apps/i });
    await user.click(appsTab);
    const input = await screen.findByPlaceholderText(/New app name/i);
    expect(document.activeElement).not.toBe(input);
    await user.keyboard('n');
    expect(document.activeElement).toBe(input);
  });
});

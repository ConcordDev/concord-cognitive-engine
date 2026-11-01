/**
 * S9 (PR #1707): the GitHub trending tab must degrade, not detonate (F9).
 *
 * The crash was `undefined.toLocaleString()` on a repo item whose
 * counts arrived missing — one bad data shape white-screened the
 * entire lens behind its top-level boundary. These tests pin:
 *  - items with missing/mistyped counts render with 0s, no throw;
 *  - nameless items are dropped at the data boundary;
 *  - a failed fetch renders the honest in-panel error;
 *  - a child that still manages to throw is contained by the same
 *    ErrorBoundary composition CodeApp uses: user-worded fallback,
 *    no raw exception text, and the surroundings stay mounted.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { GithubTrending } from '@/components/code/GithubTrending';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => { lensRunMock.mockReset(); });

describe('GithubTrending data guards (S9)', () => {
  it('renders items whose counts are missing as 0 instead of crashing', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          items: [
            { id: 1, full_name: 'acme/rocket', html_url: 'https://github.com/acme/rocket', description: 'fast', owner: { login: 'acme', avatar_url: '' } },
            { id: 2, full_name: 'acme/stringy', html_url: 'https://github.com/acme/stringy', stargazers_count: '42', forks_count: null, watchers_count: undefined, owner: { login: 'acme', avatar_url: '' } },
            { id: 3, description: 'nameless — must be dropped', stargazers_count: 5 },
          ],
        },
      },
    });
    wrap(<GithubTrending />);
    expect(await screen.findByText('acme/rocket')).toBeTruthy();
    expect(await screen.findByText('acme/stringy')).toBeTruthy();
    expect(screen.queryByText(/nameless/)).toBeNull();
    // The string count was coerced, not crashed on.
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('a failed fetch renders the honest unavailable line, not a crash', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'github_unavailable' } });
    wrap(<GithubTrending />);
    expect(await screen.findByText(/GitHub results unavailable right now/)).toBeTruthy();
  });
});

describe('the per-tab boundary composition (S9)', () => {
  it('contains a throwing child: user words, no raw exception, neighbours survive', async () => {
    const Boom = () => { throw new Error("Cannot read properties of undefined (reading 'toLocaleString')"); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    wrap(
      <div>
        <span>editor survives</span>
        <ErrorBoundary
          fallback={(
            <div role="alert">
              <p>Trending repositories couldn't load.</p>
              <p>Something went wrong in this tab only — your editor, project, and other tabs are untouched.</p>
            </div>
          )}
        >
          <Boom />
        </ErrorBoundary>
      </div>,
    );
    expect(await screen.findByText("Trending repositories couldn't load.")).toBeTruthy();
    expect(screen.getByText('editor survives')).toBeTruthy();
    expect(screen.queryByText(/toLocaleString/)).toBeNull();
    spy.mockRestore();
  });
});

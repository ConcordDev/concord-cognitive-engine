import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { PlatformRepos } from '@/components/platform/PlatformRepos';
import { getLensState } from '@/lib/lens-state-persistence';

function renderRepos() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlatformRepos />
    </QueryClientProvider>,
  );
}

function topicCalls() {
  return lensRunMock.mock.calls
    .filter((c) => c[1] === 'github-topic-search')
    .map((c) => (c[2] as { topic?: string })?.topic);
}

beforeEach(() => {
  window.localStorage.clear();
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: { items: [] } } }));
});

// FIX-platform-005 (topic half) — the GitHub topic selection in the
// Platform lens reset to platform-engineering on every reload. It now
// persists through the shared lens UI-state store (same 'platform'
// entry as the page's view key, merged) and is restored on mount.
describe('FIX-platform-005 — selected topic survives a reload', () => {
  it('choosing a topic persists it, and a remount restores it and queries with it', async () => {
    const first = renderRepos();
    const select = first.container.querySelector('select');
    expect(select?.value).toBe('platform-engineering');
    await waitFor(() => expect(topicCalls()).toContain('platform-engineering'));

    fireEvent.change(select!, { target: { value: 'serverless' } });
    await waitFor(() => expect(topicCalls()).toContain('serverless'));
    expect(getLensState('platform')?.reposTopic).toBe('serverless');
    // the merged write must not clobber the sibling key space: state holds only what was written
    expect(getLensState('platform')?.activeTab).toBeUndefined();

    first.unmount();
    lensRunMock.mockClear();
    const second = renderRepos();
    expect(second.container.querySelector('select')?.value).toBe('serverless');
    await waitFor(() => expect(topicCalls()).toContain('serverless'));
    expect(topicCalls()).not.toContain('platform-engineering');
  });
});

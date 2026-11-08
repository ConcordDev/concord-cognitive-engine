// Coverage for the GitHub design-system atlas: topic switching, totals, stale + error banners,
// empty state and the save-as-DTU hand-off.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => h.lensRun(...a) }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: ({ onSaved }: { onSaved: (id: string) => void }) => <button onClick={() => onSaved('dtu-saved-1')}>save-dtu</button> }));

const REPOS = [
  { id: 1, full_name: 'acme/ds', html_url: 'https://github.com/acme/ds', description: 'A system', stargazers_count: 1200, forks_count: 80, open_issues_count: 4, language: 'TypeScript', license: { spdx_id: 'MIT' } },
  { id: 2, full_name: 'acme/icons', html_url: 'https://github.com/acme/icons', stargazers_count: 300, forks_count: 10, open_issues_count: 0 },
];
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const mount = async () => {
  const { DesignSystemAtlas } = await import('../DesignSystemAtlas');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const v = render(<QueryClientProvider client={qc}><DesignSystemAtlas /></QueryClientProvider>);
  await settle();
  return v;
};
afterEach(() => cleanup());
beforeEach(() => { h.lensRun.mockReset(); });

describe('DesignSystemAtlas', () => {
  it('lists repos with totals, switches topic and saves as a DTU', async () => {
    h.lensRun.mockResolvedValue({ data: { ok: true, result: { items: REPOS, stale: false } } });
    const v = await mount();
    expect(v.container.textContent).toMatch(/acme\/ds/);
    expect(v.container.textContent).toMatch(/1,500/);
    expect(v.container.textContent).toMatch(/MIT/);
    await act(async () => { fireEvent.change(v.container.querySelector('select') as HTMLSelectElement, { target: { value: 'storybook' } }); });
    await settle();
    expect(h.lensRun).toHaveBeenCalledWith('repos', 'github-topic-search', { topic: 'storybook', perPage: 25 });
    await act(async () => { fireEvent.click(screen.getByText('save-dtu')); });
    expect(v.container.textContent).toMatch(/dtu-saved-1/);
  });

  it('flags stale cached results, empty results and failures', async () => {
    h.lensRun.mockResolvedValue({ data: { ok: true, result: { items: REPOS, stale: true, fetchedAt: 1_770_000_000 } } });
    const stale = await mount();
    expect(stale.container.textContent).toMatch(/acme\/ds/);
    cleanup();
    h.lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    const empty = await mount();
    expect(empty.container.textContent).toMatch(/No repos returned/);
    cleanup();
    h.lensRun.mockResolvedValue({ data: { ok: false, reason: 'rate_limited' } });
    const bad = await mount();
    expect(bad.container.textContent).toMatch(/unavailable/i);
  });
});

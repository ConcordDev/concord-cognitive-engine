/// <reference types="@testing-library/jest-dom/vitest" />
// Behavior tests for CareerPortfolio's peer-endorsement directory (closes
// docs/WAVE4_INVENTORY.md's "experience" row / docs/lens-specs/
// experience-capability-map.md's "true peer endorsement needs a
// public-portfolio directory that doesn't exist" gap).
//
// Two things are pinned here:
//   1. The "Publish my portfolio" toggle calls the existing update path with
//      { meta: { visibility: 'published' } } — no new backend surface,
//      reusing the generic lens-artifact update macro.
//   2. The Directory view renders OTHER users' portfolios (populated with
//      real other-user data returned by a second useLensData(...) call, not
//      a fabricated list) and wires a per-skill "Endorse" action to
//      runAction.mutateAsync({ id: <their portfolio id>, action: 'endorse',
//      ... }) — distinct from acting on the caller's own portfolio.
//
// useLensData is called TWICE by the component with different `limit`
// options (limit: 1 for "my portfolio", limit: 50 for the directory) — the
// mock below dispatches on that to return the right fixture for each call.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const useLensDataMock = vi.fn();
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (...args: unknown[]) => useLensDataMock(...args),
}));

const runActionMutateAsync = vi.fn();
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: runActionMutateAsync }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'tester', email: '', role: 'user' }, isLoading: false, isAuthenticated: true }),
}));

import { CareerPortfolio } from './CareerPortfolio';

const EMPTY_DATA = { skills: [], experience: [], education: [], endorsements: [], snapshots: [] };

const myPortfolio = {
  id: 'p_mine', ownerId: 'me', title: 'My Portfolio',
  data: { ...EMPTY_DATA, skills: [{ id: 'mixing', name: 'Mixing', category: 'technical', level: 'advanced', yearsExperience: 4, evidence: [] }] },
  meta: { tags: [], status: 'draft', visibility: 'private' },
  createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1,
};

const otherPortfolio = {
  id: 'p_other', ownerId: 'someone-else', title: "Riley's Portfolio",
  data: { ...EMPTY_DATA, skills: [{ id: 'mastering', name: 'Mastering', category: 'technical', level: 'expert', yearsExperience: 6, evidence: [] }], endorsements: [] },
  meta: { tags: [], status: 'draft', visibility: 'published' },
  createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1,
};

const updateMock = vi.fn().mockResolvedValue({ ok: true });
const createMock = vi.fn().mockResolvedValue({ ok: true });

/**
 * @param mine   items returned for the "my portfolio" useLensData(...,{limit:1}) call
 * @param directory  items returned for the directory useLensData(...,{limit:50}) call
 */
function routeLensData(mine: unknown[], directory: unknown[]) {
  useLensDataMock.mockImplementation((_domain: string, _type: string, opts: { limit?: number } = {}) => {
    if (opts.limit === 1) {
      return { items: mine, isLoading: false, create: createMock, update: updateMock };
    }
    return { items: directory, isLoading: false, create: createMock, update: updateMock };
  });
}

describe('CareerPortfolio — peer endorsement directory', () => {
  beforeEach(() => {
    useLensDataMock.mockReset();
    runActionMutateAsync.mockReset();
    updateMock.mockClear();
    createMock.mockClear();
  });

  it('publish toggle: calls update with meta.visibility = published for a private portfolio', async () => {
    routeLensData([myPortfolio], [myPortfolio]);
    render(<CareerPortfolio />);

    await screen.findByText(/private — only you can see this/i);
    fireEvent.click(screen.getByRole('button', { name: /publish my portfolio/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('p_mine', { meta: { visibility: 'published' } }));
  });

  it('publish toggle: shows "Unpublish" and reverts to private for an already-published portfolio', async () => {
    const published = { ...myPortfolio, meta: { ...myPortfolio.meta, visibility: 'published' } };
    routeLensData([published], [published]);
    render(<CareerPortfolio />);

    await screen.findByText(/published — visible to peers in the directory/i);
    fireEvent.click(screen.getByRole('button', { name: /unpublish/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('p_mine', { meta: { visibility: 'private' } }));
  });

  it('Directory view: renders another user\'s published portfolio from real other-user data, excludes my own', async () => {
    routeLensData([myPortfolio], [myPortfolio, otherPortfolio]);
    render(<CareerPortfolio />);

    // Directory tab shows the real count of OTHER users' portfolios (1, not 2).
    const directoryTab = await screen.findByRole('tab', { name: /directory \(1\)/i });
    fireEvent.click(directoryTab);

    expect(await screen.findByText("Riley's Portfolio")).toBeInTheDocument();
    expect(screen.getByText(/mastering/i)).toBeInTheDocument();
    // My own skill ("Mixing") must not appear in the directory — only the
    // OTHER user's portfolio is listed there, even though "My Portfolio" is
    // still the (unrelated) tab label text.
    expect(screen.queryByText(/mixing/i)).not.toBeInTheDocument();
  });

  it('Directory view: Endorse wires to runAction against the OTHER user\'s portfolio id, not my own', async () => {
    routeLensData([myPortfolio], [myPortfolio, otherPortfolio]);
    runActionMutateAsync.mockResolvedValue({ ok: true, result: { ok: true, endorsement: { id: 'end_1', skillId: 'mastering' } } });
    render(<CareerPortfolio />);

    fireEvent.click(await screen.findByRole('tab', { name: /directory/i }));
    const card = (await screen.findByText("Riley's Portfolio")).closest('div')!.parentElement!;
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: /endorse/i }));

    await waitFor(() => expect(runActionMutateAsync).toHaveBeenCalledWith({
      id: 'p_other', action: 'endorse', params: { skillId: 'mastering', comment: '' },
    }));
  });

  it('Directory view: an endorse rejection (e.g. self-endorse safety net) surfaces without crashing and does not fabricate success', async () => {
    routeLensData([myPortfolio], [myPortfolio, otherPortfolio]);
    runActionMutateAsync.mockResolvedValue({ ok: true, result: { ok: false, error: 'cannot_self_endorse' } });
    render(<CareerPortfolio />);

    fireEvent.click(await screen.findByRole('tab', { name: /directory/i }));
    const card = (await screen.findByText("Riley's Portfolio")).closest('div')!.parentElement!;
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: /endorse/i }));

    await waitFor(() => expect(runActionMutateAsync).toHaveBeenCalled());
    // The component marks a res.ok===false result as an error state — no
    // fabricated checkmark should appear.
    expect(within(card as HTMLElement).queryByLabelText('endorsed')).not.toBeInTheDocument();
  });

  it('Directory view: empty state when no other user has published a portfolio', async () => {
    routeLensData([myPortfolio], [myPortfolio]);
    render(<CareerPortfolio />);

    fireEvent.click(await screen.findByRole('tab', { name: /directory/i }));
    expect(await screen.findByText(/no published portfolios yet/i)).toBeInTheDocument();
  });
});

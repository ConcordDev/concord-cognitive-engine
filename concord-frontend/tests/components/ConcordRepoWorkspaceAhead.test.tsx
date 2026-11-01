/// <reference types="@testing-library/jest-dom/vitest" />
// Review 2 ahead-counts residual — the divergence numbers displayed
// at the three canonical locations. branch-list returns ahead/behind
// per branch (vs the default), pull-detail returns ahead/behind for
// head vs base; these tests pin the three renderings: the branch
// list row, the branch (Code) view header, and the PR detail header.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { ConcordRepoWorkspace } from '@/components/repos/ConcordRepoWorkspace';

const REPO = {
  id: 'repo_1', name: 'demo', description: '', language: 'TypeScript',
  isPrivate: false, fileCount: 4, branchCount: 2, openIssues: 0, openPulls: 1,
  updatedAt: '2026-07-14T00:00:00.000Z',
};

const BRANCHES = [
  { name: 'main', head: 'aaa0001', protected: true, isDefault: true, commits: 3, ahead: 0, behind: 0 },
  { name: 'feat', head: 'bbb0002', protected: false, isDefault: false, commits: 2, ahead: 2, behind: 1 },
];

function envelope(result: unknown) {
  return { data: { ok: true, result } };
}

describe('ConcordRepoWorkspace — ahead/behind at the three canonical locations', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      switch (action) {
        case 'repo-list':
          return envelope({ repos: [REPO], count: 1 });
        case 'branch-list':
          return envelope({ branches: BRANCHES, tags: [], defaultBranch: 'main' });
        case 'commit-graph':
          return envelope({ nodes: [] });
        case 'file-tree':
          return envelope({ tree: [], fileCount: 0 });
        case 'pull-list':
          return envelope({ pulls: [{ number: 1, title: 'Ahead fixture PR', state: 'open', head: 'feat', base: 'main', author: 'you', reviews: 0, comments: 0 }] });
        case 'issue-list':
          return envelope({ issues: [] });
        case 'pull-detail':
          return envelope({
            pull: { number: 1, title: 'Ahead fixture PR', state: 'open', base: 'main', head: 'feat', author: 'you' },
            diff: null, conflicts: [], reviews: [], comments: [],
            mergeable: true, approvals: 0, changesRequested: 0,
            ahead: 2, behind: 1,
          });
        default:
          return envelope({ message: 'unhandled' });
      }
    });
  });

  it('branch list: the row shows ↑ahead · ↓behind for a non-default branch', async () => {
    render(<ConcordRepoWorkspace />);
    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(await screen.findByText('Branches'));
    expect(await screen.findByText(/↑2 ahead · ↓1 behind/)).toBeInTheDocument();
  });

  it('branch view header: checking out the branch shows its divergence from the default', async () => {
    render(<ConcordRepoWorkspace />);
    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(await screen.findByText('Branches'));
    const openButtons = await screen.findAllByText('Open in Code');
    fireEvent.click(openButtons[openButtons.length - 1]); // feat's row (main is first)
    expect(await screen.findByText(/↑2 ahead · ↓1 behind the default branch/)).toBeInTheDocument();
  });

  it('PR page: the detail header shows N ahead · M behind', async () => {
    render(<ConcordRepoWorkspace />);
    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(await screen.findByText('Pull requests'));
    fireEvent.click(await screen.findByText('Ahead fixture PR'));
    expect(await screen.findByText(/2 ahead · 1 behind/)).toBeInTheDocument();
  });
});

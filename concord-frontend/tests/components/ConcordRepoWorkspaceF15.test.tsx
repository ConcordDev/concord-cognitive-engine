/// <reference types="@testing-library/jest-dom/vitest" />
// Review F15 — two halves, pinned at the component level.
//
// (1) The banner error-truth pattern: a macro refusal (branch-delete's
// "branch_in_open_pr", file-save's "commit_message_required") used to
// banner as the literal text "network error" — the server's human
// message was dropped between lensRun's failure shape and this
// workspace's runX interpreter. runX now shows the message and keeps
// the code in `code`; this test drives a branch-delete refusal
// through the real component and asserts the banner tells the truth.
//
// (2) The PR lifecycle void: the detail view rendered a "Closed" pill
// for a state no control could reach. The Close/Reopen controls now
// call repos.pull-set-state; this test closes a PR and asserts the
// receipt + the state change render.
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

function envelope(result: unknown) {
  return { data: { ok: true, result } };
}

describe('ConcordRepoWorkspace — F15 banner truth + PR close path', () => {
  let prState = 'open';

  beforeEach(() => {
    prState = 'open';
    lensRun.mockReset();
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      switch (action) {
        case 'repo-list':
          return envelope({ repos: [REPO], count: 1 });
        case 'branch-list':
          return envelope({
            branches: [
              { name: 'main', isDefault: true, protected: true, commits: 1, head: 'abc1234' },
              { name: 'feat', isDefault: false, protected: false, commits: 1, head: 'def5678' },
            ],
            tags: [],
          });
        case 'commit-graph':
          return envelope({ nodes: [] });
        case 'branch-delete':
          // lensRun's shaped-failure return: the machine code in
          // `error`, the server's human sentence in `message`.
          return { data: { ok: false, result: null, error: 'branch_in_open_pr', message: 'Pull request #1 is still open against "feat" — merge or close it first.' } };
        case 'pull-list':
          return envelope({ pulls: [{ number: 1, title: 'F15 fixture PR', state: prState, head: 'feat', base: 'main', author: 'you', reviews: 0, comments: 0 }] });
        case 'issue-list':
          return envelope({ issues: [] });
        case 'pull-detail':
          return envelope({
            pull: { number: 1, title: 'F15 fixture PR', state: prState, base: 'main', head: 'feat', author: 'you' },
            diff: null, conflicts: [], reviews: [], comments: [],
            mergeable: true, approvals: 0, changesRequested: 0,
          });
        case 'pull-set-state':
          prState = 'closed';
          return envelope({ number: 1, state: 'closed' });
        default:
          return envelope({ message: 'unhandled' });
      }
    });
  });

  it('a business-rule refusal banners its real reason, not "network error"', async () => {
    render(<ConcordRepoWorkspace />);
    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(await screen.findByText('Branches'));
    fireEvent.click(await screen.findByText('Delete'));
    expect(await screen.findByText(/Pull request #1 is still open against "feat" — merge or close it first\./)).toBeInTheDocument();
    expect(screen.queryByText('network error')).toBeNull();
  });

  it('closes a pull request from its detail view — receipt and Closed state render', async () => {
    render(<ConcordRepoWorkspace />);
    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(await screen.findByText('Pull requests'));
    fireEvent.click(await screen.findByText('F15 fixture PR'));
    fireEvent.click(await screen.findByText('Close'));
    expect(await screen.findByText(/Pull request #1 closed — nothing was merged\./)).toBeInTheDocument();
    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(await screen.findByText('Reopen')).toBeInTheDocument();
  });
});

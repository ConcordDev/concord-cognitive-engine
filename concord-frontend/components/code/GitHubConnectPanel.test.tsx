/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GitHubConnectPanel } from './GitHubConnectPanel';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const REPO_A = {
  id: 1, fullName: 'octocat/hello-world', name: 'hello-world',
  private: false, description: 'A test repo', openIssues: 0, url: 'https://github.com/octocat/hello-world',
};
const TREE = {
  ref: 'main',
  sha: 'tree-sha-1',
  truncated: false,
  tree: [
    { path: 'README.md', type: 'blob', sha: 'blob-readme', size: 42, mode: '100644' },
    { path: 'src', type: 'tree', sha: 'tree-src', size: null, mode: '040000' },
    { path: 'src/index.js', type: 'blob', sha: 'blob-index-1', size: 100, mode: '100644' },
  ],
};
const FILE = {
  path: 'src/index.js', sha: 'blob-index-1', size: 100,
  content: 'console.log("hi");', encoding: 'utf8', htmlUrl: 'https://github.com/octocat/hello-world/blob/main/src/index.js',
};

function okEnvelope(result: unknown) {
  return { data: { ok: true, result, error: null } };
}
function failEnvelope(error: string) {
  return { data: { ok: false, result: null, error } };
}

/** Wires the mock to answer repos -> repo-tree -> file-get in the standard
 * happy-path order, and returns a helper to drive the click sequence. */
async function navigateToEditor() {
  lensRunMock.mockResolvedValueOnce(okEnvelope({ repos: [REPO_A] }));
  render(<GitHubConnectPanel />);

  await waitFor(() => expect(screen.getByTestId(`github-repo-${REPO_A.fullName}`)).toBeInTheDocument());

  lensRunMock.mockResolvedValueOnce(okEnvelope(TREE));
  fireEvent.click(screen.getByTestId(`github-repo-${REPO_A.fullName}`));
  await waitFor(() => expect(screen.getByTestId('github-tree-folder-src')).toBeInTheDocument());

  // src/index.js is nested — expand the src folder first.
  // (README.md is at the root and already visible.)
  fireEvent.click(screen.getByTestId('github-tree-folder-src'));
  await waitFor(() => expect(screen.getByTestId('github-tree-file-src/index.js')).toBeInTheDocument());

  lensRunMock.mockResolvedValueOnce(okEnvelope(FILE));
  fireEvent.click(screen.getByTestId('github-tree-file-src/index.js'));
  await waitFor(() => expect(screen.getByTestId('github-panel-editor')).toBeInTheDocument());
}

describe('GitHubConnectPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '', pathname: '/lenses/code' },
      writable: true,
    });
  });

  it('shows the honest not-connected state (never a fake repo list) when github.repos returns no_token', async () => {
    lensRunMock.mockResolvedValueOnce(failEnvelope('no_token'));
    render(<GitHubConnectPanel />);

    await waitFor(() => expect(screen.getByTestId('github-panel-not-connected')).toBeInTheDocument());
    expect(screen.queryByTestId('github-panel-repo-list')).toBeNull();
    expect(lensRunMock).toHaveBeenCalledWith('github', 'repos', {});
  });

  it('treats reauth_required and auth_expired the same as not-connected', async () => {
    for (const reason of ['reauth_required', 'auth_expired', 'github_disabled']) {
      lensRunMock.mockClear();
      lensRunMock.mockResolvedValueOnce(failEnvelope(reason));
      const { unmount } = render(<GitHubConnectPanel />);
      await waitFor(() => expect(screen.getByTestId('github-panel-not-connected')).toBeInTheDocument());
      unmount();
    }
  });

  it('clicking Connect GitHub calls github.connect and redirects to the real authorize URL', async () => {
    lensRunMock.mockResolvedValueOnce(failEnvelope('no_token'));
    render(<GitHubConnectPanel />);
    await waitFor(() => expect(screen.getByTestId('github-panel-connect-btn')).toBeInTheDocument());

    lensRunMock.mockResolvedValueOnce(okEnvelope({ provider: 'github', authorizeUrl: '/api/oauth/github/authorize?token_key=github', scopes: ['repo'] }));
    fireEvent.click(screen.getByTestId('github-panel-connect-btn'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('github', 'connect', { redirect: '/lenses/code' }));
    await waitFor(() => expect(window.location.href).toBe('/api/oauth/github/authorize?token_key=github'));
  });

  it('a genuine (non-connection) repos failure renders as an error, not an empty/fake repo list', async () => {
    lensRunMock.mockResolvedValueOnce(failEnvelope('handler_error'));
    render(<GitHubConnectPanel />);

    await waitFor(() => expect(screen.getByTestId('github-panel-repos-error')).toBeInTheDocument());
    expect(screen.getByTestId('github-panel-repos-error')).toHaveTextContent('handler_error');
    expect(screen.queryByTestId('github-panel-not-connected')).toBeNull();
  });

  it('lists real repos from github.repos and lets the user pick one to load the real file tree', async () => {
    lensRunMock.mockResolvedValueOnce(okEnvelope({ repos: [REPO_A] }));
    render(<GitHubConnectPanel />);
    await waitFor(() => expect(screen.getByTestId(`github-repo-${REPO_A.fullName}`)).toBeInTheDocument());
    expect(screen.getByText('octocat/hello-world')).toBeInTheDocument();

    lensRunMock.mockResolvedValueOnce(okEnvelope(TREE));
    fireEvent.click(screen.getByTestId(`github-repo-${REPO_A.fullName}`));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('github', 'repo-tree', { repo: 'octocat/hello-world' }));
    await waitFor(() => expect(screen.getByTestId('github-panel-file-tree')).toBeInTheDocument());
    // Root-level entries render immediately; nested src/index.js is a real leaf
    // under the src folder, revealed on expand (folders start collapsed).
    expect(screen.getByTestId('github-tree-file-README.md')).toBeInTheDocument();
    expect(screen.getByTestId('github-tree-folder-src')).toBeInTheDocument();
    expect(screen.queryByTestId('github-tree-file-src/index.js')).toBeNull();
    fireEvent.click(screen.getByTestId('github-tree-folder-src'));
    expect(screen.getByTestId('github-tree-file-src/index.js')).toBeInTheDocument();
  });

  it('an honest repo-tree failure surfaces the real reason, not a blank/fake tree', async () => {
    lensRunMock.mockResolvedValueOnce(okEnvelope({ repos: [REPO_A] }));
    render(<GitHubConnectPanel />);
    await waitFor(() => expect(screen.getByTestId(`github-repo-${REPO_A.fullName}`)).toBeInTheDocument());

    lensRunMock.mockResolvedValueOnce(failEnvelope('provider_error'));
    fireEvent.click(screen.getByTestId(`github-repo-${REPO_A.fullName}`));

    await waitFor(() => expect(screen.getByTestId('github-panel-tree-error')).toBeInTheDocument());
    expect(screen.getByTestId('github-panel-tree-error')).toHaveTextContent('provider_error');
  });

  it('picking a file calls github.file-get and loads the real content + sha into the editor', async () => {
    await navigateToEditor();
    expect(lensRunMock).toHaveBeenCalledWith('github', 'file-get', { repo: 'octocat/hello-world', path: 'src/index.js', ref: 'main' });
    expect(screen.getByTestId('github-panel-editor')).toHaveValue('console.log("hi");');
  });

  it('an honest file-get failure (not_a_file) never renders a fabricated editor', async () => {
    lensRunMock.mockResolvedValueOnce(okEnvelope({ repos: [REPO_A] }));
    render(<GitHubConnectPanel />);
    await waitFor(() => expect(screen.getByTestId(`github-repo-${REPO_A.fullName}`)).toBeInTheDocument());

    lensRunMock.mockResolvedValueOnce(okEnvelope(TREE));
    fireEvent.click(screen.getByTestId(`github-repo-${REPO_A.fullName}`));
    await waitFor(() => expect(screen.getByTestId('github-tree-file-README.md')).toBeInTheDocument());

    lensRunMock.mockResolvedValueOnce(failEnvelope('not_a_file'));
    fireEvent.click(screen.getByTestId('github-tree-file-README.md'));

    await waitFor(() => expect(screen.getByTestId('github-panel-file-error')).toBeInTheDocument());
    expect(screen.getByTestId('github-panel-file-error')).toHaveTextContent('not_a_file');
    expect(screen.queryByTestId('github-panel-editor')).toBeNull();
  });

  it('editing then committing calls github.file-commit with the REAL sha from file-get — never omitted for an existing file', async () => {
    await navigateToEditor();

    fireEvent.change(screen.getByTestId('github-panel-editor'), { target: { value: 'console.log("changed");' } });
    fireEvent.change(screen.getByTestId('github-panel-commit-message'), { target: { value: 'fix: update greeting' } });

    lensRunMock.mockResolvedValueOnce(okEnvelope({ commitSha: 'commit-sha-2', fileSha: 'blob-index-2', path: 'src/index.js', htmlUrl: 'https://github.com/octocat/hello-world/blob/main/src/index.js' }));
    fireEvent.click(screen.getByTestId('github-panel-commit-btn'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('github', 'file-commit', {
      repo: 'octocat/hello-world',
      path: 'src/index.js',
      content: 'console.log("changed");',
      message: 'fix: update greeting',
      sha: 'blob-index-1', // the real sha returned by file-get above — never undefined for an existing file
      branch: undefined,
    }));
    await waitFor(() => expect(screen.getByTestId('github-panel-commit-success')).toBeInTheDocument());
    expect(screen.getByTestId('github-panel-commit-success')).toHaveTextContent('blob-index-2');
  });

  it('a failed commit shows the real honest failure reason and NEVER a fabricated success banner', async () => {
    await navigateToEditor();

    fireEvent.change(screen.getByTestId('github-panel-editor'), { target: { value: 'console.log("changed");' } });
    fireEvent.change(screen.getByTestId('github-panel-commit-message'), { target: { value: 'fix: update greeting' } });

    lensRunMock.mockResolvedValueOnce(failEnvelope('provider_error'));
    fireEvent.click(screen.getByTestId('github-panel-commit-btn'));

    await waitFor(() => expect(screen.getByTestId('github-panel-commit-error')).toBeInTheDocument());
    expect(screen.getByTestId('github-panel-commit-error')).toHaveTextContent('provider_error');
    expect(screen.queryByTestId('github-panel-commit-success')).toBeNull();
  });

  it('the commit button is disabled until the content is actually edited (no pointless no-op commit)', async () => {
    await navigateToEditor();
    expect(screen.getByTestId('github-panel-commit-btn')).toBeDisabled();
    fireEvent.change(screen.getByTestId('github-panel-editor'), { target: { value: 'console.log("changed");' } });
    fireEvent.change(screen.getByTestId('github-panel-commit-message'), { target: { value: 'msg' } });
    expect(screen.getByTestId('github-panel-commit-btn')).not.toBeDisabled();
  });

  it('creating a branch calls github.branch-create with the loaded ref, then threads the new branch into the next commit', async () => {
    await navigateToEditor();

    fireEvent.click(screen.getByTestId('github-panel-show-branch-form'));
    fireEvent.change(screen.getByTestId('github-panel-new-branch-name'), { target: { value: 'feature/my-change' } });

    lensRunMock.mockResolvedValueOnce(okEnvelope({ ref: 'refs/heads/feature/my-change', sha: 'tree-sha-1' }));
    fireEvent.click(screen.getByTestId('github-panel-create-branch-btn'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('github', 'branch-create', {
      repo: 'octocat/hello-world', branchName: 'feature/my-change', fromRef: 'main',
    }));
    await waitFor(() => expect(screen.getByTestId('github-panel-branch-success')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('github-panel-editor'), { target: { value: 'console.log("changed");' } });
    fireEvent.change(screen.getByTestId('github-panel-commit-message'), { target: { value: 'msg on new branch' } });

    lensRunMock.mockResolvedValueOnce(okEnvelope({ commitSha: 'commit-sha-3', fileSha: 'blob-index-3', path: 'src/index.js', htmlUrl: null }));
    fireEvent.click(screen.getByTestId('github-panel-commit-btn'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('github', 'file-commit', expect.objectContaining({
      branch: 'feature/my-change',
      sha: 'blob-index-1',
    })));
  });

  it('a genuine branch-create failure shows the real reason, not a fabricated branch', async () => {
    await navigateToEditor();
    fireEvent.click(screen.getByTestId('github-panel-show-branch-form'));
    fireEvent.change(screen.getByTestId('github-panel-new-branch-name'), { target: { value: 'bad-branch' } });

    lensRunMock.mockResolvedValueOnce(failEnvelope('provider_error'));
    fireEvent.click(screen.getByTestId('github-panel-create-branch-btn'));

    await waitFor(() => expect(screen.getByTestId('github-panel-branch-error')).toBeInTheDocument());
    expect(screen.getByTestId('github-panel-branch-error')).toHaveTextContent('provider_error');
    expect(screen.queryByTestId('github-panel-branch-success')).toBeNull();
  });
});

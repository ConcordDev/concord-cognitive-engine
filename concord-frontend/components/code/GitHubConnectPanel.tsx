'use client';

/**
 * GitHubConnectPanel — a real GitHub-connected repo browser + file editor +
 * commit flow for the code lens (GH-2, following GH-1's new
 * repo-tree/file-get/file-commit/branch-create macros in
 * server/domains/github.js).
 *
 * State machine (each transition backed by a real macro call, never a
 * fabricated success):
 *   not-connected  --[github.connect + OAuth redirect]-->  (comes back connected)
 *   connected      --[github.repos]-->                     repo-list
 *   repo-list      --[github.repo-tree]-->                 file-tree (pick a repo)
 *   file-tree      --[github.file-get]-->                  editing   (pick a file;
 *                                                            the response's real
 *                                                            `sha` is cached — this
 *                                                            is what makes the next
 *                                                            commit safe)
 *   editing        --[github.file-commit]-->               success | failure
 *                    (sha ALWAYS included when the file already exists — the
 *                    value came straight from the file-get response above;
 *                    GH-1 deliberately never auto-fetches it, so the UI must)
 *   editing        --[github.branch-create]-->             (optional — targets
 *                                                            subsequent commits
 *                                                            at the new branch)
 *
 * Every "connected but the call failed" path (reauth_required / auth_expired /
 * provider_error / not_a_file / ...) renders the REAL reason string GH-1
 * returns — never a generic "something went wrong" and never a fabricated
 * success. A failed commit never flips to a success banner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Github, Loader2, Folder, FolderOpen, File as FileIcon, ChevronLeft,
  GitCommit, GitBranch, CheckCircle2, XCircle, ExternalLink, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// Matches R1-3's connector-reliability vocabulary — these reasons mean "the
// user needs to (re)connect", never "something is broken".
const NOT_CONNECTED = new Set(['no_token', 'reauth_required', 'auth_expired', 'github_disabled']);

interface RepoRow {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  description: string;
  openIssues: number;
  url: string;
}
interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size: number | null;
  mode: string;
}
interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: Map<string, TreeNode>;
}

function buildTree(entries: TreeEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', type: 'folder', children: new Map() };
  for (const e of entries) {
    if (e.type !== 'blob' && e.type !== 'tree') continue; // skip submodule ('commit') entries
    const parts = e.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      let next = node.children.get(part);
      if (!next) {
        next = { name: part, path, type: isLast && e.type === 'blob' ? 'file' : 'folder', children: new Map() };
        node.children.set(part, next);
      }
      node = next;
    });
  }
  return root;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  return Array.from(node.children.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function TreeBrowser({
  node, depth, expanded, onToggle, onSelectFile, selectedPath,
}: {
  node: TreeNode; depth: number; expanded: Set<string>;
  onToggle: (path: string) => void; onSelectFile: (path: string) => void; selectedPath: string | null;
}) {
  return (
    <>
      {sortedChildren(node).map((child) => {
        if (child.type === 'folder') {
          const isOpen = expanded.has(child.path);
          return (
            <div key={child.path}>
              <button
                type="button"
                data-testid={`github-tree-folder-${child.path}`}
                onClick={() => onToggle(child.path)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:bg-white/5 rounded"
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
              >
                {isOpen ? <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                <span className="truncate">{child.name}</span>
              </button>
              {isOpen && (
                <TreeBrowser
                  node={child} depth={depth + 1} expanded={expanded}
                  onToggle={onToggle} onSelectFile={onSelectFile} selectedPath={selectedPath}
                />
              )}
            </div>
          );
        }
        return (
          <button
            key={child.path}
            type="button"
            data-testid={`github-tree-file-${child.path}`}
            onClick={() => onSelectFile(child.path)}
            className={cn(
              'w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded truncate',
              selectedPath === child.path ? 'bg-cyan-500/15 text-cyan-300' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
            )}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <FileIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{child.name}</span>
          </button>
        );
      })}
    </>
  );
}

export function GitHubConnectPanel() {
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [reposLoading, setReposLoading] = useState(false);
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [reposError, setReposError] = useState<string | null>(null);

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [treeRef, setTreeRef] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSha, setFileSha] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileHtmlUrl, setFileHtmlUrl] = useState<string | null>(null);

  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<
    { ok: true; commitSha: string | null; fileSha: string | null; htmlUrl: string | null } | { ok: false; error: string } | null
  >(null);

  const [targetBranch, setTargetBranch] = useState<string | null>(null);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchCreating, setBranchCreating] = useState(false);
  const [branchResult, setBranchResult] = useState<{ ok: true; ref: string } | { ok: false; error: string } | null>(null);

  const loadRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const r = await lensRun('github', 'repos', {});
      if (r.data?.ok) {
        setNotConnected(false);
        setRepos((r.data.result as { repos?: RepoRow[] } | null)?.repos ?? []);
      } else {
        const reason = r.data?.error || 'repos_failed';
        if (NOT_CONNECTED.has(reason)) setNotConnected(true);
        else setReposError(reason);
      }
    } catch {
      setReposError('network_error');
    } finally {
      setConnectionChecked(true);
      setReposLoading(false);
    }
  }, []);

  useEffect(() => { void loadRepos(); }, [loadRepos]);

  const connect = useCallback(async () => {
    setConnectError(null);
    try {
      const r = await lensRun('github', 'connect', { redirect: window.location.pathname });
      const url = (r.data?.result as { authorizeUrl?: string } | null)?.authorizeUrl;
      if (url) window.location.href = url;
      else setConnectError('Could not start the GitHub connection.');
    } catch {
      setConnectError('network_error');
    }
  }, []);

  const loadTree = useCallback(async (repo: string) => {
    setTreeLoading(true);
    setTreeError(null);
    setTree([]);
    setTreeRef(null);
    try {
      const r = await lensRun('github', 'repo-tree', { repo });
      if (r.data?.ok) {
        const res = r.data.result as { ref: string; tree: TreeEntry[] } | null;
        setTree(res?.tree ?? []);
        setTreeRef(res?.ref ?? null);
        setExpanded(new Set());
      } else {
        const reason = r.data?.error || 'repo_tree_failed';
        if (NOT_CONNECTED.has(reason)) setNotConnected(true);
        else setTreeError(reason);
      }
    } catch {
      setTreeError('network_error');
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const selectRepo = useCallback((fullName: string) => {
    setSelectedRepo(fullName);
    setSelectedPath(null);
    setFileSha(null);
    setOriginalContent('');
    setEditedContent('');
    setFileError(null);
    setCommitResult(null);
    setTargetBranch(null);
    setBranchResult(null);
    setShowBranchForm(false);
    void loadTree(fullName);
  }, [loadTree]);

  const loadFile = useCallback(async (repo: string, path: string, ref: string | null) => {
    setFileLoading(true);
    setFileError(null);
    setCommitResult(null);
    try {
      const r = await lensRun('github', 'file-get', { repo, path, ref: ref || undefined });
      if (r.data?.ok) {
        const res = r.data.result as { content: string; sha: string; htmlUrl: string | null } | null;
        const content = res?.content ?? '';
        setOriginalContent(content);
        setEditedContent(content);
        setFileSha(res?.sha ?? null);
        setFileHtmlUrl(res?.htmlUrl ?? null);
      } else {
        const reason = r.data?.error || 'file_get_failed';
        if (NOT_CONNECTED.has(reason)) setNotConnected(true);
        else setFileError(reason);
        setFileSha(null);
      }
    } catch {
      setFileError('network_error');
      setFileSha(null);
    } finally {
      setFileLoading(false);
    }
  }, []);

  const selectFile = useCallback((path: string) => {
    setSelectedPath(path);
    setCommitMessage('');
    setCommitResult(null);
    if (selectedRepo) void loadFile(selectedRepo, path, treeRef);
  }, [selectedRepo, treeRef, loadFile]);

  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const dirty = editedContent !== originalContent;

  const commit = useCallback(async () => {
    if (!selectedRepo || !selectedPath || !commitMessage.trim()) return;
    setCommitting(true);
    setCommitResult(null);
    try {
      // `sha` is caller-declared intent per GH-1: this file was loaded via
      // file-get above, so it genuinely exists — the sha MUST be threaded
      // through here or the write risks clobbering a concurrent change.
      const r = await lensRun('github', 'file-commit', {
        repo: selectedRepo,
        path: selectedPath,
        content: editedContent,
        message: commitMessage.trim(),
        sha: fileSha ?? undefined,
        branch: targetBranch ?? undefined,
      });
      if (r.data?.ok) {
        const res = r.data.result as { commitSha: string | null; fileSha: string | null; htmlUrl: string | null } | null;
        setCommitResult({ ok: true, commitSha: res?.commitSha ?? null, fileSha: res?.fileSha ?? null, htmlUrl: res?.htmlUrl ?? null });
        // The file now lives at the new sha — thread it through so the NEXT
        // commit (if the user keeps editing) is still conflict-safe.
        if (res?.fileSha) setFileSha(res.fileSha);
        setOriginalContent(editedContent);
        setCommitMessage('');
      } else {
        const reason = r.data?.error || 'file_commit_failed';
        if (NOT_CONNECTED.has(reason)) setNotConnected(true);
        setCommitResult({ ok: false, error: reason });
      }
    } catch {
      setCommitResult({ ok: false, error: 'network_error' });
    } finally {
      setCommitting(false);
    }
  }, [selectedRepo, selectedPath, commitMessage, editedContent, fileSha, targetBranch]);

  const createBranch = useCallback(async () => {
    if (!selectedRepo || !newBranchName.trim() || !treeRef) return;
    setBranchCreating(true);
    setBranchResult(null);
    try {
      const r = await lensRun('github', 'branch-create', {
        repo: selectedRepo, branchName: newBranchName.trim(), fromRef: treeRef,
      });
      if (r.data?.ok) {
        const res = r.data.result as { ref: string } | null;
        setBranchResult({ ok: true, ref: res?.ref || `refs/heads/${newBranchName.trim()}` });
        setTargetBranch(newBranchName.trim());
        setNewBranchName('');
      } else {
        const reason = r.data?.error || 'branch_create_failed';
        if (NOT_CONNECTED.has(reason)) setNotConnected(true);
        setBranchResult({ ok: false, error: reason });
      }
    } catch {
      setBranchResult({ ok: false, error: 'network_error' });
    } finally {
      setBranchCreating(false);
    }
  }, [selectedRepo, newBranchName, treeRef]);

  const rootNode = useMemo(() => buildTree(tree), [tree]);

  // ── not-connected ──────────────────────────────────────────────────────
  if (!connectionChecked) {
    return (
      <div data-testid="github-panel-loading" className="p-4 flex items-center gap-2 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking GitHub connection…
      </div>
    );
  }
  if (notConnected) {
    return (
      <div data-testid="github-panel-not-connected" className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-200">
          <Github className="w-4 h-4" />
          <span className="font-semibold">Connect GitHub</span>
        </div>
        <p className="text-xs text-gray-400">
          Connect your own GitHub account to browse a repo, edit a file, and commit — using your real OAuth token, never a shared credential.
        </p>
        <button
          type="button"
          data-testid="github-panel-connect-btn"
          onClick={connect}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 border border-white/10 text-xs font-bold text-white"
        >
          <Github className="w-4 h-4" /> Connect GitHub
        </button>
        {connectError && <p data-testid="github-panel-connect-error" className="text-xs text-rose-400">{connectError}</p>}
      </div>
    );
  }

  // ── connected: repo list / tree / editor ────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">
      <div className="p-2 border-b border-white/10 flex items-center justify-between">
        <span className="font-semibold text-gray-200 flex items-center gap-1.5"><Github className="w-3.5 h-3.5" /> GitHub</span>
        <button type="button" title="Refresh repos" onClick={() => void loadRepos()} className="p-1 rounded hover:bg-white/10 text-gray-400">
          {reposLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      {reposError && <p data-testid="github-panel-repos-error" className="p-2 text-rose-400">{reposError}</p>}

      {!selectedRepo && (
        <div data-testid="github-panel-repo-list" className="flex-1 overflow-y-auto">
          {reposLoading && repos.length === 0 ? (
            <div data-testid="github-panel-repos-loading" className="p-3 flex items-center gap-2 text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading repos…
            </div>
          ) : repos.length === 0 ? (
            <p className="p-3 text-gray-400">No repos found on your GitHub account.</p>
          ) : (
            repos.map((repo) => (
              <button
                key={repo.id}
                type="button"
                data-testid={`github-repo-${repo.fullName}`}
                onClick={() => selectRepo(repo.fullName)}
                className="w-full text-left px-3 py-2 border-b border-white/5 hover:bg-white/5"
              >
                <div className="flex items-center gap-1.5 text-gray-200 font-medium truncate">
                  {repo.fullName}
                  {repo.private && <span className="text-[9px] px-1 rounded bg-white/10 text-gray-400">private</span>}
                </div>
                {repo.description && <div className="text-gray-500 truncate">{repo.description}</div>}
              </button>
            ))
          )}
        </div>
      )}

      {selectedRepo && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-white/10 flex items-center gap-2">
            <button
              type="button"
              data-testid="github-panel-back-to-repos"
              onClick={() => { setSelectedRepo(null); setSelectedPath(null); }}
              className="p-1 rounded hover:bg-white/10 text-gray-400"
              title="Back to repos"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-gray-200 font-medium truncate">{selectedRepo}</span>
            {treeRef && <span className="text-[10px] text-gray-500 flex items-center gap-1"><GitBranch className="w-3 h-3" />{targetBranch || treeRef}</span>}
          </div>

          {!selectedPath && (
            <div data-testid="github-panel-file-tree" className="flex-1 overflow-y-auto py-1">
              {treeLoading ? (
                <div data-testid="github-panel-tree-loading" className="p-3 flex items-center gap-2 text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading file tree…
                </div>
              ) : treeError ? (
                <p data-testid="github-panel-tree-error" className="p-3 text-rose-400">{treeError}</p>
              ) : (
                <TreeBrowser node={rootNode} depth={0} expanded={expanded} onToggle={toggleFolder} onSelectFile={selectFile} selectedPath={selectedPath} />
              )}
            </div>
          )}

          {selectedPath && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-2 border-b border-white/10 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="github-panel-back-to-tree"
                  onClick={() => setSelectedPath(null)}
                  className="p-1 rounded hover:bg-white/10 text-gray-400"
                  title="Back to file tree"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-gray-200 truncate">{selectedPath}</span>
                {fileHtmlUrl && (
                  <a href={fileHtmlUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-cyan-400">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {fileLoading ? (
                <div data-testid="github-panel-file-loading" className="p-3 flex items-center gap-2 text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading file…
                </div>
              ) : fileError ? (
                <p data-testid="github-panel-file-error" className="p-3 text-rose-400">{fileError}</p>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden p-2 gap-2">
                  <textarea
                    data-testid="github-panel-editor"
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    spellCheck={false}
                    className="flex-1 min-h-[160px] w-full bg-[#0d1117] border border-white/10 rounded p-2 font-mono text-[11px] text-gray-200 resize-y"
                  />

                  {!showBranchForm ? (
                    <button
                      type="button"
                      data-testid="github-panel-show-branch-form"
                      onClick={() => setShowBranchForm(true)}
                      className="self-start text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      <GitBranch className="w-3 h-3" /> New branch before committing
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        data-testid="github-panel-new-branch-name"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        placeholder="new-branch-name"
                        className="flex-1 bg-[#0d1117] border border-white/10 rounded px-2 py-1 text-[11px] text-gray-200"
                      />
                      <button
                        type="button"
                        data-testid="github-panel-create-branch-btn"
                        disabled={branchCreating || !newBranchName.trim()}
                        onClick={createBranch}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-gray-200 disabled:opacity-40"
                      >
                        {branchCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
                        Create
                      </button>
                    </div>
                  )}
                  {branchResult && (branchResult.ok ? (
                    <p data-testid="github-panel-branch-success" className="text-[10px] text-green-400">
                      Branch created: {branchResult.ref}. Commits below will target it.
                    </p>
                  ) : (
                    <p data-testid="github-panel-branch-error" className="text-[10px] text-rose-400">{branchResult.error}</p>
                  ))}

                  <div className="flex items-center gap-2">
                    <input
                      data-testid="github-panel-commit-message"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit message"
                      className="flex-1 bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-[11px] text-gray-200"
                    />
                    <button
                      type="button"
                      data-testid="github-panel-commit-btn"
                      disabled={committing || !commitMessage.trim() || !dirty}
                      onClick={commit}
                      title={!dirty ? 'No changes to commit' : undefined}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-bold"
                    >
                      {committing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommit className="w-3.5 h-3.5" />}
                      Commit &amp; Push
                    </button>
                  </div>

                  {committing && (
                    <p data-testid="github-panel-committing" className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Committing to {targetBranch || treeRef}…
                    </p>
                  )}
                  {commitResult && (commitResult.ok ? (
                    <p data-testid="github-panel-commit-success" className="text-[10px] text-green-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Committed — new sha {commitResult.fileSha}
                      {commitResult.htmlUrl && (
                        <a href={commitResult.htmlUrl} target="_blank" rel="noreferrer" className="underline">view</a>
                      )}
                    </p>
                  ) : (
                    <p data-testid="github-panel-commit-error" className="text-[10px] text-rose-400 flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" /> {commitResult.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GitHubConnectPanel;

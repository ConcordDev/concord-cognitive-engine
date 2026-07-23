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
  FilePlus, ChevronDown, ChevronRight,
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

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  text: string;
}

/**
 * A real line-level diff between two real strings — no library dependency
 * (none is installed in this repo; grepped package.json + node_modules
 * before writing this). Standard LCS-based line alignment so a line moved by
 * an unrelated insertion/deletion elsewhere doesn't get misreported as
 * "changed" the way a naive positional (index-by-index) comparison would.
 * Falls back to a coarser positional diff only past a quadratic-blowup guard
 * (n*m > 4,000,000, i.e. roughly 2000x2000 lines) so a huge file can't hang
 * the tab — still a real comparison of the real content, just less precise
 * at that size.
 */
function computeLineDiff(originalText: string, editedText: string): DiffLine[] {
  const a = originalText.split('\n');
  const b = editedText.split('\n');
  const n = a.length;
  const m = b.length;

  if (n * m > 4_000_000) {
    const max = Math.max(n, m);
    const lines: DiffLine[] = [];
    for (let i = 0; i < max; i++) {
      const oldLine = a[i];
      const newLine = b[i];
      if (oldLine === newLine) lines.push({ type: 'context', text: oldLine ?? '' });
      else {
        if (oldLine !== undefined) lines.push({ type: 'remove', text: oldLine });
        if (newLine !== undefined) lines.push({ type: 'add', text: newLine });
      }
    }
    return lines;
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push({ type: 'context', text: a[i] }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ type: 'remove', text: a[i] }); i++; } else { lines.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) { lines.push({ type: 'remove', text: a[i] }); i++; }
  while (j < m) { lines.push({ type: 'add', text: b[j] }); j++; }
  return lines;
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

  // ── new-file flow (create-vs-update per GH-1: sha present = update, sha
  // absent entirely = create) ─────────────────────────────────────────────
  const [showNewFileForm, setShowNewFileForm] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const [isNewFile, setIsNewFile] = useState(false);

  // ── diff-before-commit preview ──────────────────────────────────────────
  const [diffExpanded, setDiffExpanded] = useState(false);

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
    setIsNewFile(false);
    setShowNewFileForm(false);
    setNewFilePath('');
    setNewFileError(null);
    setDiffExpanded(false);
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
    setIsNewFile(false);
    setDiffExpanded(false);
    if (selectedRepo) void loadFile(selectedRepo, path, treeRef);
  }, [selectedRepo, treeRef, loadFile]);

  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  // Real paths already in the loaded tree (files AND folders — a new file
  // can't collide with either) — the actual collision check, not a guess.
  const existingTreePaths = useMemo(() => new Set(tree.map((e) => e.path)), [tree]);

  const startNewFile = useCallback(() => {
    const path = newFilePath.trim();
    if (!path) {
      setNewFileError('Enter a file path.');
      return;
    }
    if (existingTreePaths.has(path)) {
      setNewFileError(`"${path}" already exists in this repo — pick a different path or open it from the tree to edit it.`);
      return;
    }
    setNewFileError(null);
    setShowNewFileForm(false);
    setNewFilePath('');
    setSelectedPath(path);
    setIsNewFile(true);
    setFileSha(null);
    setOriginalContent('');
    setEditedContent('');
    setFileError(null);
    setFileHtmlUrl(null);
    setCommitMessage('');
    setCommitResult(null);
    setDiffExpanded(false);
  }, [newFilePath, existingTreePaths]);

  const dirty = editedContent !== originalContent;

  // Real LCS-based diff between the cached original (from file-get, or '' for
  // a brand-new file) and the live textarea content — recomputed only when
  // either side actually changes. No fabricated diff: this IS the string
  // comparison, rendered.
  const diffLines = useMemo(() => computeLineDiff(originalContent, editedContent), [originalContent, editedContent]);
  const diffStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const line of diffLines) {
      if (line.type === 'add') added++;
      else if (line.type === 'remove') removed++;
    }
    return { added, removed };
  }, [diffLines]);
  const hasDiff = diffStats.added > 0 || diffStats.removed > 0;

  const commit = useCallback(async () => {
    if (!selectedRepo || !selectedPath || !commitMessage.trim()) return;
    setCommitting(true);
    setCommitResult(null);
    try {
      const params: Record<string, unknown> = {
        repo: selectedRepo,
        path: selectedPath,
        content: editedContent,
        message: commitMessage.trim(),
        branch: targetBranch ?? undefined,
      };
      // `sha` is caller-declared intent per GH-1: present = update an
      // existing file (the value MUST be the real sha from file-get above,
      // threaded through so the write can't clobber a concurrent change);
      // absent = create a brand-new file. A new-file commit must NEVER
      // include the key at all — not even as `undefined` — or GH-1 could
      // read it as an update against a file that doesn't exist yet.
      if (!isNewFile) {
        params.sha = fileSha ?? undefined;
      }
      const r = await lensRun('github', 'file-commit', params);
      if (r.data?.ok) {
        const res = r.data.result as { commitSha: string | null; fileSha: string | null; htmlUrl: string | null } | null;
        setCommitResult({ ok: true, commitSha: res?.commitSha ?? null, fileSha: res?.fileSha ?? null, htmlUrl: res?.htmlUrl ?? null });
        // The file now lives at the new sha — thread it through so the NEXT
        // commit (if the user keeps editing) is still conflict-safe. This
        // also flips a freshly-created file over to the update path.
        if (res?.fileSha) setFileSha(res.fileSha);
        setIsNewFile(false);
        setOriginalContent(editedContent);
        setCommitMessage('');
        setTree((prev) => (prev.some((e) => e.path === selectedPath)
          ? prev
          : [...prev, { path: selectedPath, type: 'blob', sha: res?.fileSha ?? '', size: editedContent.length, mode: '100644' }]));
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
  }, [selectedRepo, selectedPath, commitMessage, editedContent, fileSha, targetBranch, isNewFile]);

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
              {/* Only offered once a real tree has loaded — validating a new
                  path against a stale/empty/errored tree would be dishonest
                  (a "no collision" result could just mean we never fetched
                  the real list yet). */}
              {!treeLoading && !treeError && (
              <div className="px-2 pb-1.5 mb-1 border-b border-white/10">
                {!showNewFileForm ? (
                  <button
                    type="button"
                    data-testid="github-panel-new-file-btn"
                    onClick={() => { setShowNewFileForm(true); setNewFileError(null); }}
                    className="flex items-center gap-1 text-[10px] text-cyan-400 hover:underline"
                  >
                    <FilePlus className="w-3 h-3" /> New file
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      data-testid="github-panel-new-file-path"
                      value={newFilePath}
                      onChange={(e) => { setNewFilePath(e.target.value); setNewFileError(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') startNewFile(); }}
                      placeholder="path/to/new-file.ts"
                      className="flex-1 bg-[#0d1117] border border-white/10 rounded px-2 py-1 text-[11px] text-gray-200"
                    />
                    <button
                      type="button"
                      data-testid="github-panel-new-file-create-btn"
                      onClick={startNewFile}
                      className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-gray-200"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      data-testid="github-panel-new-file-cancel-btn"
                      onClick={() => { setShowNewFileForm(false); setNewFilePath(''); setNewFileError(null); }}
                      className="px-2 py-1 text-gray-500 hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {newFileError && <p data-testid="github-panel-new-file-error" className="mt-1 text-rose-400">{newFileError}</p>}
              </div>
              )}
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
                {isNewFile && (
                  <span data-testid="github-panel-new-file-badge" className="text-[9px] px-1 rounded bg-cyan-500/15 text-cyan-300 shrink-0">new file</span>
                )}
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

                  {/* Real diff-before-commit preview — computed from the
                      genuine cached original (file-get's content, or '' for
                      a brand-new file) vs. the live textarea. Never rendered
                      from a fabricated placeholder. */}
                  <div data-testid="github-panel-diff-section" className="border border-white/10 rounded overflow-hidden">
                    <button
                      type="button"
                      data-testid="github-panel-diff-toggle"
                      onClick={() => setDiffExpanded((v) => !v)}
                      disabled={!hasDiff}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-gray-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:text-gray-500"
                    >
                      {hasDiff ? (diffExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : null}
                      {hasDiff
                        ? `${diffExpanded ? 'Hide' : 'Review'} changes (+${diffStats.added} / -${diffStats.removed})`
                        : 'No changes to commit'}
                    </button>
                    {hasDiff && diffExpanded && (
                      <div data-testid="github-panel-diff-lines" className="max-h-48 overflow-y-auto font-mono text-[10px] border-t border-white/10 bg-[#0d1117]">
                        {diffLines.map((line, idx) => (
                          <div
                            // Diff lines have no stable identity of their own (no library, no ids) —
                            // order never reshuffles within one computed diff, so the index is safe.
                            key={idx}
                            data-testid={`github-panel-diff-line-${line.type}`}
                            className={cn(
                              'px-2 whitespace-pre-wrap leading-4',
                              line.type === 'add' && 'bg-green-500/10 text-green-300',
                              line.type === 'remove' && 'bg-rose-500/10 text-rose-300',
                              line.type === 'context' && 'text-gray-500',
                            )}
                          >
                            {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}{line.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

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

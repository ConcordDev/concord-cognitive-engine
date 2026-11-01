'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ConcordRepoWorkspace — a full GitHub-shape experience over the Concord
 * repo substrate (server/domains/repos.js). Wires every substrate macro:
 * repo-create/list, file-tree/read/save, branch/tag, commit-graph,
 * issue lifecycle, pull request diff/review/merge, CI workflow runs +
 * logs, security scan, repo insights, and static-analysis (code
 * complexity / commit patterns / dependency audit) over this repo's
 * own real files, commits and package.json.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TreeDiagram, TimelineView } from '@/components/viz';
import type { TreeNode, TimelineEvent } from '@/components/viz';
import {
  Code, FileText, GitBranch, GitCommit, GitPullRequest, AlertCircle,
  CheckCircle, Play, Shield, BarChart3, Plus, Loader2, Tag, X,
  AlertTriangle, Activity,
} from 'lucide-react';

type Tab = 'code' | 'issues' | 'pulls' | 'actions' | 'security' | 'insights' | 'branches' | 'analysis' | 'settings';

interface RepoSummary {
  id: string; name: string; description: string; language: string;
  isPrivate: boolean; fileCount: number; branchCount: number;
  openIssues: number; openPulls: number; updatedAt: string; defaultBranch?: string;
}
interface TreeFileNode {
  name: string; type: 'file' | 'dir'; path: string; size?: number;
  children?: TreeFileNode[];
}
interface FileContent { path: string; content: string; language: string; lineCount: number; }
interface BranchRow { name: string; head: string; protected: boolean; isDefault: boolean; commits: number; ahead?: number; behind?: number; }
interface TagRow { name: string; commit: string; message?: string; createdAt: string; }
interface IssueRow { number: number; title: string; state: string; labels: string[]; author: string; comments: number; createdAt: string; }
interface IssueDetail { number: number; title: string; body: string; state: string; author: string; labels: string[]; comments: Array<{ id: string; author: string; body: string; createdAt: string }>; createdAt: string; linkedPulls?: Array<{ number: number; title: string; state: string }>; }
interface PullRow { number: number; title: string; state: string; base: string; head: string; author: string; reviews: number; comments: number; }
interface DiffHunk { type: 'add' | 'del' | 'ctx'; line: string; oldLine?: number | null; newLine?: number | null; }
interface PullComment { id: string; author: string; body: string; createdAt: string; path?: string; line?: number; }
interface PullConflict { path: string; lines?: number[]; reason?: string; }
interface PullDetail {
  pull: { number: number; title: string; body: string; state: string; base: string; head: string; author: string; linkedIssues?: number[] };
  diff: { files: Array<{ path: string; language: string; status?: string; additions: number; deletions: number; hunks: DiffHunk[]; hunksTruncated?: boolean }>; additions: number; deletions: number; fileCount: number } | null;
  diffUnavailable?: string;
  conflicts: PullConflict[] | null;
  reviews: Array<{ id: string; reviewer: string; verdict: string; body: string; createdAt: string }>;
  comments: PullComment[];
  mergeable: boolean; approvals: number; changesRequested: number;
  ahead?: number; behind?: number;
}
interface WorkflowRow { id: string; number: number; workflow: string; branch: string; conclusion: string; durationMs: number; createdAt: string; }
interface WorkflowStep { name: string; conclusion: string; durationMs: number; logs: string[]; }
interface SecurityAlert { kind: string; severity: string; package?: string; version?: string; summary?: string; fixedIn?: string; osvId?: string; path?: string; line?: number; rule?: string; message?: string; }
interface CommitGraphNode { sha: string; message: string; author: string; branch: string; date: string; additions: number; deletions: number; files: string[]; }

const DOMAIN = 'repos';

/**
 * Envelope helper — /api/lens/run wraps a macro's own return as
 * { ok: true, result: <macro return> }. The macro's own return is itself
 * either { ok:true, result:<data> } (peeled server-side to just <data>) or
 * { ok:false, error } (passed through unchanged, still under transport
 * `ok:true`). So a transport-level `ok:true` does NOT mean the macro
 * succeeded — reading only that field mislabels a real macro failure as
 * success data (the exact envelope-unwrap bug this program watches for).
 * runX() interprets both layers correctly and every call site below reads
 * both `ok` and `error` off it — never just the transport layer.
 */
interface Envelope<T> { ok: boolean; data: T | null; error: string | null; code: string | null; }

async function runX<T = any>(name: string, params: Record<string, unknown>): Promise<Envelope<T>> {
  try {
    const r = await lensRun<any>(DOMAIN, name, params);
    if (!r.data?.ok) return { ok: false, data: null, error: 'network error', code: null };
    const inner = r.data.result;
    if (inner && typeof inner === 'object' && inner.ok === false) {
      // The macro's human `message` is what the user reads; the
      // machine `error` code rides along separately for flows that
      // branch on it (e.g. the empty-content confirm). Showing the
      // raw code as the explanation was transport language as UI.
      return {
        ok: false, data: null,
        error: String(inner.message || inner.error || 'request failed'),
        code: inner.error ? String(inner.error) : null,
      };
    }
    return { ok: true, data: inner as T, error: null, code: null };
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : String(e), code: null };
  }
}

const SEV_COLOR: Record<string, string> = {
  critical: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  moderate: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  low: 'text-zinc-400 bg-zinc-700/30 border-zinc-600',
};

function toTreeNodes(nodes: TreeFileNode[]): TreeNode[] {
  return nodes.map((n) => ({
    id: n.path,
    label: n.type === 'file' ? `${n.name}${n.size != null ? `  (${n.size}b)` : ''}` : n.name,
    tone: n.type === 'dir' ? 'info' : 'default',
    children: n.children ? toTreeNodes(n.children) : undefined,
  }));
}

function flattenFiles(nodes: TreeFileNode[]): TreeFileNode[] {
  const out: TreeFileNode[] = [];
  for (const n of nodes) {
    if (n.type === 'file') out.push(n);
    else if (n.children) out.push(...flattenFiles(n.children));
  }
  return out;
}

function ErrorBanner({ err }: { err: string | null }) {
  if (!err) return null;
  return (
    <p className="flex items-center gap-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">
      <AlertTriangle className="h-3 w-3 shrink-0" /> {err}
    </p>
  );
}

export function ConcordRepoWorkspace() {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [activeRepo, setActiveRepo] = useState<RepoSummary | null>(null);
  const [tab, setTab] = useState<Tab>('code');
  // The branch the Code view is standing on — shared so the Branches
  // tab can check a branch out into the Code view (Review S1).
  const [currentBranch, setCurrentBranch] = useState<string>('main');
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);

  // Repo create
  const [newRepoName, setNewRepoName] = useState('');

  // Only the FIRST load gates the view behind the spinner. Later
  // refreshes (a Settings save, a delete) must not unmount the open
  // repo view: unmounting destroyed every tab's local state — which
  // is why a Settings save's own success banner never survived to be
  // seen in the follow-up re-pass (receipts round, PR #1837).
  const loadRepos = useCallback(async () => {
    if (!loadedOnce) setLoading(true);
    const res = await runX<{ repos: RepoSummary[] }>('repo-list', {});
    if (res.ok) { setRepos(res.data?.repos || []); setListErr(null); }
    else { setListErr(res.error); }
    setLoading(false);
    setLoadedOnce(true);
  }, [loadedOnce]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadRepos(); }, []);

  const createRepo = async () => {
    if (!newRepoName.trim()) return;
    const name = newRepoName.trim();
    setBusy('create-repo');
    setListNotice(null);
    const r = await runX('repo-create', { name, description: 'A Concord repository' });
    if (r.ok) {
      setNewRepoName(''); setListErr(null);
      setListNotice(`Created "${name}" — seeded with the starter tree (README.md, package.json, src/). Open it below to start editing.`);
      await loadRepos();
    }
    else { setListErr(r.error); }
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-cyan-400" />
            <h2 className="text-sm font-semibold text-white">Concord Code Host</h2>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              {repos.length} repos
            </span>
          </div>
          {/* S9: say what a Concord repo is, in words a user knows. */}
          <p className="mt-1 max-w-xl text-[11px] text-zinc-400">
            A Concord repo lives in Concord: versioned files, branches and reviews —
            no git remote, nothing to clone, nothing to push. What you commit here is
            recorded here, with its history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="repo-new-name"
            value={newRepoName}
            onChange={(e) => setNewRepoName(e.target.value)}
            placeholder="new-repo-name"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
          />
          <button
            onClick={createRepo}
            disabled={busy === 'create-repo' || !newRepoName.trim()}
            className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy === 'create-repo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            New repo
          </button>
        </div>
      </header>

      {!activeRepo && (
        <p className="-mt-2 text-[10px] text-zinc-500">
          New repos are seeded with a starter tree — README.md, package.json and src/ — so there is something real to edit from the first minute. It is scaffolding, disclosed as such: make it yours.
        </p>
      )}

      <ErrorBanner err={listErr} />
      {listNotice && !activeRepo && (
        <p className="flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] text-green-300">
          <CheckCircle className="h-3 w-3 shrink-0" /> {listNotice}
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading repos…
        </div>
      )}

      {!loading && !activeRepo && (
        <div className="space-y-2">
          {repos.length === 0 && (
            <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
              No repos yet. Create one above to get a file tree, branches, issues, PRs and CI —
              it starts with a small starter tree (README, package.json, src/) seeded by Concord.
            </div>
          )}
          {repos.map((r) => (
            <button
              key={r.id}
              onClick={() => { setActiveRepo(r); setTab('code'); setCurrentBranch(r.defaultBranch || 'main'); setListNotice(null); }}
              className="block w-full rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-left hover:border-cyan-500/40"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-cyan-300">{r.name}</span>
                <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400">
                  {r.isPrivate ? 'private' : 'public'}
                </span>
              </div>
              {r.description && <p className="mt-0.5 text-[11px] text-zinc-400">{r.description}</p>}
              <div className="mt-1.5 flex flex-wrap gap-x-4 text-[10px] text-zinc-400">
                <span>{r.language}</span>
                <span>{r.fileCount} files</span>
                <span>{r.branchCount} branches</span>
                <span className="text-green-400">{r.openIssues} open issues</span>
                <span className="text-blue-400">{r.openPulls} open PRs</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && activeRepo && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => setActiveRepo(null)} className="text-cyan-400 hover:underline">← All repos</button>
            <span className="text-zinc-600">/</span>
            <span className="font-mono text-white">{activeRepo.name}</span>
          </div>

          <nav className="flex flex-wrap gap-1 border-b border-zinc-800">
            {([
              ['code', 'Code', Code],
              ['branches', 'Branches', GitBranch],
              ['issues', 'Issues', AlertCircle],
              ['pulls', 'Pull requests', GitPullRequest],
              ['actions', 'Actions', Play],
              ['security', 'Security', Shield],
              ['insights', 'Insights', BarChart3],
              ['analysis', 'Analysis', Activity],
              ['settings', 'Settings', Shield],
            ] as Array<[Tab, string, any]>).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs -mb-px border-b-2 transition-colors ${
                  tab === id ? 'border-orange-500 text-white' : 'border-transparent text-zinc-400 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </nav>

          {tab === 'code' && <CodeTab repoId={activeRepo.id} branch={currentBranch} onBranchChange={setCurrentBranch} />}
          {tab === 'branches' && (
            <BranchesTab
              repoId={activeRepo.id}
              onCheckout={(name) => { setCurrentBranch(name); setTab('code'); }}
            />
          )}
          {tab === 'issues' && <IssuesTab repoId={activeRepo.id} />}
          {tab === 'pulls' && <PullsTab repoId={activeRepo.id} />}
          {tab === 'actions' && <ActionsTab repoId={activeRepo.id} />}
          {tab === 'security' && <SecurityTab repoId={activeRepo.id} />}
          {tab === 'insights' && <InsightsTab repoId={activeRepo.id} />}
          {tab === 'analysis' && <AnalysisTab repoId={activeRepo.id} />}
          {tab === 'settings' && (
            <SettingsTab
              repo={activeRepo}
              onUpdated={(r) => { setActiveRepo(r); void loadRepos(); }}
              onDeleted={(name) => { setActiveRepo(null); setListNotice(`Deleted "${name}" — the repo and its history are gone.`); void loadRepos(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Code tab — file tree + viewer + editor ───────────────────────────
function CodeTab({ repoId, branch, onBranchChange }: {
  repoId: string;
  branch: string;
  onBranchChange: (b: string) => void;
}) {
  const [tree, setTree] = useState<TreeFileNode[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [file, setFile] = useState<FileContent | null>(null);
  const [editing, setEditing] = useState(false);
  const [isNewFile, setIsNewFile] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [draft, setDraft] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmEmptyArmed, setConfirmEmptyArmed] = useState(false);
  const [confirmDeleteArmed, setConfirmDeleteArmed] = useState(false);

  const loadTree = useCallback(async () => {
    const res = await runX<{ tree: TreeFileNode[] }>('file-tree', { repoId, branch });
    if (res.ok) { setTree(res.data?.tree || []); setErr(null); }
    else { setErr(res.error); }
  }, [repoId, branch]);

  const loadBranches = useCallback(async () => {
    const res = await runX<{ branches: BranchRow[] }>('branch-list', { repoId });
    if (res.ok) setBranches(res.data?.branches || []);
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTree(); loadBranches(); setFile(null); setEditing(false); setNotice(null); }, [repoId, branch]);

  const openFile = async (path: string) => {
    const res = await runX<FileContent>('file-read', { repoId, path, branch });
    if (res.ok && res.data) { setFile(res.data); setDraft(res.data.content); setEditing(false); setIsNewFile(false); setErr(null); }
    else { setErr(res.error); }
  };

  const startNewFile = () => {
    const path = newPath.trim();
    if (!path) return;
    setFile({ path, content: '', language: 'Text', lineCount: 0 });
    setDraft('');
    setCommitMsg(`Add ${path}`);
    setEditing(true);
    setIsNewFile(true);
    setErr(null);
    setNotice(null);
  };

  const saveFile = async () => {
    if (!file) return;
    setBusy(true);
    const r = await runX<{ branch: string; created: boolean; commit: { sha: string; additions: number; deletions: number } }>(
      'file-save',
      {
        repoId, branch, path: file.path, content: draft,
        // S6, live form (Review 2 re-pass, checkpoint 5d): send the
        // message EXACTLY as it stands in the box. The suggestion is
        // prefilled into the input when editing starts (visible,
        // editable, deletable) — an earlier build silently
        // substituted it for an emptied box here, which defeated the
        // server's empty-message guard: the user's blank committed
        // "successfully" under words they never typed. An emptied
        // box now reaches the server and its refusal surfaces below.
        message: commitMsg,
        ...(confirmEmptyArmed ? { confirmEmpty: true } : {}),
      },
    );
    setBusy(false);
    if (r.ok && r.data) {
      setNotice(`Committed ${r.data.commit.sha.slice(0, 7)} on ${r.data.branch} — ${file.path} (+${r.data.commit.additions} −${r.data.commit.deletions})`);
      setCommitMsg('');
      setEditing(false);
      setIsNewFile(false);
      setConfirmEmptyArmed(false);
      setErr(null);
      await openFile(file.path);
      await loadTree();
      await loadBranches();
    } else if (r.code === 'empty_content') {
      // S6: emptying a file is a choice the user makes out loud,
      // never a silence — arm the confirm and say what happens next.
      setConfirmEmptyArmed(true);
      setErr(`${r.error} Press Commit again to confirm — the commit will record that you emptied it deliberately.`);
    } else {
      setErr(r.error);
    }
  };

  const deleteFile = async () => {
    if (!file) return;
    if (!confirmDeleteArmed) { setConfirmDeleteArmed(true); return; }
    setBusy(true);
    const r = await runX<{ commit: { sha: string } }>('file-delete', { repoId, branch, path: file.path });
    setBusy(false);
    setConfirmDeleteArmed(false);
    if (r.ok && r.data) {
      setNotice(`Deleted ${file.path} on ${branch} — commit ${r.data.commit.sha.slice(0, 7)}. The file's history is still in the commit graph.`);
      setFile(null);
      setErr(null);
      await loadTree();
      await loadBranches();
    } else { setErr(r.error); }
  };

  // Ahead/behind of the checked-out branch vs the default branch —
  // the branch view header is one of the three canonical locations in
  // Review 2's ahead-counts residual. branch-list already supplies
  // both numbers (loaded above for the switcher).
  const branchInfo = branches.find((b) => b.name === branch);

  return (
    <div className="space-y-2">
      <ErrorBanner err={err} />
      {notice && (
        <p className="flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] text-green-300">
          <CheckCircle className="h-3 w-3 shrink-0" /> {notice}
        </p>
      )}
      {/* S1: the branch context is always visible, and switching it is
          one control — commits land on the branch named here. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
        <GitBranch className="h-3.5 w-3.5 text-cyan-400" />
        <span className="text-[11px] text-zinc-300">You are editing</span>
        <select
          value={branch}
          onChange={(e) => onBranchChange(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-white"
        >
          {branches.map((b) => (
            <option key={b.name} value={b.name}>{b.name}{b.isDefault ? ' (default)' : ''}</option>
          ))}
          {branches.length === 0 && <option value={branch}>{branch}</option>}
        </select>
        {branchInfo && !branchInfo.isDefault && branchInfo.ahead != null && (
          <span className="text-[10px] text-zinc-400">↑{branchInfo.ahead} ahead · ↓{branchInfo.behind ?? 0} behind the default branch</span>
        )}
        <span className="text-[10px] text-zinc-500">Commits go to this branch and no other.</span>
        <span className="ml-auto text-[10px] text-zinc-500">
          {branches.find((b) => b.name === branch)?.commits ?? '—'} commits on this branch
        </span>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-4 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
          <h3 className="mb-2 px-1 text-[10px] uppercase tracking-wider text-zinc-400">File tree · {branch}</h3>
          {tree.length === 0
            ? <p className="px-1 text-[11px] text-zinc-400">empty</p>
            : <TreeDiagram root={toTreeNodes(tree)} onSelect={(n) => openFile(n.id)} />}
          <div className="mt-3 border-t border-zinc-800/60 px-1 pt-2">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Add a file</p>
            <div className="flex gap-1">
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="src/new-file.ts"
                className="w-full min-w-0 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-white"
              />
              <button onClick={startNewFile} disabled={!newPath.trim()} className="shrink-0 rounded bg-green-600 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-50">New</button>
            </div>
            <p className="mt-1 text-[9px] text-zinc-600">Opens an editor; your first Commit creates the file on {branch}.</p>
          </div>
        </div>
        <div className="col-span-8 rounded-lg border border-zinc-800 bg-zinc-950">
          {!file ? (
            <div className="p-8 text-center text-xs text-zinc-400">
              <FileText className="mx-auto mb-2 h-8 w-8 text-zinc-700" />
              Select a file from the tree to view its source on {branch}.
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <span className="font-mono text-xs text-cyan-300">{file.path}{isNewFile && <span className="ml-2 rounded bg-green-500/15 px-1 text-[9px] text-green-300">new on {branch}</span>}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-400">{file.language} · {file.lineCount} lines</span>
                  {editing ? (
                    <>
                      <input
                        value={commitMsg}
                        onChange={(e) => setCommitMsg(e.target.value)}
                        placeholder="commit message"
                        className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white"
                      />
                      <button onClick={saveFile} disabled={busy} className="rounded bg-green-600 px-2 py-0.5 text-[10px] text-white disabled:opacity-50">
                        {busy ? 'Committing…' : confirmEmptyArmed ? 'Commit (confirm empty)' : 'Commit'}
                      </button>
                      <button onClick={() => { setEditing(false); setDraft(file.content); setConfirmEmptyArmed(false); }} className="text-[10px] text-zinc-400 hover:text-white">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setCommitMsg(`Update ${file.path}`); setEditing(true); }} className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">Edit</button>
                      {!isNewFile && (
                        <button
                          onClick={deleteFile}
                          disabled={busy}
                          className={`rounded border px-2 py-0.5 text-[10px] disabled:opacity-50 ${confirmDeleteArmed ? 'border-rose-500 bg-rose-600 text-white' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}
                        >
                          {confirmDeleteArmed ? `Confirm delete from ${branch}` : 'Delete'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {editing ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="h-72 w-full resize-none bg-[#0d1117] p-3 font-mono text-[11px] text-zinc-200 focus:outline-none"
                />
              ) : (
                <pre className="max-h-72 overflow-auto bg-[#0d1117] p-3 text-[11px] leading-5">
                  {file.content.split('\n').map((ln, i) => (
                    <div key={i} className="flex">
                      <span className="mr-3 inline-block w-8 select-none text-right text-zinc-700">{i + 1}</span>
                      <code className="text-zinc-200">{ln || ' '}</code>
                    </div>
                  ))}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Branches tab — branch + tag mgmt + commit graph ──────────────────
function BranchesTab({ repoId, onCheckout }: { repoId: string; onCheckout: (name: string) => void }) {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [graph, setGraph] = useState<TimelineEvent[]>([]);
  const [nodes, setNodes] = useState<CommitGraphNode[]>([]);
  const [commitDetail, setCommitDetail] = useState<{
    commit: { sha: string; message: string; author: string; branch: string; date: string };
    diff: { files: Array<{ path: string; status?: string; additions: number; deletions: number; hunks: DiffHunk[] }>; additions: number; deletions: number; fileCount: number } | null;
    diffUnavailable?: string;
  } | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [newTag, setNewTag] = useState('');
  // Tag receipts also render inside the Tags panel itself: the tab-top
  // banner alone was missed in the follow-up re-pass (tag delete read
  // as silent), so the outcome shows where the action happened.
  const [tagNote, setTagNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const b = await runX<{ branches: BranchRow[]; tags: TagRow[] }>('branch-list', { repoId });
    if (b.ok) { setBranches(b.data?.branches || []); setTags(b.data?.tags || []); }
    const g = await runX<{ nodes: CommitGraphNode[] }>('commit-graph', { repoId });
    if (g.ok) {
      setNodes(g.data?.nodes || []);
      setGraph((g.data?.nodes || []).map((n) => ({
        id: n.sha,
        label: `${n.message} · ${n.branch}`,
        time: n.date,
        tone: n.branch === 'main' ? 'good' : 'info',
        detail: `${n.sha} by ${n.author}`,
      })));
    }
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId]);

  const createBranch = async () => {
    if (!newBranch.trim()) return;
    setBusy('branch'); setErr(null);
    const r = await runX('branch-create', { repoId, name: newBranch.trim() });
    setBusy(null);
    if (r.ok) { setNewBranch(''); setNotice(`Branch "${newBranch.trim()}" created from the current tip — check it out in the Code view to work on it.`); await load(); } else { setErr(r.error); }
  };
  const createTag = async () => {
    if (!newTag.trim()) return;
    setBusy('tag'); setErr(null);
    const name = newTag.trim();
    const r = await runX('tag-create', { repoId, name });
    setBusy(null);
    if (r.ok) { setNewTag(''); setTagNote(`Tag "${name}" created at the current tip.`); setNotice(`Tag "${name}" created at the current tip.`); await load(); } else { setErr(r.error); }
  };
  const deleteBranch = async (name: string) => {
    setBusy(`del-branch-${name}`); setErr(null); setNotice(null);
    const r = await runX('branch-delete', { repoId, name });
    setBusy(null);
    if (r.ok) { setNotice(`Branch "${name}" deleted. Its commits stay in the history.`); await load(); } else { setErr(r.error); }
  };
  const deleteTag = async (name: string) => {
    setBusy(`del-tag-${name}`); setErr(null);
    const r = await runX('tag-delete', { repoId, name });
    setBusy(null);
    if (r.ok) { setTagNote(`Tag "${name}" deleted.`); setNotice(`Tag "${name}" deleted.`); await load(); } else { setErr(r.error); }
  };
  const openCommit = async (sha: string) => {
    const r = await runX('commit-detail', { repoId, sha });
    if (r.ok && r.data) { setCommitDetail(r.data as typeof commitDetail); setErr(null); }
    else { setErr(r.error); }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner err={err} />
      {notice && (
        <p className="flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] text-green-300">
          <CheckCircle className="h-3 w-3 shrink-0" /> {notice}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white">Branches</h3>
            <div className="flex gap-1">
              <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="branch" className="w-24 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white" />
              <button onClick={createBranch} disabled={busy === 'branch'} className="rounded bg-green-600 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-50">+</button>
            </div>
          </div>
          {branches.map((b) => (
            <div key={b.name} className="flex items-center justify-between gap-2 border-t border-zinc-800/60 py-1 text-[11px]">
              <span className="flex items-center gap-1.5 font-mono text-zinc-200">
                <GitBranch className="h-3 w-3 text-zinc-400" />{b.name}
                {b.isDefault && <span className="rounded bg-blue-500/15 px-1 text-[8px] text-blue-300">default</span>}
                {b.protected && <span className="rounded bg-amber-500/15 px-1 text-[8px] text-amber-300">protected</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-zinc-600">{b.commits} commits · {b.head}{!b.isDefault && b.ahead != null ? ` · ↑${b.ahead} ahead · ↓${b.behind ?? 0} behind` : ''}</span>
                <button onClick={() => onCheckout(b.name)} className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-300 hover:bg-zinc-800">Open in Code</button>
                {!b.isDefault && (
                  <button onClick={() => deleteBranch(b.name)} disabled={busy === `del-branch-${b.name}`} className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Delete</button>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white">Tags</h3>
            <div className="flex gap-1">
              <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="v1.0.0" className="w-24 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white" />
              <button onClick={createTag} disabled={busy === 'tag'} className="rounded bg-green-600 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-50">+</button>
            </div>
          </div>
          {tagNote && (
            <p className="mb-1 flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] text-green-300">
              <CheckCircle className="h-3 w-3 shrink-0" /> {tagNote}
            </p>
          )}
          {tags.length === 0 && <p className="text-[11px] text-zinc-400">No tags yet.</p>}
          {tags.map((t) => (
            <div key={t.name} className="flex items-center gap-1.5 border-t border-zinc-800/60 py-1 text-[11px]">
              <Tag className="h-3 w-3 text-zinc-400" />
              <span className="font-mono text-zinc-200">{t.name}</span>
              <span className="flex-1 text-zinc-600">{t.commit}</span>
              <button onClick={() => deleteTag(t.name)} disabled={busy === `del-tag-${t.name}`} className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Delete</button>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white">
          <GitCommit className="h-3.5 w-3.5" /> Commit history graph
        </h3>
        {graph.length === 0 ? <p className="text-[11px] text-zinc-400">No commits.</p> : <TimelineView events={graph} />}
        {nodes.length > 0 && (
          <div className="mt-3 border-t border-zinc-800/60 pt-2">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Commits — select one to see exactly what it changed</p>
            <div className="max-h-44 overflow-auto">
              {[...nodes].reverse().map((n) => (
                <button key={n.sha} onClick={() => openCommit(n.sha)} className="flex w-full items-center gap-2 border-t border-zinc-800/40 py-1 text-left text-[11px] first:border-0 hover:bg-zinc-900">
                  <span className="font-mono text-zinc-500">{n.sha.slice(0, 7)}</span>
                  <span className="flex-1 truncate text-zinc-200">{n.message}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{n.branch}</span>
                  <span className="text-[10px]"><span className="text-green-400">+{n.additions}</span> <span className="text-rose-400">−{n.deletions}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
        {commitDetail && (
          <div className="mt-3 rounded border border-zinc-800 bg-[#0d1117] p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold text-white">{commitDetail.commit.message}</p>
                <p className="text-[10px] text-zinc-500">{commitDetail.commit.sha} · {commitDetail.commit.branch} · {commitDetail.commit.author}</p>
              </div>
              <button onClick={() => setCommitDetail(null)} className="text-[10px] text-zinc-400 hover:text-white">close</button>
            </div>
            {commitDetail.diffUnavailable && (
              <p className="mt-2 text-[11px] text-amber-300">{commitDetail.diffUnavailable}</p>
            )}
            {commitDetail.diff && (
              <div className="mt-2 space-y-2">
                <p className="text-[10px] text-zinc-400">
                  {commitDetail.diff.fileCount} file{commitDetail.diff.fileCount === 1 ? '' : 's'} · <span className="text-green-400">+{commitDetail.diff.additions}</span> <span className="text-rose-400">−{commitDetail.diff.deletions}</span>
                </p>
                {commitDetail.diff.files.map((f) => (
                  <div key={f.path} className="rounded border border-zinc-800">
                    <div className="border-b border-zinc-800 px-2 py-1 font-mono text-[10px] text-cyan-300">
                      {f.path} <span className="text-zinc-500">{f.status}</span> <span className="text-green-400">+{f.additions}</span> <span className="text-rose-400">−{f.deletions}</span>
                    </div>
                    <pre className="max-h-40 overflow-auto p-2 text-[10px] leading-4">
                      {f.hunks.map((h, i) => (
                        <div key={i} className={h.type === 'add' ? 'text-green-400' : h.type === 'del' ? 'text-rose-400' : 'text-zinc-400'}>
                          {h.type === 'add' ? '+ ' : h.type === 'del' ? '- ' : '  '}{h.line}
                        </div>
                      ))}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Issues tab — full lifecycle ──────────────────────────────────────
function IssuesTab({ repoId }: { repoId: string }) {
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>('all');
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await runX<{ issues: IssueRow[] }>('issue-list', { repoId, state: stateFilter });
    if (r.ok) setIssues(r.data?.issues || []);
  }, [repoId, stateFilter]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId, stateFilter]);

  const openDetail = async (number: number) => {
    const r = await runX<{ issue: IssueDetail }>('issue-detail', { repoId, number });
    if (r.ok && r.data) { setDetail(r.data.issue); setErr(null); } else { setErr(r.error); }
  };
  const createIssue = async () => {
    if (!newTitle.trim()) return;
    setBusy('create'); setErr(null);
    const r = await runX('issue-create', { repoId, title: newTitle.trim(), body: newBody });
    setBusy(null);
    if (r.ok) { setNewTitle(''); setNewBody(''); await load(); } else { setErr(r.error); }
  };
  const addComment = async () => {
    if (!detail || !comment.trim()) return;
    setBusy('comment'); setErr(null);
    const r = await runX('issue-comment', { repoId, number: detail.number, body: comment.trim() });
    setBusy(null);
    if (r.ok) { setComment(''); await openDetail(detail.number); } else { setErr(r.error); }
  };
  const toggleState = async () => {
    if (!detail) return;
    setBusy('state'); setErr(null);
    const r = await runX('issue-set-state', { repoId, number: detail.number, state: detail.state === 'open' ? 'closed' : 'open' });
    setBusy(null);
    if (r.ok) { await openDetail(detail.number); await load(); } else { setErr(r.error); }
  };

  if (detail) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <button onClick={() => setDetail(null)} className="mb-2 text-xs text-cyan-400 hover:underline">← All issues</button>
        <ErrorBanner err={err} />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">#{detail.number} {detail.title}</h3>
            <p className="mt-0.5 text-[10px] text-zinc-400">opened by {detail.author}</p>
          </div>
          <button onClick={toggleState} disabled={busy === 'state'} className={`rounded px-2 py-1 text-[10px] ${detail.state === 'open' ? 'bg-purple-600' : 'bg-green-600'} text-white disabled:opacity-50`}>
            {detail.state === 'open' ? 'Close issue' : 'Reopen'}
          </button>
        </div>
        {detail.body && <p className="mt-2 rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px] text-zinc-300">{detail.body}</p>}
        {detail.linkedPulls && detail.linkedPulls.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="text-zinc-500">Linked pull requests:</span>
            {detail.linkedPulls.map((p) => (
              <span key={p.number} className={`rounded border px-1.5 py-0.5 ${p.state === 'merged' ? 'border-purple-500/40 text-purple-300' : 'border-zinc-700 text-zinc-300'}`}>
                #{p.number} {p.title} · {p.state}
              </span>
            ))}
            <span className="text-zinc-600">Merging a linked pull request closes this issue.</span>
          </div>
        )}
        <div className="mt-3 space-y-2">
          {detail.comments.map((c) => (
            <div key={c.id} className="rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px]">
              <p className="text-zinc-400">{c.author}</p>
              <p className="mt-0.5 text-zinc-200">{c.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
          <button onClick={addComment} disabled={busy === 'comment' || !comment.trim()} className="rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">Comment</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ErrorBanner err={err} />
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="mb-2 text-xs font-semibold text-white">New issue</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Issue title" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
          <input value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Description (optional)" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
          <button onClick={createIssue} disabled={busy === 'create' || !newTitle.trim()} className="rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">Create</button>
        </div>
      </div>
      <div className="flex gap-1">
        {(['all', 'open', 'closed'] as const).map((s) => (
          <button key={s} onClick={() => setStateFilter(s)} className={`rounded px-2 py-0.5 text-[10px] ${stateFilter === s ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>{s}</button>
        ))}
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {issues.length === 0 && <p className="p-4 text-center text-[11px] text-zinc-400">No issues.</p>}
        {issues.map((i) => (
          <button key={i.number} onClick={() => openDetail(i.number)} className="flex w-full items-center gap-2 border-b border-zinc-800/60 px-3 py-2 text-left text-[11px] last:border-0 hover:bg-zinc-900">
            {i.state === 'open' ? <AlertCircle className="h-3.5 w-3.5 text-green-500" /> : <CheckCircle className="h-3.5 w-3.5 text-purple-500" />}
            <span className="flex-1 text-zinc-200">{i.title}</span>
            <span className="text-zinc-600">#{i.number} · {i.comments} comments</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Pulls tab — diff / review / merge ────────────────────────────────
function PullsTab({ repoId }: { repoId: string }) {
  const [pulls, setPulls] = useState<PullRow[]>([]);
  const [detail, setDetail] = useState<PullDetail | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [openIssues, setOpenIssues] = useState<IssueRow[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [headBranch, setHeadBranch] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [lineDraft, setLineDraft] = useState<{ path: string; line: number } | null>(null);
  const [lineBody, setLineBody] = useState('');
  const [linkIssue, setLinkIssue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await runX<{ pulls: PullRow[] }>('pull-list', { repoId, state: 'all' });
    if (r.ok) setPulls(r.data?.pulls || []);
    const b = await runX<{ branches: Array<{ name: string }> }>('branch-list', { repoId });
    if (b.ok) setBranches((b.data?.branches || []).map((x) => x.name));
    const i = await runX<{ issues: IssueRow[] }>('issue-list', { repoId, state: 'open' });
    if (i.ok) setOpenIssues(i.data?.issues || []);
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId]);

  const openDetail = async (number: number) => {
    const r = await runX<PullDetail>('pull-detail', { repoId, number });
    if (r.ok && r.data) { setDetail(r.data); setErr(null); } else { setErr(r.error); }
  };
  const createPull = async () => {
    if (!newTitle.trim() || !headBranch) { setErr('Title and head branch are both required.'); return; }
    setBusy('create'); setErr(null); setNotice(null);
    const r = await runX<{ pull: { number: number; head: string; base: string } }>('pull-create', { repoId, title: newTitle.trim(), head: headBranch });
    setBusy(null);
    if (r.ok && r.data) {
      setNotice(`Pull request #${r.data.pull.number} opened — ${r.data.pull.head} → ${r.data.pull.base}.`);
      setNewTitle(''); setHeadBranch('');
      await load();
    } else { setErr(r.error || 'pull-create failed'); }
  };
  const submitReview = async (verdict: string) => {
    if (!detail) return;
    setBusy('review'); setErr(null);
    const r = await runX('pull-review', { repoId, number: detail.pull.number, verdict, body: reviewBody });
    setBusy(null);
    if (r.ok) {
      setReviewBody('');
      setNotice(verdict === 'approve'
        ? 'Review recorded — you approved this pull request.'
        : verdict === 'request-changes'
          ? 'Review recorded — changes requested on this pull request.'
          : 'Review recorded — comment posted as a review.');
      await openDetail(detail.pull.number);
    } else { setErr(r.error); }
  };
  const merge = async () => {
    if (!detail) return;
    setBusy('merge'); setErr(null); setNotice(null);
    const r = await runX<{ mergeCommit: string; filesChanged: number; additions: number; deletions: number; closedIssues: number[] }>(
      'pull-merge', { repoId, number: detail.pull.number },
    );
    setBusy(null);
    if (r.ok && r.data) {
      setNotice(
        `Merged into ${detail.pull.base} as commit ${r.data.mergeCommit.slice(0, 7)} — ${r.data.filesChanged} file${r.data.filesChanged === 1 ? '' : 's'}, +${r.data.additions} −${r.data.deletions}` +
        (r.data.closedIssues.length ? `; closed linked issue${r.data.closedIssues.length === 1 ? '' : 's'} ${r.data.closedIssues.map((n) => `#${n}`).join(', ')}` : '') + '.',
      );
      await openDetail(detail.pull.number);
      await load();
    } else { setErr(r.error || 'merge failed'); }
  };
  const postComment = async () => {
    if (!detail || !commentBody.trim()) return;
    setBusy('comment'); setErr(null);
    const r = await runX('pull-comment', { repoId, number: detail.pull.number, body: commentBody.trim() });
    setBusy(null);
    if (r.ok) { setCommentBody(''); await openDetail(detail.pull.number); } else { setErr(r.error); }
  };
  const postLineComment = async () => {
    if (!detail || !lineDraft || !lineBody.trim()) return;
    setBusy('line-comment'); setErr(null);
    const r = await runX('pull-comment', { repoId, number: detail.pull.number, body: lineBody.trim(), path: lineDraft.path, line: lineDraft.line });
    setBusy(null);
    if (r.ok) { setLineBody(''); setLineDraft(null); await openDetail(detail.pull.number); } else { setErr(r.error); }
  };
  const setIssueLink = async (issueNumber: number, unlink: boolean) => {
    if (!detail) return;
    setBusy('link'); setErr(null);
    const r = await runX('pull-link-issue', { repoId, number: detail.pull.number, issueNumber, ...(unlink ? { unlink: true } : {}) });
    setBusy(null);
    if (r.ok) { setLinkIssue(''); await openDetail(detail.pull.number); } else { setErr(r.error); }
  };

  if (detail) {
    const conflicts = detail.conflicts || [];
    const lineCommentsFor = (path: string, line: number) =>
      (detail.comments || []).filter((c) => c.path === path && c.line === line);
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <button onClick={() => setDetail(null)} className="mb-2 text-xs text-cyan-400 hover:underline">← All pull requests</button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              #{detail.pull.number} {detail.pull.title}
              {/* S10: the merged state gets a visual identity, not a lowercase word (F14). */}
              {detail.pull.state === 'merged' && <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">Merged</span>}
              {detail.pull.state === 'open' && <span className="rounded-full bg-green-600 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">Open</span>}
              {detail.pull.state === 'closed' && <span className="rounded-full bg-zinc-600 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">Closed</span>}
            </h3>
            <p className="mt-0.5 text-[10px] text-zinc-400">
              <span className="font-mono">{detail.pull.head}</span> → <span className="font-mono">{detail.pull.base}</span> · opened by {detail.pull.author}
              {detail.ahead != null && <> · {detail.ahead} ahead · {detail.behind ?? 0} behind</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-green-400">{detail.approvals} approvals</span>
            <span className="text-[10px] text-rose-400">{detail.changesRequested} changes req.</span>
            {detail.pull.state === 'open' && (
              <button onClick={merge} disabled={busy === 'merge' || !detail.mergeable} className="rounded bg-purple-600 px-2 py-1 text-[10px] text-white disabled:opacity-40">
                {busy === 'merge' ? 'Merging…' : 'Merge'}
              </button>
            )}
          </div>
        </div>
        {detail.pull.state === 'open' && (
          <p className="mt-1.5 text-[10px] text-zinc-500">
            {conflicts.length > 0
              ? 'Merge is blocked by the conflicting lines below.'
              : detail.changesRequested > 0
                ? 'Merge is blocked: changes were requested. A fresh approving review is the way through.'
                : 'Merging first checks the lines each branch changed since the branch point; lines both sides changed block the merge with an explanation.'}
          </p>
        )}
        {err && <p className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">{err}</p>}
        {notice && (
          <p className="mt-2 flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] text-green-300">
            <CheckCircle className="h-3 w-3 shrink-0" /> {notice}
          </p>
        )}
        {conflicts.length > 0 && (
          <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-2.5">
            <p className="text-[11px] font-semibold text-amber-300">This merge is blocked — both branches changed the same content</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200/90">
              {conflicts.map((c) => (
                <li key={c.path} className="font-mono">
                  {c.path}
                  {c.lines ? ` — line${c.lines.length > 1 ? 's' : ''} ${c.lines.join(', ')}` : ` — ${c.reason || 'changed on both sides'}`}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px] text-amber-200/70">
              Concord compared the lines each side changed since the branch point. Where they overlap, a person has to
              decide — edit one branch until the same lines no longer disagree, then merge. Nothing was merged.
            </p>
          </div>
        )}
        {/* Linked issues (S10) */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="text-zinc-500">Linked issues:</span>
          {(detail.pull.linkedIssues || []).map((n) => {
            const iss = openIssues.find((i) => i.number === n);
            return (
              <span key={n} className="flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300">
                #{n}{iss ? ` ${iss.title}` : ''}
                {detail.pull.state === 'open' && (
                  <button onClick={() => setIssueLink(n, true)} disabled={busy === 'link'} className="text-zinc-500 hover:text-rose-300" title="Unlink">×</button>
                )}
              </span>
            );
          })}
          {(detail.pull.linkedIssues || []).length === 0 && <span className="text-zinc-600">none — link one and merging this PR will close it</span>}
          {detail.pull.state === 'open' && (
            <span className="ml-1 flex items-center gap-1">
              <select value={linkIssue} onChange={(e) => setLinkIssue(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-[10px] text-white">
                <option value="">link an issue…</option>
                {openIssues.filter((i) => !(detail.pull.linkedIssues || []).includes(i.number)).map((i) => (
                  <option key={i.number} value={i.number}>#{i.number} {i.title}</option>
                ))}
              </select>
              <button onClick={() => linkIssue && setIssueLink(Number(linkIssue), false)} disabled={busy === 'link' || !linkIssue} className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-white disabled:opacity-50">Link</button>
            </span>
          )}
        </div>
        <div className="mt-3">
          <h4 className="text-[10px] uppercase tracking-wider text-zinc-400">
            {detail.diff
              ? <>Diff · <span className="text-green-400">+{detail.diff.additions}</span> <span className="text-rose-400">−{detail.diff.deletions}</span> across {detail.diff.fileCount} file{detail.diff.fileCount === 1 ? '' : 's'}</>
              : 'Diff'}
          </h4>
          {detail.diffUnavailable && (
            <p className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">{detail.diffUnavailable}</p>
          )}
          {detail.diff && detail.diff.fileCount === 0 && (
            <p className="mt-1.5 text-[11px] text-zinc-400">No file changes relative to the branch point.</p>
          )}
          <div className="mt-1.5 space-y-2">
            {(detail.diff?.files || []).map((f) => (
              <div key={f.path} className="rounded border border-zinc-800 bg-[#0d1117]">
                <div className="border-b border-zinc-800 px-2 py-1 font-mono text-[10px] text-cyan-300">
                  {f.path} {f.status && <span className="text-zinc-500">{f.status}</span>} <span className="text-green-400">+{f.additions}</span> <span className="text-rose-400">−{f.deletions}</span>
                </div>
                <div className="max-h-56 overflow-auto p-2 font-mono text-[10px] leading-4">
                  {f.hunks.map((h, i) => (
                    <div key={i}>
                      <div className={`flex items-baseline gap-2 ${h.type === 'add' ? 'text-green-400' : h.type === 'del' ? 'text-rose-400' : 'text-zinc-400'}`}>
                        <span className="w-8 shrink-0 select-none text-right text-zinc-700">{h.oldLine ?? ''}</span>
                        <span className="w-8 shrink-0 select-none text-right text-zinc-700">{h.newLine ?? ''}</span>
                        <span className="w-3 shrink-0 select-none">{h.type === 'add' ? '+' : h.type === 'del' ? '−' : ' '}</span>
                        <span className="flex-1 whitespace-pre-wrap">{h.line}</span>
                        {detail.pull.state === 'open' && h.newLine != null && (
                          <button
                            onClick={() => { setLineDraft({ path: f.path, line: h.newLine as number }); setLineBody(''); }}
                            className="shrink-0 rounded border border-zinc-700 px-1 text-[9px] text-zinc-400 hover:bg-zinc-800 hover:text-white"
                            title={`Comment on ${f.path}:${h.newLine}`}
                          >
                            comment
                          </button>
                        )}
                      </div>
                      {h.newLine != null && lineCommentsFor(f.path, h.newLine).map((c) => (
                        <div key={c.id} className="ml-24 rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-[10px] text-zinc-300">
                          <span className="text-cyan-300">{c.author}</span> · {c.body}
                        </div>
                      ))}
                      {lineDraft && lineDraft.path === f.path && lineDraft.line === h.newLine && (
                        <div className="ml-24 mt-1 flex gap-1">
                          <input
                            value={lineBody}
                            onChange={(e) => setLineBody(e.target.value)}
                            placeholder={`Comment on ${f.path}:${lineDraft.line}…`}
                            className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-white"
                          />
                          <button onClick={postLineComment} disabled={busy === 'line-comment' || !lineBody.trim()} className="rounded bg-cyan-600 px-2 py-1 text-[10px] text-white disabled:opacity-50">Post</button>
                          <button onClick={() => setLineDraft(null)} className="text-[10px] text-zinc-400 hover:text-white">Cancel</button>
                        </div>
                      )}
                    </div>
                  ))}
                  {f.hunksTruncated && <div className="text-zinc-600">… diff truncated at 200 lines for this file; the counts above are complete.</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Discussion: reviews + general comments */}
        <div className="mt-3 space-y-1.5">
          {detail.reviews.map((rv) => (
            <div key={rv.id} className="rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px]">
              <span className={rv.verdict === 'approve' ? 'text-green-400' : rv.verdict === 'request-changes' ? 'text-rose-400' : 'text-zinc-400'}>
                {rv.reviewer} · {rv.verdict}
                {/* F11 honesty: an approval by the author is labelled as one. */}
                {rv.verdict === 'approve' && rv.reviewer === detail.pull.author && (
                  <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">approved by the author</span>
                )}
              </span>
              {rv.body && <p className="mt-0.5 text-zinc-300">{rv.body}</p>}
            </div>
          ))}
          {(detail.comments || []).filter((c) => !c.path).map((c) => (
            <div key={c.id} className="rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px]">
              <span className="text-zinc-400">{c.author} · comment</span>
              <p className="mt-0.5 text-zinc-200">{c.body}</p>
            </div>
          ))}
        </div>
        {detail.pull.state === 'open' && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <input value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder="Add a comment…" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
              <button onClick={postComment} disabled={busy === 'comment' || !commentBody.trim()} className="rounded bg-zinc-700 px-2 py-1 text-[10px] text-white disabled:opacity-50">Comment</button>
            </div>
            <input value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} placeholder="Review summary (optional)…" className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
            <div className="flex gap-2">
              <button onClick={() => submitReview('approve')} disabled={busy === 'review'} className="rounded bg-green-600 px-2 py-1 text-[10px] text-white disabled:opacity-50">Approve</button>
              <button onClick={() => submitReview('request-changes')} disabled={busy === 'review'} className="rounded bg-rose-600 px-2 py-1 text-[10px] text-white disabled:opacity-50">Request changes</button>
              <button onClick={() => submitReview('comment')} disabled={busy === 'review'} className="rounded bg-zinc-700 px-2 py-1 text-[10px] text-white disabled:opacity-50">Comment as review</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notice && (
        <p className="flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] text-green-300">
          <CheckCircle className="h-3 w-3 shrink-0" /> {notice}
        </p>
      )}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="mb-2 text-xs font-semibold text-white">Open a pull request</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="PR title" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
          <select value={headBranch} onChange={(e) => setHeadBranch(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white">
            <option value="">head branch…</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button onClick={createPull} disabled={busy === 'create'} className="rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">Create PR</button>
        </div>
        {err && <p className="mt-1.5 text-[10px] text-rose-400">{err}</p>}
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {pulls.length === 0 && <p className="p-4 text-center text-[11px] text-zinc-400">No pull requests. Create a branch, edit a file on it, then open a PR.</p>}
        {pulls.map((p) => (
          <button key={p.number} onClick={() => openDetail(p.number)} className="flex w-full items-center gap-2 border-b border-zinc-800/60 px-3 py-2 text-left text-[11px] last:border-0 hover:bg-zinc-900">
            <GitPullRequest className={`h-3.5 w-3.5 ${p.state === 'merged' ? 'text-purple-500' : p.state === 'open' ? 'text-green-500' : 'text-zinc-400'}`} />
            <span className="flex-1 text-zinc-200">{p.title}</span>
            {p.state === 'merged' && <span className="rounded-full bg-purple-600 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white">Merged</span>}
            {p.state === 'open' && <span className="rounded-full bg-green-600/80 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white">Open</span>}
            <span className="font-mono text-zinc-600">{p.head}→{p.base}</span>
            <span className="text-zinc-600">#{p.number} · {p.reviews} reviews</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Actions tab — CI runs + logs ─────────────────────────────────────
function ActionsTab({ repoId }: { repoId: string }) {
  const [runs, setRuns] = useState<WorkflowRow[]>([]);
  const [logs, setLogs] = useState<{ number: number; steps: WorkflowStep[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await runX<{ runs: WorkflowRow[] }>('workflow-runs', { repoId });
    if (r.ok) setRuns(r.data?.runs || []);
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId]);

  const triggerRun = async () => {
    setBusy(true); setErr(null);
    const r = await runX('workflow-run', { repoId, workflow: 'Static checks' });
    setBusy(false);
    if (r.ok) await load(); else setErr(r.error);
  };
  const openLogs = async (runId: string) => {
    const r = await runX<{ number: number; steps: WorkflowStep[] }>('workflow-logs', { repoId, runId });
    if (r.ok && r.data) { setLogs(r.data); setErr(null); } else { setErr(r.error); }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner err={err} />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">Workflow runs</h3>
        <button onClick={triggerRun} disabled={busy} className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run checks
        </button>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {runs.length === 0 && <p className="p-4 text-center text-[11px] text-zinc-400">No runs yet. Run checks above — JSON, syntax and security rules run on the stored files; tests and builds are skipped (no runner attached).</p>}
        {runs.map((r) => (
          <button key={r.id} onClick={() => openLogs(r.id)} className="flex w-full items-center gap-2 border-b border-zinc-800/60 px-3 py-2 text-left text-[11px] last:border-0 hover:bg-zinc-900">
            {r.conclusion === 'success'
              ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              : <X className="h-3.5 w-3.5 text-rose-500" />}
            <span className="flex-1 text-zinc-200">{r.workflow} #{r.number}</span>
            <span className="font-mono text-zinc-600">{r.branch}</span>
            <span className="text-zinc-600">{r.durationMs >= 1000 ? `${(r.durationMs / 1000).toFixed(1)}s` : `${Math.round(r.durationMs)}ms`}</span>
          </button>
        ))}
      </div>
      {logs && (
        <div className="rounded-lg border border-zinc-800 bg-[#0d1117] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-white">Run #{logs.number} logs</h4>
            <button onClick={() => setLogs(null)} className="text-[10px] text-zinc-400 hover:text-white">close</button>
          </div>
          {logs.steps.map((st, i) => (
            <div key={i} className="mb-2">
              <p className={`text-[11px] font-semibold ${st.conclusion === 'success' ? 'text-green-400' : st.conclusion === 'failure' ? 'text-rose-400' : 'text-zinc-400'}`}>
                {st.conclusion === 'success' ? '✓' : st.conclusion === 'failure' ? '✗' : '○'} {st.name} ({st.durationMs >= 1000 ? `${(st.durationMs / 1000).toFixed(1)}s` : `${Math.round(st.durationMs)}ms`})
              </p>
              <pre className="ml-3 text-[10px] text-zinc-400">{st.logs.join('\n')}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Security tab — dependency alerts (OSV.dev) + code scanning ──────
function SecurityTab({ repoId }: { repoId: string }) {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [bySeverity, setBySeverity] = useState<Record<string, number>>({});
  const [depSource, setDepSource] = useState<string | null>(null);
  const [depUnreachable, setDepUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scan = async () => {
    setBusy(true); setErr(null);
    const r = await runX<{ alerts: SecurityAlert[]; bySeverity: Record<string, number>; dependencySource?: string; dependencyScanUnreachable?: boolean }>('security-scan', { repoId });
    setBusy(false);
    if (r.ok) {
      setAlerts(r.data?.alerts || []);
      setBySeverity(r.data?.bySeverity || {});
      setDepSource(r.data?.dependencySource || null);
      setDepUnreachable(!!r.data?.dependencyScanUnreachable);
      setScanned(true);
    }
    else { setErr(r.error); }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner err={err} />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">Security overview</h3>
        <button onClick={scan} disabled={busy} className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />} Run scan
        </button>
      </div>
      {scanned && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {(['critical', 'high', 'moderate', 'low'] as const).map((s) => (
            <div key={s} className={`rounded border px-2 py-1.5 text-center ${SEV_COLOR[s]}`}>
              <div className="font-mono text-lg">{bySeverity[s] || 0}</div>
              <div className="text-[9px] uppercase">{s}</div>
            </div>
          ))}
        </div>
      )}
      {scanned && (
        <p className="text-[10px] text-zinc-500">
          {/* S8: provenance, named — every dependency alert below carries its advisory ID. */}
          Dependency alerts are queried live from <span className="text-zinc-300">{depSource === 'osv.dev' ? 'OSV.dev' : depSource || 'the vulnerability database'}</span> against this repo&apos;s package.json at scan time
          {depUnreachable && <span className="text-amber-300"> — the database was unreachable for this scan, so dependency results are incomplete; code scanning below is unaffected</span>}.
          Code scanning runs Concord&apos;s own rules over this repo&apos;s files.
        </p>
      )}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {!scanned && <p className="p-4 text-center text-[11px] text-zinc-400">Run a scan to see dependency alerts (from OSV.dev, with advisory IDs) and code scanning results (Concord&apos;s rules over this repo&apos;s files).</p>}
        {scanned && alerts.length === 0 && <p className="p-4 text-center text-[11px] text-green-400">No security alerts. Clean.</p>}
        {alerts.map((a, i) => (
          <div key={i} className="flex items-start gap-2 border-b border-zinc-800/60 px-3 py-2 text-[11px] last:border-0">
            <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${SEV_COLOR[a.severity]}`}>{a.severity}</span>
            <div className="flex-1">
              {a.kind === 'dependency' ? (
                <>
                  <p className="text-zinc-200">{a.package}@{a.version} — {a.summary}</p>
                  <p className="text-[10px] text-zinc-400">
                    {a.osvId && <span className="font-mono text-cyan-300">{a.osvId}</span>}
                    {a.osvId && ' · '}Source: OSV.dev{a.fixedIn ? ` · fixed in ${a.fixedIn}` : ' · no fixed version published'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-zinc-200">{a.message}</p>
                  <p className="font-mono text-[10px] text-zinc-400">{a.path}:{a.line} · {a.rule} · code scanning (Concord rules)</p>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Insights tab — contributors / activity / languages ───────────────
function InsightsTab({ repoId }: { repoId: string }) {
  const [data, setData] = useState<{
    contributors: Array<{ author: string; commits: number; additions: number; deletions: number }>;
    commitActivity: Array<{ week: string; commits: number; additions: number; deletions: number }>;
    languages: Array<{ language: string; bytes: number; percent: number }>;
    totals: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await runX<any>('repo-insights', { repoId });
    if (r.ok) { setData(r.data); setErr(null); } else { setData(null); setErr(r.error); }
    setLoading(false);
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId]);

  if (loading) return <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading insights…</div>;
  if (!data) return <div className="space-y-2"><ErrorBanner err={err} /><p className="text-[11px] text-zinc-400">No insight data.</p></div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Object.entries(data.totals).map(([k, v]) => (
          <div key={k} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
            <div className="font-mono text-base text-cyan-300">{v}</div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-400">{k.replace(/([A-Z])/g, ' $1')}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="mb-2 text-xs font-semibold text-white">Commit activity (12 weeks)</h3>
        <ChartKit
          kind="bar"
          data={data.commitActivity}
          xKey="week"
          series={[
            { key: 'commits', label: 'Commits', color: '#06b6d4' },
            { key: 'additions', label: 'Additions', color: '#22c55e' },
          ]}
          height={180}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="mb-2 text-xs font-semibold text-white">Contributors</h3>
          {data.contributors.map((c) => (
            <div key={c.author} className="flex items-center justify-between border-t border-zinc-800/60 py-1 text-[11px] first:border-0">
              <span className="text-zinc-200">{c.author}</span>
              <span className="text-zinc-400">{c.commits} commits · <span className="text-green-400">+{c.additions}</span> <span className="text-rose-400">-{c.deletions}</span></span>
            </div>
          ))}
          {/* E-RP-1: staged on this panel's own verified numbers — it
              shows only while the contributor count is exactly one. */}
          {data.contributors.length === 1 && (
            <p className="mt-2 font-serif text-[11px] italic text-zinc-500">
              A one-person codebase. Every line is yours — for better or worse.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="mb-2 text-xs font-semibold text-white">Languages</h3>
          {data.languages.map((l) => (
            <div key={l.language} className="mb-1.5">
              <div className="flex justify-between text-[10px] text-zinc-400">
                <span>{l.language}</span><span>{l.percent}%</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded bg-zinc-800">
                <div className="h-1.5 rounded bg-cyan-500" style={{ width: `${l.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Settings tab — rename / description / visibility / delete (S5) ──
function SettingsTab({ repo, onUpdated, onDeleted }: {
  repo: RepoSummary;
  onUpdated: (r: RepoSummary) => void;
  onDeleted: (name: string) => void;
}) {
  const [name, setName] = useState(repo.name);
  const [description, setDescription] = useState(repo.description || '');
  const [isPrivate, setIsPrivate] = useState(!!repo.isPrivate);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    setBusy('save'); setErr(null); setNotice(null);
    const r = await runX<{ repo: { id: string; name: string; description: string; isPrivate: boolean } }>(
      'repo-update', { repoId: repo.id, name: name.trim(), description, isPrivate },
    );
    setBusy(null);
    if (r.ok && r.data) {
      onUpdated({ ...repo, name: r.data.repo.name, description: r.data.repo.description, isPrivate: r.data.repo.isPrivate });
      setNotice(`Saved — this repo is now "${r.data.repo.name}", ${r.data.repo.isPrivate ? 'private' : 'public'} in your account.`);
    } else { setErr(r.error); }
  };

  const del = async () => {
    setBusy('delete'); setErr(null);
    const r = await runX('repo-delete', { repoId: repo.id, confirmName });
    setBusy(null);
    if (r.ok) { onDeleted(repo.name); } else { setErr(r.error); }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner err={err} />
      {notice && (
        <p className="flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] text-green-300">
          <CheckCircle className="h-3 w-3 shrink-0" /> {notice}
        </p>
      )}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
        <h3 className="text-xs font-semibold text-white">General</h3>
        <label className="block text-[10px] text-zinc-400">Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
        </label>
        <label className="block text-[10px] text-zinc-400">Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this repo?" className="mt-0.5 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-zinc-300">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Private — visible only in your account
          <span className="text-[10px] text-zinc-500">(sharing with other accounts rides Concord&apos;s platform access grants, not a per-repo switch)</span>
        </label>
        <button onClick={save} disabled={busy === 'save' || !name.trim()} className="rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">
          {busy === 'save' ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-2">
        <h3 className="text-xs font-semibold text-rose-300">Delete this repo</h3>
        <p className="text-[11px] text-zinc-400">
          Deletes the repo, its branches, commits, issues and pull requests from your account. There is no undo.
          Type the repo name to confirm — the server checks it too.
        </p>
        <div className="flex gap-2">
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={repo.name}
            className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-white"
          />
          <button
            onClick={del}
            disabled={busy === 'delete' || confirmName !== repo.name}
            className="rounded bg-rose-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete repo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Analysis tab — code complexity / commit patterns / dependency audit
// over THIS repo's real files, real commit history, and real package.json.
// Wires the three `repos.codeComplexity` / `commitAnalysis` /
// `dependencyAudit` engines (server/domains/repos.js) that previously had
// no real caller — the old page-level panel gated them behind a generic
// lens-artifact system that never had a "repo" artifact to run against, so
// the buttons were permanently disabled.
//
// Complexity is a REAL AST analysis: this tab sends each real file's real
// source text (`sourceFiles`) to `repos.codeComplexity`, which walks it with
// the `typescript` compiler package (server/lib/code-ast-complexity.js) —
// real per-function boundaries, real branch/loop/condition/nesting counts
// from the actual syntax tree. The previous version of this tab computed
// those counts itself via regex decision-point matching over raw text and
// folded each whole file into one synthetic "function" — that heuristic
// is gone; the server now does the honest parse.
const COMPLEXITY_FILE_CAP = 40;
const AST_ANALYZABLE_RE = /\.(jsx?|tsx?|mjs|cjs|mts|cts)$/i;

interface ComplexityResult {
  message?: string;
  totalModules: number; totalFunctions: number; totalLines: number;
  overallAvgComplexity: number; healthScore: number; maxDependencyDepth: number;
  riskDistribution: { critical: number; high: number; moderate: number; low: number };
  hotspots: Array<{ name: string; module?: string; cyclomaticComplexity: number; risk: string }>;
}
interface CommitAnalysisResult {
  message?: string;
  totalCommits: number; busFactor: number; busFactorRisk: string;
  frequency: { commitsPerDay: number; commitsPerWeek: number; peakDay: string; peakHour: number };
  authors: Array<{ name: string; commits: number; commitShare: number }>;
  hotspots: Array<{ file: string; changes: number; authors: number }>;
  commitTypes: Array<{ type: string; count: number; percentage: number }>;
}
interface DependencyAuditResult {
  message?: string;
  totalDependencies: number; healthScore: number; healthGrade: string;
  depth: { max: number; avgDepth: number };
  duplicates: { versionConflicts: number };
  // total/affectedDeps are null when the live OSV check was requested
  // but unreachable — unknown, never a printed 0 (re-pass checkpoint 3).
  vulnerabilities: { total: number | null; affectedDeps: number | null; source?: string; checked?: boolean; unreachable?: boolean };
  dependencyList?: Array<{ name: string; version: string; vulnerabilities: number | null; advisories: string[] }>;
  freshness: { avgScore: number; criticalUpdates: number; stalePackages: number };
  licenses: { risks: Array<{ license: string; count: number }> };
}

function AnalysisTab({ repoId }: { repoId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ranOnce, setRanOnce] = useState(false);
  const [filesCapped, setFilesCapped] = useState(false);
  const [complexity, setComplexity] = useState<ComplexityResult | null>(null);
  const [cxError, setCxError] = useState<string | null>(null);
  const [cxMeta, setCxMeta] = useState<{ matched: number; unreadable: number }>({ matched: 0, unreadable: 0 });
  const [commits, setCommits] = useState<CommitAnalysisResult | null>(null);
  const [deps, setDeps] = useState<DependencyAuditResult | null>(null);
  // Why the dependency card has nothing to audit, when it doesn't:
  // "missing" (no package.json in this repo), "empty" (package.json
  // exists but declares no dependencies), "unreadable" (the file exists
  // but couldn't be read or parsed). The three read differently to the
  // user — folding them into one "No package.json (or no dependencies)"
  // line implied a missing file that exists (Review F6 framing nit).
  const [depsNote, setDepsNote] = useState<null | "missing" | "empty" | "unreadable">(null);

  const runAnalysis = async () => {
    setBusy(true); setErr(null);
    try {
      // 1) Code complexity — real AST analysis over this repo's own files.
      // Only JS/TS-family files are analyzable (the `typescript` compiler
      // parses .js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts); other real files
      // (README, JSON, CSS, …) are excluded up front rather than wastefully
      // round-tripped and AST-parsed into a meaningless near-empty record.
      const treeRes = await runX<{ tree: TreeFileNode[] }>('file-tree', { repoId });
      if (!treeRes.ok) throw new Error(treeRes.error || 'file-tree failed');
      const allFiles = flattenFiles(treeRes.data?.tree || []);
      const flat = allFiles.filter((f) => AST_ANALYZABLE_RE.test(f.path));
      setFilesCapped(flat.length > COMPLEXITY_FILE_CAP);
      const capped = flat.slice(0, COMPLEXITY_FILE_CAP);
      const sourceFiles: Array<{ path: string; content: string }> = [];
      let unreadable = 0;
      for (const f of capped) {
        const fr = await runX<FileContent>('file-read', { repoId, path: f.path });
        if (!fr.ok || !fr.data) { unreadable++; continue; }
        sourceFiles.push({ path: f.path, content: fr.data.content });
      }
      // The card renders the macro's ACTUAL outcome (re-pass
      // checkpoint 3): a failed call shows its message, never the
      // empty-state text — "No files to analyze" over a repo full of
      // files was the silent wrong answer, whatever the server's
      // reason (e.g. its parser package not loading).
      setCxMeta({ matched: flat.length, unreadable });
      const cx = await runX<ComplexityResult>('codeComplexity', { sourceFiles });
      if (cx.ok) { setComplexity(cx.data); setCxError(null); }
      else { setComplexity(null); setCxError(cx.error); }
      if (!cx.ok && cx.error) setErr(cx.error);

      // 2) Commit-pattern analysis — real commit-graph, field-mapped to the
      // macro's expected shape (sha -> hash).
      const graphRes = await runX<{ nodes: CommitGraphNode[] }>('commit-graph', { repoId });
      if (graphRes.ok) {
        const commitInputs = (graphRes.data?.nodes || []).map((n) => ({
          hash: n.sha, author: n.author, date: n.date, files: n.files || [],
          additions: n.additions, deletions: n.deletions, message: n.message,
        }));
        const ca = await runX<CommitAnalysisResult>('commitAnalysis', { commits: commitInputs });
        setCommits(ca.ok ? ca.data : null);
      } else {
        setCommits(null);
      }

      // 3) Dependency audit — real package.json, when this repo has one.
      // Look in the UNFILTERED file list: package.json is JSON, so the
      // AST-filtered list above can never contain it (that lookup is
      // why this card always reported "No package.json" — Review F6).
      const pkgFile = allFiles.find((f) => f.path === 'package.json');
      if (pkgFile) {
        const pr = await runX<FileContent>('file-read', { repoId, path: 'package.json' });
        if (pr.ok && pr.data) {
          try {
            const parsed = JSON.parse(pr.data.content || '{}');
            const depEntries: Record<string, string> = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
            const dependencies = Object.entries(depEntries).map(([name, version]) => ({ name, version: String(version) }));
            if (dependencies.length === 0) { setDepsNote("empty"); setDeps(null); }
            else {
              // liveVulnCheck: the audit asks the same OSV.dev source
              // the Security tab scans with, so the two tabs' counts
              // agree by construction (re-pass checkpoint 3).
              const da = await runX<DependencyAuditResult>('dependencyAudit', { dependencies, liveVulnCheck: true });
              setDeps(da.ok ? da.data : null);
              setDepsNote(null);
            }
          } catch {
            setDepsNote("unreadable"); setDeps(null);
          }
        } else {
          setDepsNote("unreadable"); setDeps(null);
        }
      } else {
        setDepsNote("missing"); setDeps(null);
      }
      setRanOnce(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner err={err} />
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-white">Static analysis</h3>
          <p className="text-[10px] text-zinc-400">Complexity, commit patterns and dependency health — computed live from this repo&apos;s real files, commits and package.json.</p>
        </div>
        <button onClick={runAnalysis} disabled={busy} className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} Run analysis
        </button>
      </div>

      {!ranOnce && !busy && (
        <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
          Run analysis to compute code complexity, commit bus-factor + hotspots, and dependency health.
        </div>
      )}

      {ranOnce && (
        <div className="space-y-3">
          {filesCapped && (
            <p className="text-[10px] text-amber-400">Complexity analysis capped at the first {COMPLEXITY_FILE_CAP} files.</p>
          )}

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <h4 className="mb-2 text-xs font-semibold text-white">Code complexity</h4>
            {!complexity ? (
              cxError ? (
                <p className="text-[11px] text-amber-400">{cxError}</p>
              ) : cxMeta.matched === 0 ? (
                <p className="text-[11px] text-zinc-400">No JS/TS files in this repo — the complexity engine parses JavaScript and TypeScript only.</p>
              ) : cxMeta.unreadable >= cxMeta.matched ? (
                <p className="text-[11px] text-amber-400">{cxMeta.matched} JS/TS file(s) are in this repo, but none could be read, so there was nothing to send for analysis.</p>
              ) : (
                <p className="text-[11px] text-zinc-400">No files to analyze.</p>
              )
            ) : complexity.message ? (
              <p className="text-[11px] text-zinc-400">{complexity.message}</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <StatBox label="Modules" value={complexity.totalModules} />
                  <StatBox label="Functions" value={complexity.totalFunctions} />
                  <StatBox label="Avg complexity" value={complexity.overallAvgComplexity} tone={complexity.overallAvgComplexity > 10 ? 'bad' : 'good'} />
                  <StatBox label="Health score" value={complexity.healthScore} tone={complexity.healthScore < 60 ? 'bad' : 'good'} />
                </div>
                {complexity.hotspots.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Hotspots</p>
                    {complexity.hotspots.slice(0, 8).map((h, i) => (
                      <div key={i} className="flex items-center justify-between border-t border-zinc-800/60 py-1 text-[11px] first:border-0">
                        <span className="truncate font-mono text-zinc-200">{h.module || h.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${SEV_COLOR[h.risk] || SEV_COLOR.low}`}>{h.risk} · {h.cyclomaticComplexity}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <h4 className="mb-2 text-xs font-semibold text-white">Commit patterns</h4>
            {!commits ? (
              <p className="text-[11px] text-zinc-400">No commit data.</p>
            ) : commits.message ? (
              <p className="text-[11px] text-zinc-400">{commits.message}</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <StatBox label="Commits" value={commits.totalCommits} />
                  <StatBox label="Bus factor" value={commits.busFactor} tone={commits.busFactorRisk === 'critical' || commits.busFactorRisk === 'high' ? 'bad' : 'good'} />
                  <StatBox label="Commits/day" value={commits.frequency.commitsPerDay} />
                  <StatBox label="Peak day" value={commits.frequency.peakDay} />
                </div>
                {commits.authors.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Authors</p>
                    {commits.authors.slice(0, 6).map((a) => (
                      <div key={a.name} className="flex items-center justify-between border-t border-zinc-800/60 py-1 text-[11px] first:border-0">
                        <span className="text-zinc-200">{a.name}</span>
                        <span className="text-zinc-400">{a.commits} commits · {Math.round(a.commitShare * 100)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <h4 className="mb-2 text-xs font-semibold text-white">Dependency audit</h4>
            {depsNote ? (
              <p className="text-[11px] text-zinc-400">{depsNote === "missing"
                ? "No package.json in this repo — nothing to audit."
                : depsNote === "empty"
                  ? "This repo's package.json declares no dependencies — nothing to audit."
                  : "This repo's package.json couldn't be read — nothing to audit."}</p>
            ) : !deps ? (
              <p className="text-[11px] text-zinc-400">No dependency data.</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <StatBox label="Deps" value={deps.totalDependencies} />
                  <StatBox label="Health" value={`${deps.healthScore} (${deps.healthGrade})`} tone={deps.healthScore < 60 ? 'bad' : 'good'} />
                  <StatBox label="Version conflicts" value={deps.duplicates.versionConflicts} tone={deps.duplicates.versionConflicts > 0 ? 'bad' : 'good'} />
                  <StatBox label="Vulnerable" value={deps.vulnerabilities.affectedDeps ?? 'unknown'} tone={(deps.vulnerabilities.affectedDeps ?? 0) > 0 ? 'bad' : 'good'} />
                </div>
                {deps.vulnerabilities.unreachable ? (
                  <p className="text-[10px] text-amber-400">Vulnerability check: OSV.dev could not be reached at audit time — the counts are unknown, not zero.</p>
                ) : deps.vulnerabilities.checked ? (
                  <p className="text-[10px] text-zinc-500">Vulnerability data: OSV.dev, queried live at audit time — the same source the Security tab scans with.</p>
                ) : null}
                {deps.dependencyList && deps.dependencyList.length > 0 && (
                  <div>
                    {deps.dependencyList.map((d) => (
                      <div key={d.name} className="flex items-center justify-between border-t border-zinc-800/60 py-1 text-[11px] first:border-0">
                        <span className="truncate font-mono text-zinc-200">{d.name}@{d.version}</span>
                        {d.vulnerabilities === null ? (
                          <span className="shrink-0 text-zinc-500">vulnerabilities unknown</span>
                        ) : d.vulnerabilities === 0 ? (
                          <span className="shrink-0 text-zinc-500">no known advisories</span>
                        ) : (
                          <span className="shrink-0 text-rose-300">{d.vulnerabilities} advisor{d.vulnerabilities === 1 ? 'y' : 'ies'}: {d.advisories.join(', ')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-center">
      <div className={`font-mono text-sm ${tone === 'bad' ? 'text-rose-400' : tone === 'good' ? 'text-green-400' : 'text-cyan-300'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
    </div>
  );
}

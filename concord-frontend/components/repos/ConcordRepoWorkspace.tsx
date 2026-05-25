'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ConcordRepoWorkspace — a full GitHub-shape experience over the Concord
 * repo substrate (server/domains/repos.js). Wires every substrate macro:
 * repo-create/list, file-tree/read/save, branch/tag, commit-graph,
 * issue lifecycle, pull request diff/review/merge, CI workflow runs +
 * logs, security scan, and repo insights.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TreeDiagram, TimelineView } from '@/components/viz';
import type { TreeNode, TimelineEvent } from '@/components/viz';
import {
  Code, FileText, GitBranch, GitCommit, GitPullRequest, AlertCircle,
  CheckCircle, Play, Shield, BarChart3, Plus, Loader2, Tag, X,
} from 'lucide-react';

type Tab = 'code' | 'issues' | 'pulls' | 'actions' | 'security' | 'insights' | 'branches';

interface RepoSummary {
  id: string; name: string; description: string; language: string;
  isPrivate: boolean; fileCount: number; branchCount: number;
  openIssues: number; openPulls: number; updatedAt: string;
}
interface TreeFileNode {
  name: string; type: 'file' | 'dir'; path: string; size?: number;
  children?: TreeFileNode[];
}
interface FileContent { path: string; content: string; language: string; lineCount: number; }
interface BranchRow { name: string; head: string; protected: boolean; isDefault: boolean; commits: number; }
interface TagRow { name: string; commit: string; message?: string; createdAt: string; }
interface IssueRow { number: number; title: string; state: string; labels: string[]; author: string; comments: number; createdAt: string; }
interface IssueDetail { number: number; title: string; body: string; state: string; author: string; labels: string[]; comments: Array<{ id: string; author: string; body: string; createdAt: string }>; createdAt: string; }
interface PullRow { number: number; title: string; state: string; base: string; head: string; author: string; reviews: number; comments: number; }
interface DiffHunk { type: 'add' | 'del' | 'ctx'; line: string; }
interface PullDetail {
  pull: { number: number; title: string; body: string; state: string; base: string; head: string; author: string };
  diff: { files: Array<{ path: string; language: string; additions: number; deletions: number; hunks: DiffHunk[] }>; additions: number; fileCount: number };
  reviews: Array<{ id: string; reviewer: string; verdict: string; body: string; createdAt: string }>;
  mergeable: boolean; approvals: number; changesRequested: number;
}
interface WorkflowRow { id: string; number: number; workflow: string; branch: string; conclusion: string; durationMs: number; createdAt: string; }
interface WorkflowStep { name: string; conclusion: string; durationMs: number; logs: string[]; }
interface SecurityAlert { kind: string; severity: string; package?: string; version?: string; summary?: string; fixedIn?: string; path?: string; line?: number; rule?: string; message?: string; }

const DOMAIN = 'repos';

async function run<T = any>(name: string, params: Record<string, unknown>) {
  const r = await lensRun<T>(DOMAIN, name, params);
  return r.data?.ok ? (r.data.result as T) : null;
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

export function ConcordRepoWorkspace() {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [activeRepo, setActiveRepo] = useState<RepoSummary | null>(null);
  const [tab, setTab] = useState<Tab>('code');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Repo create
  const [newRepoName, setNewRepoName] = useState('');

  const loadRepos = useCallback(async () => {
    setLoading(true);
    const res = await run<{ repos: RepoSummary[] }>('repo-list', {});
    setRepos(res?.repos || []);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadRepos(); }, []);

  const createRepo = async () => {
    if (!newRepoName.trim()) return;
    setBusy('create-repo');
    await run('repo-create', { name: newRepoName.trim(), description: 'A Concord repository' });
    setNewRepoName('');
    await loadRepos();
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Concord Code Host</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            substrate · {repos.length} repos
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
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

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading repos…
        </div>
      )}

      {!loading && !activeRepo && (
        <div className="space-y-2">
          {repos.length === 0 && (
            <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
              No repos yet. Create one above to get a file tree, branches, issues, PRs and CI.
            </div>
          )}
          {repos.map((r) => (
            <button
              key={r.id}
              onClick={() => { setActiveRepo(r); setTab('code'); }}
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

          {tab === 'code' && <CodeTab repoId={activeRepo.id} />}
          {tab === 'branches' && <BranchesTab repoId={activeRepo.id} />}
          {tab === 'issues' && <IssuesTab repoId={activeRepo.id} />}
          {tab === 'pulls' && <PullsTab repoId={activeRepo.id} />}
          {tab === 'actions' && <ActionsTab repoId={activeRepo.id} />}
          {tab === 'security' && <SecurityTab repoId={activeRepo.id} />}
          {tab === 'insights' && <InsightsTab repoId={activeRepo.id} />}
        </div>
      )}
    </div>
  );
}

// ── Code tab — file tree + viewer + editor ───────────────────────────
function CodeTab({ repoId }: { repoId: string }) {
  const [tree, setTree] = useState<TreeFileNode[]>([]);
  const [file, setFile] = useState<FileContent | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadTree = useCallback(async () => {
    const res = await run<{ tree: TreeFileNode[] }>('file-tree', { repoId });
    setTree(res?.tree || []);
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTree(); }, [repoId]);

  const openFile = async (path: string) => {
    const res = await run<FileContent>('file-read', { repoId, path });
    if (res) { setFile(res); setDraft(res.content); setEditing(false); }
  };

  const saveFile = async () => {
    if (!file) return;
    setBusy(true);
    await run('file-save', { repoId, path: file.path, content: draft, message: commitMsg || `Update ${file.path}` });
    setCommitMsg('');
    setBusy(false);
    setEditing(false);
    await openFile(file.path);
    await loadTree();
  };

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-4 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
        <h3 className="mb-2 px-1 text-[10px] uppercase tracking-wider text-zinc-400">File tree</h3>
        {tree.length === 0
          ? <p className="px-1 text-[11px] text-zinc-400">empty</p>
          : <TreeDiagram root={toTreeNodes(tree)} onSelect={(n) => openFile(n.id)} />}
      </div>
      <div className="col-span-8 rounded-lg border border-zinc-800 bg-zinc-950">
        {!file ? (
          <div className="p-8 text-center text-xs text-zinc-400">
            <FileText className="mx-auto mb-2 h-8 w-8 text-zinc-700" />
            Select a file from the tree to view its source.
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <span className="font-mono text-xs text-cyan-300">{file.path}</span>
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
                      {busy ? 'Committing…' : 'Commit'}
                    </button>
                    <button onClick={() => { setEditing(false); setDraft(file.content); }} className="text-[10px] text-zinc-400 hover:text-white">Cancel</button>
                  </>
                ) : (
                  <button onClick={() => setEditing(true)} className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">Edit</button>
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
  );
}

// ── Branches tab — branch + tag mgmt + commit graph ──────────────────
function BranchesTab({ repoId }: { repoId: string }) {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [graph, setGraph] = useState<TimelineEvent[]>([]);
  const [newBranch, setNewBranch] = useState('');
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const b = await run<{ branches: BranchRow[]; tags: TagRow[] }>('branch-list', { repoId });
    setBranches(b?.branches || []);
    setTags(b?.tags || []);
    const g = await run<{ nodes: Array<{ sha: string; message: string; author: string; branch: string; date: string }> }>('commit-graph', { repoId });
    setGraph((g?.nodes || []).map((n) => ({
      id: n.sha,
      label: `${n.message} · ${n.branch}`,
      time: n.date,
      tone: n.branch === 'main' ? 'good' : 'info',
      detail: `${n.sha} by ${n.author}`,
    })));
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId]);

  const createBranch = async () => {
    if (!newBranch.trim()) return;
    setBusy('branch'); await run('branch-create', { repoId, name: newBranch.trim() });
    setNewBranch(''); setBusy(null); await load();
  };
  const createTag = async () => {
    if (!newTag.trim()) return;
    setBusy('tag'); await run('tag-create', { repoId, name: newTag.trim() });
    setNewTag(''); setBusy(null); await load();
  };

  return (
    <div className="space-y-3">
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
            <div key={b.name} className="flex items-center justify-between border-t border-zinc-800/60 py-1 text-[11px]">
              <span className="flex items-center gap-1.5 font-mono text-zinc-200">
                <GitBranch className="h-3 w-3 text-zinc-400" />{b.name}
                {b.isDefault && <span className="rounded bg-blue-500/15 px-1 text-[8px] text-blue-300">default</span>}
                {b.protected && <span className="rounded bg-amber-500/15 px-1 text-[8px] text-amber-300">protected</span>}
              </span>
              <span className="text-zinc-600">{b.commits} commits · {b.head}</span>
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
          {tags.length === 0 && <p className="text-[11px] text-zinc-400">No tags yet.</p>}
          {tags.map((t) => (
            <div key={t.name} className="flex items-center gap-1.5 border-t border-zinc-800/60 py-1 text-[11px]">
              <Tag className="h-3 w-3 text-zinc-400" />
              <span className="font-mono text-zinc-200">{t.name}</span>
              <span className="text-zinc-600">{t.commit}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white">
          <GitCommit className="h-3.5 w-3.5" /> Commit history graph
        </h3>
        {graph.length === 0 ? <p className="text-[11px] text-zinc-400">No commits.</p> : <TimelineView events={graph} />}
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

  const load = useCallback(async () => {
    const r = await run<{ issues: IssueRow[] }>('issue-list', { repoId, state: stateFilter });
    setIssues(r?.issues || []);
  }, [repoId, stateFilter]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId, stateFilter]);

  const openDetail = async (number: number) => {
    const r = await run<{ issue: IssueDetail }>('issue-detail', { repoId, number });
    if (r) setDetail(r.issue);
  };
  const createIssue = async () => {
    if (!newTitle.trim()) return;
    setBusy('create'); await run('issue-create', { repoId, title: newTitle.trim(), body: newBody });
    setNewTitle(''); setNewBody(''); setBusy(null); await load();
  };
  const addComment = async () => {
    if (!detail || !comment.trim()) return;
    setBusy('comment'); await run('issue-comment', { repoId, number: detail.number, body: comment.trim() });
    setComment(''); setBusy(null); await openDetail(detail.number);
  };
  const toggleState = async () => {
    if (!detail) return;
    setBusy('state');
    await run('issue-set-state', { repoId, number: detail.number, state: detail.state === 'open' ? 'closed' : 'open' });
    setBusy(null); await openDetail(detail.number); await load();
  };

  if (detail) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <button onClick={() => setDetail(null)} className="mb-2 text-xs text-cyan-400 hover:underline">← All issues</button>
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
  const [newTitle, setNewTitle] = useState('');
  const [headBranch, setHeadBranch] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await run<{ pulls: PullRow[] }>('pull-list', { repoId, state: 'all' });
    setPulls(r?.pulls || []);
    const b = await run<{ branches: Array<{ name: string }> }>('branch-list', { repoId });
    setBranches((b?.branches || []).map((x) => x.name));
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId]);

  const openDetail = async (number: number) => {
    const r = await run<PullDetail>('pull-detail', { repoId, number });
    if (r) setDetail(r);
  };
  const createPull = async () => {
    if (!newTitle.trim() || !headBranch) { setErr('title + head branch required'); return; }
    setBusy('create'); setErr(null);
    const r = await lensRun(DOMAIN, 'pull-create', { repoId, title: newTitle.trim(), head: headBranch });
    if (!r.data?.ok) setErr(r.data?.error || 'pull-create failed');
    setNewTitle(''); setBusy(null); await load();
  };
  const submitReview = async (verdict: string) => {
    if (!detail) return;
    setBusy('review');
    await run('pull-review', { repoId, number: detail.pull.number, verdict, body: reviewBody });
    setReviewBody(''); setBusy(null); await openDetail(detail.pull.number);
  };
  const merge = async () => {
    if (!detail) return;
    setBusy('merge'); setErr(null);
    const r = await lensRun(DOMAIN, 'pull-merge', { repoId, number: detail.pull.number });
    if (!r.data?.ok) setErr(r.data?.error || 'merge failed');
    setBusy(null); await openDetail(detail.pull.number); await load();
  };

  if (detail) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <button onClick={() => setDetail(null)} className="mb-2 text-xs text-cyan-400 hover:underline">← All pull requests</button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">#{detail.pull.number} {detail.pull.title}</h3>
            <p className="mt-0.5 text-[10px] text-zinc-400">
              <span className="font-mono">{detail.pull.head}</span> → <span className="font-mono">{detail.pull.base}</span> · {detail.pull.state}
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
        {err && <p className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">{err}</p>}
        <div className="mt-3">
          <h4 className="text-[10px] uppercase tracking-wider text-zinc-400">Diff · +{detail.diff.additions} across {detail.diff.fileCount} files</h4>
          <div className="mt-1.5 space-y-2">
            {detail.diff.files.map((f) => (
              <div key={f.path} className="rounded border border-zinc-800 bg-[#0d1117]">
                <div className="border-b border-zinc-800 px-2 py-1 font-mono text-[10px] text-cyan-300">{f.path} <span className="text-green-400">+{f.additions}</span></div>
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
        </div>
        <div className="mt-3 space-y-1.5">
          {detail.reviews.map((rv) => (
            <div key={rv.id} className="rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px]">
              <span className={rv.verdict === 'approve' ? 'text-green-400' : rv.verdict === 'request-changes' ? 'text-rose-400' : 'text-zinc-400'}>
                {rv.reviewer} · {rv.verdict}
              </span>
              {rv.body && <p className="mt-0.5 text-zinc-300">{rv.body}</p>}
            </div>
          ))}
        </div>
        {detail.pull.state === 'open' && (
          <div className="mt-3 space-y-2">
            <input value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} placeholder="Review comment…" className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
            <div className="flex gap-2">
              <button onClick={() => submitReview('approve')} disabled={busy === 'review'} className="rounded bg-green-600 px-2 py-1 text-[10px] text-white disabled:opacity-50">Approve</button>
              <button onClick={() => submitReview('request-changes')} disabled={busy === 'review'} className="rounded bg-rose-600 px-2 py-1 text-[10px] text-white disabled:opacity-50">Request changes</button>
              <button onClick={() => submitReview('comment')} disabled={busy === 'review'} className="rounded bg-zinc-700 px-2 py-1 text-[10px] text-white disabled:opacity-50">Comment</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
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

  const load = useCallback(async () => {
    const r = await run<{ runs: WorkflowRow[] }>('workflow-runs', { repoId });
    setRuns(r?.runs || []);
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId]);

  const triggerRun = async () => {
    setBusy(true); await run('workflow-run', { repoId, workflow: 'CI' });
    setBusy(false); await load();
  };
  const openLogs = async (runId: string) => {
    const r = await run<{ number: number; steps: WorkflowStep[] }>('workflow-logs', { repoId, runId });
    if (r) setLogs(r);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">Workflow runs</h3>
        <button onClick={triggerRun} disabled={busy} className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run CI
        </button>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {runs.length === 0 && <p className="p-4 text-center text-[11px] text-zinc-400">No runs. Trigger CI above.</p>}
        {runs.map((r) => (
          <button key={r.id} onClick={() => openLogs(r.id)} className="flex w-full items-center gap-2 border-b border-zinc-800/60 px-3 py-2 text-left text-[11px] last:border-0 hover:bg-zinc-900">
            {r.conclusion === 'success'
              ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              : <X className="h-3.5 w-3.5 text-rose-500" />}
            <span className="flex-1 text-zinc-200">{r.workflow} #{r.number}</span>
            <span className="font-mono text-zinc-600">{r.branch}</span>
            <span className="text-zinc-600">{(r.durationMs / 1000).toFixed(1)}s</span>
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
                {st.conclusion === 'success' ? '✓' : st.conclusion === 'failure' ? '✗' : '○'} {st.name} ({(st.durationMs / 1000).toFixed(1)}s)
              </p>
              <pre className="ml-3 text-[10px] text-zinc-400">{st.logs.join('\n')}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Security tab — Dependabot + code scanning ────────────────────────
function SecurityTab({ repoId }: { repoId: string }) {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [bySeverity, setBySeverity] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);

  const scan = async () => {
    setBusy(true);
    const r = await run<{ alerts: SecurityAlert[]; bySeverity: Record<string, number> }>('security-scan', { repoId });
    setAlerts(r?.alerts || []);
    setBySeverity(r?.bySeverity || {});
    setScanned(true);
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">Security overview</h3>
        <button onClick={scan} disabled={busy} className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />} Run scan
        </button>
      </div>
      {scanned && (
        <div className="grid grid-cols-4 gap-2">
          {(['critical', 'high', 'moderate', 'low'] as const).map((s) => (
            <div key={s} className={`rounded border px-2 py-1.5 text-center ${SEV_COLOR[s]}`}>
              <div className="font-mono text-lg">{bySeverity[s] || 0}</div>
              <div className="text-[9px] uppercase">{s}</div>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        {!scanned && <p className="p-4 text-center text-[11px] text-zinc-400">Run a scan to see Dependabot alerts + code scanning results.</p>}
        {scanned && alerts.length === 0 && <p className="p-4 text-center text-[11px] text-green-400">No security alerts. Clean.</p>}
        {alerts.map((a, i) => (
          <div key={i} className="flex items-start gap-2 border-b border-zinc-800/60 px-3 py-2 text-[11px] last:border-0">
            <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${SEV_COLOR[a.severity]}`}>{a.severity}</span>
            <div className="flex-1">
              {a.kind === 'dependency' ? (
                <>
                  <p className="text-zinc-200">{a.package}@{a.version} — {a.summary}</p>
                  <p className="text-[10px] text-zinc-400">Dependabot · fixed in {a.fixedIn}</p>
                </>
              ) : (
                <>
                  <p className="text-zinc-200">{a.message}</p>
                  <p className="font-mono text-[10px] text-zinc-400">{a.path}:{a.line} · {a.rule}</p>
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

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<any>('repo-insights', { repoId });
    setData(r);
    setLoading(false);
  }, [repoId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [repoId]);

  if (loading) return <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading insights…</div>;
  if (!data) return <p className="text-[11px] text-zinc-400">No insight data.</p>;

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

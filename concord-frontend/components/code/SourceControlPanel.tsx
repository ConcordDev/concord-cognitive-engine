'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { GitBranch, Save, RefreshCw, FileText, Loader2, GitCommit, AlertCircle, Terminal as TerminalIcon, ChevronDown, ChevronRight } from 'lucide-react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const MonacoDiffViewer = dynamic(() => import('./MonacoDiffViewer'), { ssr: false });

interface DirtyTab {
  id: string;
  name: string;
  language: string;
  content: string;
  isDirty: boolean;
}

interface SavedScript {
  id: string;
  title?: string;
  data?: { content?: string; language?: string };
}

interface SourceControlPanelProps {
  tabs: DirtyTab[];
  savedScripts: SavedScript[];
  onJumpToTab: (tabId: string) => void;
  onCommitAll: (message: string) => Promise<void>;
  onRefresh?: () => void;
  /** Real-git workspace path (Sprint A #2). When set, the panel mounts
   *  the live `git status` / commit / branch UI in addition to the
   *  DTU snapshot UX. */
  realGitRepoPath?: string;
}

// Sprint A #2 — real git macros.
async function callMacro<T>(name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'code', name, input });
    return (r.data?.result ?? r.data) as T;
  } catch {
    return null;
  }
}

interface RealGitFile { path: string; staged: boolean; modified: boolean; untracked: boolean }
interface RealGitBranch { name: string; current: boolean }
interface RealGitCommit { sha: string; author?: string; subject: string }

function RealGitSection({ repoPath }: { repoPath: string }) {
  const [expanded, setExpanded] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [files, setFiles] = useState<RealGitFile[]>([]);
  const [branches, setBranches] = useState<RealGitBranch[]>([]);
  const [recentCommits, setRecentCommits] = useState<RealGitCommit[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const refresh = useCallback(async () => {
    setBusy('refresh'); setErr(null);
    const en = await callMacro<{ ok: boolean; enabled?: boolean; pushEnabled?: boolean }>('git_enabled', {});
    setEnabled(!!en?.enabled);
    setPushEnabled(!!en?.pushEnabled);
    if (en?.enabled) {
      const st = await callMacro<{ ok: boolean; files?: RealGitFile[]; reason?: string }>('git_status', { repoPath });
      if (st?.ok && st.files) setFiles(st.files);
      else if (st?.reason) setErr(st.reason);
      const br = await callMacro<{ ok: boolean; branches?: RealGitBranch[] }>('git_branch', { repoPath, op: 'list' });
      if (br?.ok && br.branches) setBranches(br.branches);
      const lg = await callMacro<{ ok: boolean; commits?: RealGitCommit[] }>('git_log', { repoPath, limit: 10 });
      if (lg?.ok && lg.commits) setRecentCommits(lg.commits);
    }
    setBusy(null);
  }, [repoPath]);

  useEffect(() => { if (expanded) refresh(); }, [expanded, refresh]);

  async function handleCommit() {
    if (!commitMsg.trim() || selectedFiles.size === 0) return;
    setBusy('commit'); setErr(null); setOk(null);
    const r = await callMacro<{ ok: boolean; sha?: string; reason?: string; stderr?: string }>('git_commit', {
      repoPath, message: commitMsg.trim(), files: Array.from(selectedFiles),
    });
    if (r?.ok && r.sha) {
      setOk(`Committed ${r.sha.slice(0, 7)}`);
      setCommitMsg('');
      setSelectedFiles(new Set());
      await refresh();
    } else {
      setErr(r?.reason || r?.stderr || 'commit failed');
    }
    setBusy(null);
  }

  async function handleCreateBranch() {
    const name = typeof window !== 'undefined' ? window.prompt('New branch name:') : '';
    if (!name) return;
    setBusy('branch'); setErr(null);
    const r = await callMacro<{ ok: boolean; reason?: string }>('git_branch', { repoPath, op: 'create', name });
    if (r?.ok) { setOk(`Created + checked out ${name}`); await refresh(); }
    else setErr(r?.reason || 'create failed');
    setBusy(null);
  }

  if (enabled === null) {
    return (
      <div className="px-3 py-2 border-t border-white/10 text-[10px] text-gray-500">
        <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> checking real git…
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="px-3 py-2 border-t border-white/10 text-[10px] text-gray-500">
        Real git disabled. Set <code className="text-gray-400">CONCORD_GIT_ENABLED=true</code> to enable live `git status` / commit / branch.
      </div>
    );
  }

  const current = branches.find((b) => b.current);

  return (
    <div className="border-t border-white/10 flex flex-col min-h-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="px-3 py-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 hover:bg-white/[0.04] w-full"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <TerminalIcon className="w-3 h-3 text-emerald-400" />
        Real git ({current?.name ?? '?'})
        <span className="ml-auto text-[9px] text-emerald-300">live</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-2 text-xs">
          {err && <div className="text-[10px] text-red-300 bg-red-500/10 p-1.5 rounded flex items-center gap-1"><AlertCircle className="w-3 h-3" />{err}</div>}
          {ok && <div className="text-[10px] text-emerald-300">{ok}</div>}

          <div className="flex items-center gap-2">
            <select
              value={current?.name ?? ''}
              onChange={async (e) => {
                const name = e.target.value;
                setBusy('checkout');
                const r = await callMacro<{ ok: boolean; reason?: string }>('git_branch', { repoPath, op: 'checkout', name });
                if (r?.ok) { setOk(`Switched to ${name}`); await refresh(); }
                else setErr(r?.reason || 'checkout failed');
                setBusy(null);
              }}
              className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-0.5 text-white"
            >
              {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
            <button
              onClick={handleCreateBranch}
              disabled={busy !== null}
              className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 hover:bg-white/10"
            >+ branch</button>
            <button
              onClick={refresh}
              disabled={busy !== null}
              className="ml-auto text-gray-400 hover:text-white"
              title="git status"
            ><RefreshCw className={cn('w-3 h-3', busy === 'refresh' && 'animate-spin')} /></button>
          </div>

          <div className="border border-white/10 rounded max-h-32 overflow-y-auto">
            {files.length === 0 ? (
              <p className="text-[10px] text-gray-500 px-2 py-1">Working tree clean.</p>
            ) : (
              files.map((f) => (
                <label key={f.path} className="flex items-center gap-2 px-2 py-1 text-[10px] hover:bg-white/[0.04] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(f.path)}
                    onChange={(e) => setSelectedFiles((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(f.path); else next.delete(f.path);
                      return next;
                    })}
                    className="accent-cyan-400"
                  />
                  <span className="flex-1 truncate text-gray-300">{f.path}</span>
                  <span className={cn('font-bold', f.untracked ? 'text-emerald-400' : f.modified ? 'text-yellow-400' : 'text-cyan-400')}>
                    {f.untracked ? 'U' : f.modified ? 'M' : 'S'}
                  </span>
                </label>
              ))
            )}
          </div>

          <textarea
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder={`Real git commit for ${selectedFiles.size} selected file(s)`}
            rows={2}
            className="w-full px-2 py-1 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleCommit}
              disabled={busy !== null || !commitMsg.trim() || selectedFiles.size === 0}
              className="flex items-center gap-1.5 px-3 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy === 'commit' ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCommit className="w-3 h-3" />}
              git commit
            </button>
            {pushEnabled && (
              <button
                onClick={async () => {
                  setBusy('push'); setErr(null);
                  const r = await callMacro<{ ok: boolean; reason?: string; stderr?: string }>('git_push', { repoPath, branch: current?.name });
                  if (r?.ok) setOk('Pushed.'); else setErr(r?.reason || r?.stderr || 'push failed');
                  setBusy(null);
                }}
                disabled={busy !== null}
                className="text-[10px] px-2 py-1 rounded bg-white/5 border border-white/10 hover:bg-white/10"
              >git push</button>
            )}
            <button
              onClick={() => setShowLog((v) => !v)}
              className="ml-auto text-[10px] text-gray-400 hover:text-white"
            >{showLog ? 'hide log' : 'show log'}</button>
          </div>
          {showLog && (
            <ul className="border-t border-white/10 pt-2 space-y-1 max-h-32 overflow-y-auto">
              {recentCommits.map((c) => (
                <li key={c.sha} className="text-[10px] text-gray-400">
                  <span className="font-mono text-cyan-300">{c.sha.slice(0, 7)}</span>{' '}
                  {c.author && <span className="text-gray-500">{c.author}</span>}{' '}
                  <span className="text-gray-300">{c.subject}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function SourceControlPanel({ tabs, savedScripts, onJumpToTab, onCommitAll, onRefresh, realGitRepoPath }: SourceControlPanelProps) {
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [committedAt, setCommittedAt] = useState<string | null>(null);
  const [snapshotCount, setSnapshotCount] = useState<number | null>(null);

  const dirtyTabs = useMemo(() => tabs.filter(t => t.isDirty), [tabs]);
  const newTabs = useMemo(() => tabs.filter(t => !savedScripts.some(s => s.id === t.id)), [tabs, savedScripts]);

  useEffect(() => {
    if (!selectedTabId && dirtyTabs.length > 0) {
      setSelectedTabId(dirtyTabs[0].id);
    }
  }, [dirtyTabs, selectedTabId]);

  useEffect(() => {
    refreshSnapshotCount();
  }, [tabs.length]);

  async function refreshSnapshotCount() {
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'code',
        action: 'snapshots-list',
        input: { limit: 100 },
      });
      const count = res.data?.result?.snapshots?.length;
      if (typeof count === 'number') setSnapshotCount(count);
    } catch {
      /* best effort */
    }
  }

  const selectedTab = tabs.find(t => t.id === selectedTabId);
  const selectedSaved = savedScripts.find(s => s.id === selectedTabId);
  const originalContent = selectedSaved?.data?.content || '';
  const modifiedContent = selectedTab?.content || '';

  async function handleCommit() {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await onCommitAll(message.trim());
      setMessage('');
      setCommittedAt(new Date().toLocaleTimeString());
      await refreshSnapshotCount();
    } finally {
      setCommitting(false);
    }
  }

  const changedLines = useMemo(() => {
    if (!selectedTab || !selectedSaved) return { added: 0, removed: 0 };
    const before = (selectedSaved.data?.content || '').split('\n');
    const after = selectedTab.content.split('\n');
    return {
      added: Math.max(0, after.length - before.length),
      removed: Math.max(0, before.length - after.length),
    };
  }, [selectedTab, selectedSaved]);

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Source control</span>
        <span className="ml-auto text-[10px] text-gray-500" title="DTU snapshots in your corpus">
          {snapshotCount !== null ? `${snapshotCount} snapshot${snapshotCount === 1 ? '' : 's'}` : ''}
        </span>
        <button
          onClick={() => { refreshSnapshotCount(); onRefresh?.(); }}
          title="Refresh"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-white/10 space-y-2">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Commit message (creates DTU snapshot bundle)"
          rows={2}
          className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-none"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleCommit}
            disabled={committing || !message.trim() || (dirtyTabs.length === 0 && newTabs.length === 0)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
          >
            {committing ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCommit className="w-3 h-3" />}
            Commit {dirtyTabs.length + newTabs.length}
          </button>
          {committedAt && (
            <span className="text-[10px] text-green-400">Committed at {committedAt}</span>
          )}
        </div>
        {dirtyTabs.length === 0 && newTabs.length === 0 && (
          <p className="text-[10px] text-gray-500 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Working tree clean
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/5">
          Changes ({dirtyTabs.length + newTabs.length})
        </div>
        <ul className="max-h-44 overflow-y-auto">
          {[...newTabs, ...dirtyTabs.filter(t => !newTabs.some(n => n.id === t.id))].map(t => {
            const isNew = newTabs.some(n => n.id === t.id);
            return (
              <li key={t.id}>
                <button
                  onClick={() => { setSelectedTabId(t.id); onJumpToTab(t.id); }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/[0.04]',
                    selectedTabId === t.id && 'bg-cyan-500/10 text-cyan-200'
                  )}
                >
                  <FileText className="w-3.5 h-3.5 text-gray-500" />
                  <span className="truncate flex-1">{t.name}</span>
                  <span className={cn('text-[9px] font-bold', isNew ? 'text-green-400' : 'text-yellow-400')}>
                    {isNew ? 'U' : 'M'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selectedTab && (
          <div className="flex-1 min-h-0 flex flex-col border-t border-white/10">
            <div className="px-3 py-1 text-[10px] text-gray-500 flex items-center gap-3 border-b border-white/5">
              <span className="truncate">{selectedTab.name}</span>
              <span className="text-green-400">+{changedLines.added}</span>
              <span className="text-red-400">−{changedLines.removed}</span>
              <button
                onClick={() => setSelectedTabId(null)}
                className="ml-auto text-gray-500 hover:text-white"
              >
                <Save className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <MonacoDiffViewer
                original={originalContent}
                modified={modifiedContent}
                language={selectedTab.language}
                height="100%"
                renderSideBySide={false}
              />
            </div>
          </div>
        )}
      </div>

      {realGitRepoPath && <RealGitSection repoPath={realGitRepoPath} />}
    </div>
  );
}

export default SourceControlPanel;

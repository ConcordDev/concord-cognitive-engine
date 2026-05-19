'use client';

import { useEffect, useState } from 'react';
import { GitBranch, Loader2, GitCommit, GitMerge, Check, Plus } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GitStatus { branch: string; branches: string[]; modified: string[]; staged: string[]; head: string | null; clean: boolean }
interface GitCommitRow { id: string; number: string; message: string; branch: string; committedAt: string; paths: string[] }

export function GitPanel({ projectId, onChanged }: { projectId: string | null; onChanged?: () => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitCommitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [branchDraft, setBranchDraft] = useState('');

  useEffect(() => { if (projectId) refresh(); else { setStatus(null); setLog([]); } }, [projectId]);

  async function refresh() {
    if (!projectId) return;
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        api.post('/api/lens/run', { domain: 'code', action: 'git-status', input: { projectId } }),
        api.post('/api/lens/run', { domain: 'code', action: 'git-log', input: { projectId } }),
      ]);
      setStatus((s.data?.result as GitStatus) || null);
      setLog((l.data?.result?.log || []) as GitCommitRow[]);
    } catch (e) { console.error('[Git] failed', e); }
    finally { setLoading(false); }
  }

  async function stage(path?: string) {
    if (!projectId) return;
    try { await api.post('/api/lens/run', { domain: 'code', action: 'git-stage', input: { projectId, paths: path ? [path] : undefined } }); await refresh(); }
    catch (e) { console.error('[Git] stage', e); }
  }
  async function unstage(path?: string) {
    if (!projectId) return;
    try { await api.post('/api/lens/run', { domain: 'code', action: 'git-unstage', input: { projectId, paths: path ? [path] : undefined } }); await refresh(); }
    catch (e) { console.error('[Git] unstage', e); }
  }
  async function commit() {
    if (!projectId || !message.trim()) return;
    try {
      const r = await api.post('/api/lens/run', { domain: 'code', action: 'git-commit', input: { projectId, message: message.trim() } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setMessage('');
      await refresh();
      onChanged?.();
    } catch (e) { console.error('[Git] commit', e); }
  }
  async function createBranch() {
    if (!projectId || !branchDraft.trim()) return;
    try {
      await api.post('/api/lens/run', { domain: 'code', action: 'git-branch-create', input: { projectId, name: branchDraft.trim(), checkout: true } });
      setBranchDraft('');
      await refresh();
    } catch (e) { console.error('[Git] branch', e); }
  }
  async function checkout(name: string) {
    if (!projectId) return;
    try { await api.post('/api/lens/run', { domain: 'code', action: 'git-checkout', input: { projectId, branch: name } }); await refresh(); }
    catch (e) { console.error('[Git] checkout', e); }
  }

  if (!projectId) return <div className="p-3 text-xs text-gray-500 italic">Open a project to use source control.</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <GitBranch className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Source control</span>
        {status && <span className="text-[10px] text-blue-300 font-mono">{status.branch}</span>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading || !status ? (
          <div className="p-3 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</div>
        ) : (
          <>
            <div className="p-2 space-y-1.5 border-b border-white/10">
              <input
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && commit()}
                placeholder="Commit message"
                className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
              <button onClick={commit} disabled={!message.trim() || status.staged.length === 0} className="w-full px-2 py-1 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
                <Check className="w-3 h-3" />Commit {status.staged.length > 0 ? `(${status.staged.length})` : ''}
              </button>
            </div>

            {status.staged.length > 0 && (
              <Section title="Staged Changes" count={status.staged.length}>
                {status.staged.map(p => (
                  <FileRow key={p} path={p} accent="emerald" onAction={() => unstage(p)} actionLabel="−" actionTitle="Unstage" />
                ))}
              </Section>
            )}

            {status.modified.length > 0 && (
              <Section title="Changes" count={status.modified.length}>
                {status.modified.map(p => (
                  <FileRow key={p} path={p} accent="amber" onAction={() => stage(p)} actionLabel="+" actionTitle="Stage" />
                ))}
                <div className="px-3 py-1">
                  <button onClick={() => stage()} className="text-[10px] text-blue-300 hover:text-blue-200">+ Stage all</button>
                </div>
              </Section>
            )}

            {status.clean && (
              <div className="p-3 text-[11px] text-emerald-300 inline-flex items-center gap-1"><Check className="w-3 h-3" />Working tree clean</div>
            )}

            <Section title="Branches" count={status.branches.length}>
              {status.branches.map(b => (
                <div key={b} className="px-3 py-1 flex items-center gap-2 text-xs hover:bg-white/[0.03]">
                  <GitBranch className={cn('w-3 h-3', b === status.branch ? 'text-blue-400' : 'text-gray-500')} />
                  <span className={cn('flex-1 truncate font-mono', b === status.branch ? 'text-white' : 'text-gray-400')}>{b}</span>
                  {b !== status.branch && <button onClick={() => checkout(b)} className="text-[10px] text-blue-300 hover:text-blue-200">checkout</button>}
                </div>
              ))}
              <div className="px-3 py-1 flex items-center gap-1">
                <input value={branchDraft} onChange={e => setBranchDraft(e.target.value)} placeholder="new-branch" className="flex-1 px-1.5 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                <button onClick={createBranch} className="p-1 text-blue-300 hover:text-blue-200"><Plus className="w-3 h-3" /></button>
              </div>
            </Section>

            {log.length > 0 && (
              <Section title="Log" count={log.length}>
                {log.slice(0, 20).map(c => (
                  <div key={c.id} className="px-3 py-1.5 hover:bg-white/[0.03]">
                    <div className="flex items-center gap-2">
                      <GitCommit className="w-3 h-3 text-gray-400" />
                      <span className="font-mono text-[10px] text-gray-500">{c.id.slice(0, 8)}</span>
                      <span className="text-xs text-white flex-1 truncate">{c.message}</span>
                    </div>
                    <div className="ml-5 text-[10px] text-gray-500">{c.paths.length} files · {c.committedAt.slice(0, 16).replace('T', ' ')}</div>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/5">
      <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-gray-500 font-semibold bg-white/[0.02]">{title} · {count}</div>
      {children}
    </div>
  );
}

function FileRow({ path, accent, onAction, actionLabel, actionTitle }: { path: string; accent: 'emerald' | 'amber'; onAction: () => void; actionLabel: string; actionTitle: string }) {
  return (
    <div className="px-3 py-1 flex items-center gap-2 text-xs hover:bg-white/[0.03] group">
      <span className={cn('w-1.5 h-1.5 rounded-full', accent === 'emerald' ? 'bg-emerald-400' : 'bg-amber-400')} />
      <span className="font-mono truncate flex-1 text-white">{path}</span>
      <button onClick={onAction} title={actionTitle} className="opacity-0 group-hover:opacity-100 px-1 text-[11px] text-gray-300 hover:text-white">{actionLabel}</button>
    </div>
  );
}

export default GitPanel;

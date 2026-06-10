'use client';

import { useEffect, useState } from 'react';
import { GitBranch, Loader2, GitCommit, GitMerge, Check, Plus, Archive, Undo2, FileDiff, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GitStatus { branch: string; branches: string[]; modified: string[]; staged: string[]; head: string | null; clean: boolean }
interface GitCommitRow { id: string; number: string; message: string; branch: string; committedAt: string; paths: string[] }
interface DiffHunk { type: 'context' | 'add' | 'del'; text: string; oldLine?: number; newLine?: number }
interface StashRow { id: string; message: string; branch: string; createdAt: string; fileCount: number }

export function GitPanel({ projectId, onChanged }: { projectId: string | null; onChanged?: () => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitCommitRow[]>([]);
  const [stashes, setStashes] = useState<StashRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [branchDraft, setBranchDraft] = useState('');
  const [diff, setDiff] = useState<{ path: string; hunks: DiffHunk[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only projectId should retrigger
  useEffect(() => { if (projectId) refresh(); else { setStatus(null); setLog([]); setStashes([]); } }, [projectId]);

  async function refresh() {
    if (!projectId) return;
    setLoading(true);
    try {
      const [s, l, st] = await Promise.all([
        lensRun({ domain: 'code', action: 'git-status', input: { projectId } }),
        lensRun({ domain: 'code', action: 'git-log', input: { projectId } }),
        lensRun({ domain: 'code', action: 'git-stash-list', input: { projectId } }),
      ]);
      setStatus((s.data?.result as GitStatus) || null);
      setLog((l.data?.result?.log || []) as GitCommitRow[]);
      setStashes((st.data?.result?.stashes || []) as StashRow[]);
    } catch (e) { console.error('[Git] failed', e); }
    finally { setLoading(false); }
  }

  async function run(action: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (!projectId) return null;
    try {
      const r = await lensRun({ domain: 'code', action, input: { projectId, ...input } });
      if (r.data?.ok === false) { setNotice(r.data?.error || `${action} failed`); return null; }
      return r.data?.result || {};
    } catch (e) { console.error(`[Git] ${action}`, e); return null; }
  }

  const stage = async (path?: string) => { await run('git-stage', path ? { paths: [path] } : {}); await refresh(); };
  const unstage = async (path?: string) => { await run('git-unstage', path ? { paths: [path] } : {}); await refresh(); };
  const discard = async (path: string) => {
    if (!confirm(`Discard all working changes to ${path}?`)) return;
    await run('git-discard', { path }); await refresh(); onChanged?.();
  };
  async function commit() {
    if (!message.trim()) return;
    setNotice(null);
    const r = await run('git-commit', { message: message.trim() });
    if (r) { setMessage(''); await refresh(); onChanged?.(); }
  }
  async function createBranch() {
    if (!branchDraft.trim()) return;
    await run('git-branch-create', { name: branchDraft.trim(), checkout: true });
    setBranchDraft(''); await refresh(); onChanged?.();
  }
  const checkout = async (name: string) => { await run('git-checkout', { branch: name }); await refresh(); onChanged?.(); };
  async function merge(from: string) {
    setNotice(null);
    const r = await run('git-merge', { from });
    if (r) setNotice(`Merged '${from}' — ${r.filesChanged} file(s) changed.`);
    await refresh(); onChanged?.();
  }
  async function showDiff(path: string) {
    const r = await run('git-diff', { path });
    if (r) setDiff({ path, hunks: (r.hunks || []) as DiffHunk[] });
  }
  async function stashAll() {
    const r = await run('git-stash', { message: `WIP on ${status?.branch || 'main'}` });
    if (r) setNotice(`Stashed ${r.stashedFiles} file(s).`);
    await refresh(); onChanged?.();
  }
  async function popStash(id: string) {
    await run('git-stash-pop', { id });
    await refresh(); onChanged?.();
  }

  if (!projectId) return <div className="p-3 text-xs text-gray-400 italic">Open a project to use source control.</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <GitBranch className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Source control</span>
        {status && <span className="text-[10px] text-blue-300 font-mono">{status.branch}</span>}
      </div>

      {notice && (
        <div className="px-3 py-1.5 text-[11px] text-amber-200 bg-amber-500/10 border-b border-white/5 flex items-center gap-2">
          <span className="flex-1">{notice}</span>
          <button aria-label="Dismiss" type="button" onClick={() => setNotice(null)} className="text-gray-400 hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading || !status ? (
          <div className="p-3 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</div>
        ) : (
          <>
            <div className="p-2 space-y-1.5 border-b border-white/10">
              <input value={message} onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commit()}
                placeholder="Commit message"
                className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <div className="flex items-center gap-1">
                <button onClick={commit} disabled={!message.trim() || status.staged.length === 0}
                  className="flex-1 px-2 py-1 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
                  <Check className="w-3 h-3" />Commit {status.staged.length > 0 ? `(${status.staged.length})` : ''}
                </button>
                <button onClick={stashAll} disabled={status.clean} title="Stash all changes"
                  className="px-2 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] disabled:opacity-40 inline-flex items-center gap-1">
                  <Archive className="w-3 h-3" />Stash
                </button>
              </div>
            </div>

            {status.staged.length > 0 && (
              <Section title="Staged Changes" count={status.staged.length}>
                {status.staged.map((p) => (
                  <FileRow key={p} path={p} accent="emerald"
                    onDiff={() => showDiff(p)} onPrimary={() => unstage(p)} primaryLabel="−" primaryTitle="Unstage" />
                ))}
              </Section>
            )}

            {status.modified.length > 0 && (
              <Section title="Changes" count={status.modified.length}>
                {status.modified.map((p) => (
                  <FileRow key={p} path={p} accent="amber"
                    onDiff={() => showDiff(p)} onPrimary={() => stage(p)} primaryLabel="+" primaryTitle="Stage"
                    onDiscard={() => discard(p)} />
                ))}
                <div className="px-3 py-1">
                  <button onClick={() => stage()} className="text-[10px] text-blue-300 hover:text-blue-200">+ Stage all</button>
                </div>
              </Section>
            )}

            {status.clean && (
              <div className="p-3 text-[11px] text-emerald-300 inline-flex items-center gap-1"><Check className="w-3 h-3" />Working tree clean</div>
            )}

            {stashes.length > 0 && (
              <Section title="Stashes" count={stashes.length}>
                {stashes.map((s) => (
                  <div key={s.id} className="px-3 py-1 flex items-center gap-2 text-xs hover:bg-white/[0.03] group">
                    <Archive className="w-3 h-3 text-violet-400" />
                    <span className="flex-1 truncate text-gray-300">{s.message}</span>
                    <span className="text-[10px] text-gray-400">{s.fileCount}f</span>
                    <button onClick={() => popStash(s.id)} className="text-[10px] text-blue-300 hover:text-blue-200">pop</button>
                  </div>
                ))}
              </Section>
            )}

            <Section title="Branches" count={status.branches.length}>
              {status.branches.map((b) => (
                <div key={b} className="px-3 py-1 flex items-center gap-2 text-xs hover:bg-white/[0.03] group">
                  <GitBranch className={cn('w-3 h-3', b === status.branch ? 'text-blue-400' : 'text-gray-400')} />
                  <span className={cn('flex-1 truncate font-mono', b === status.branch ? 'text-white' : 'text-gray-400')}>{b}</span>
                  {b !== status.branch && (
                    <>
                      <button onClick={() => merge(b)} title={`Merge ${b} into ${status.branch}`}
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-0.5">
                        <GitMerge className="w-3 h-3" />merge
                      </button>
                      <button onClick={() => checkout(b)} className="text-[10px] text-blue-300 hover:text-blue-200">checkout</button>
                    </>
                  )}
                </div>
              ))}
              <div className="px-3 py-1 flex items-center gap-1">
                <input value={branchDraft} onChange={(e) => setBranchDraft(e.target.value)}
                  placeholder="new-branch"
                  className="flex-1 px-1.5 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                <button aria-label="Add" onClick={createBranch} className="p-1 text-blue-300 hover:text-blue-200"><Plus className="w-3 h-3" /></button>
              </div>
            </Section>

            {log.length > 0 && (
              <Section title="Log" count={log.length}>
                {log.slice(0, 20).map((c) => (
                  <div key={c.id} className="px-3 py-1.5 hover:bg-white/[0.03]">
                    <div className="flex items-center gap-2">
                      <GitCommit className="w-3 h-3 text-gray-400" />
                      <span className="font-mono text-[10px] text-gray-400">{c.id.slice(0, 8)}</span>
                      <span className="text-xs text-white flex-1 truncate">{c.message}</span>
                    </div>
                    <div className="ml-5 text-[10px] text-gray-400">{c.paths.length} files · {c.committedAt.slice(0, 16).replace('T', ' ')}</div>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      {diff && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setDiff(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-[#0d1117] border border-white/15 rounded-lg w-full max-w-2xl max-h-[80%] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
              <FileDiff className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-mono text-white flex-1 truncate">{diff.path}</span>
              <button aria-label="Close" type="button" onClick={() => setDiff(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-auto font-mono text-[11px]">
              {diff.hunks.length === 0 ? (
                <div className="p-3 text-gray-400">No changes vs HEAD.</div>
              ) : diff.hunks.map((h, i) => (
                <div key={i} className={cn('px-3 py-0.5 whitespace-pre-wrap',
                  h.type === 'add' ? 'bg-emerald-500/10 text-emerald-300'
                    : h.type === 'del' ? 'bg-rose-500/10 text-rose-300' : 'text-gray-400')}>
                  <span className="select-none mr-2 text-gray-600">{h.type === 'add' ? '+' : h.type === 'del' ? '−' : ' '}</span>
                  {h.text || ' '}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/5">
      <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-gray-400 font-semibold bg-white/[0.02]">{title} · {count}</div>
      {children}
    </div>
  );
}

function FileRow({
  path, accent, onDiff, onPrimary, primaryLabel, primaryTitle, onDiscard,
}: {
  path: string; accent: 'emerald' | 'amber'; onDiff: () => void;
  onPrimary: () => void; primaryLabel: string; primaryTitle: string; onDiscard?: () => void;
}) {
  return (
    <div className="px-3 py-1 flex items-center gap-2 text-xs hover:bg-white/[0.03] group">
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', accent === 'emerald' ? 'bg-emerald-400' : 'bg-amber-400')} />
      <button type="button" onClick={onDiff} className="font-mono truncate flex-1 text-left text-white hover:text-blue-300" title="View diff">
        {path}
      </button>
      {onDiscard && (
        <button onClick={onDiscard} title="Discard changes" className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-300">
          <Undo2 className="w-3 h-3" />
        </button>
      )}
      <button onClick={onPrimary} title={primaryTitle}
        className="opacity-0 group-hover:opacity-100 px-1 text-[11px] text-gray-300 hover:text-white">{primaryLabel}</button>
    </div>
  );
}

export default GitPanel;

'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Loader2, Send, CheckCircle, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AgentTask {
  id: string; number: string;
  projectId: string; prompt: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  startedAt: string; finishedAt: string | null;
  plan: Array<{ action: string; summary: string }>;
  filesChanged: string[];
  source: string;
}

export function AgentComposerPanel({ projectId }: { projectId: string | null }) {
  const [list, setList] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only projectId should retrigger
  useEffect(() => { refresh(); }, [projectId]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'code', action: 'agent-tasks-list', input: {} });
      const all = (r.data?.result?.tasks || []) as AgentTask[];
      setList(projectId ? all.filter(t => t.projectId === projectId) : all);
    } catch (e) { console.error('[Agent] list', e); }
    finally { setLoading(false); }
  }

  async function start() {
    if (!projectId || !prompt.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun({ domain: 'code', action: 'agent-task-start', input: { projectId, prompt: prompt.trim() } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setPrompt('');
      await refresh();
    } catch (e) { console.error('[Agent] start', e); }
    finally { setBusy(false); }
  }

  async function finish(id: string, status: 'completed' | 'cancelled') {
    try {
      await lensRun({ domain: 'code', action: 'agent-task-finish', input: { id, status } });
      await refresh();
    } catch (e) { console.error('[Agent] finish', e); }
  }

  if (!projectId) return <div className="p-3 text-xs text-gray-500 italic">Open a project to use the agent.</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Agent (Composer)</span>
        <span className="text-[10px] text-gray-500">{list.length}</span>
      </div>
      <div className="p-2 border-b border-white/10 space-y-1.5">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe a multi-file task — Refactor auth to JWT and add tests…"
          rows={3}
          className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button onClick={start} disabled={busy || !prompt.trim()} className="w-full px-2 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}Compose
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-3 text-xs text-gray-500 italic">No tasks yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(t => (
              <li key={t.id} className="p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn('text-[9px] uppercase px-1 py-0.5 rounded font-mono',
                    t.status === 'running'   ? 'bg-blue-500/20 text-blue-300' :
                    t.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' :
                    t.status === 'cancelled' ? 'bg-gray-500/20 text-gray-300' :
                                                'bg-rose-500/20 text-rose-300',
                  )}>{t.status}</span>
                  <span className="font-mono text-[10px] text-gray-500">{t.number}</span>
                  {t.source === 'brain' && <span className="text-[9px] text-blue-300">· brain</span>}
                  {t.status === 'running' && (
                    <div className="ml-auto flex items-center gap-1">
                      <button onClick={() => finish(t.id, 'completed')} className="px-1.5 py-0.5 text-[9px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 inline-flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />done</button>
                      <button onClick={() => finish(t.id, 'cancelled')} className="px-1.5 py-0.5 text-[9px] rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 inline-flex items-center gap-0.5"><X className="w-3 h-3" />cancel</button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-white">{t.prompt}</div>
                {t.plan.length > 0 && (
                  <ol className="mt-1 ml-3 text-[11px] text-gray-300 space-y-0.5 list-decimal">
                    {t.plan.map((p, i) => <li key={i}><span className="text-[9px] uppercase text-blue-300 mr-1">{p.action}</span>{p.summary}</li>)}
                  </ol>
                )}
                {t.filesChanged?.length > 0 && (
                  <div className="mt-1 text-[10px] text-gray-500">Files changed: {t.filesChanged.join(', ')}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AgentComposerPanel;

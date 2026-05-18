'use client';

/**
 * ChatResearchPanel — Deep Research surface. List of plan-then-execute
 * research runs in the current session. Selecting a run shows the
 * plan + sources + report. Composing a new run kicks off
 * chat.research_start with the LLM-enriched plan when available.
 */

import { useState, useEffect, useCallback } from 'react';
import { callChatMacro } from '@/lib/api/chat-extras';
import { Telescope, X, Loader2, Plus, ListChecks, Link2 } from 'lucide-react';

interface PlanStep { step: number; action: string; expected?: string; }
interface Source { url?: string; title?: string; snippet?: string; }
interface ResearchRun {
  id: string; query: string; status: string;
  step_count: number; created_at: number; completed_at?: number | null;
  plan?: PlanStep[]; sources?: Source[]; report_md?: string | null;
}

interface Props { open: boolean; onClose: () => void; sessionId: string | null; }

export function ChatResearchPanel({ open, onClose, sessionId }: Props) {
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [active, setActive] = useState<ResearchRun | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) { setRuns([]); return; }
    const r = await callChatMacro<{ runs?: ResearchRun[] }>('research_list', { sessionId });
    setRuns(r?.runs || []);
  }, [sessionId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const r = await callChatMacro<{ run?: ResearchRun }>('research_get', { id: active.id });
      if (r?.run) setActive(r.run);
    })();
  }, [active?.id]);

  const startResearch = useCallback(async () => {
    if (!sessionId || !query.trim()) return;
    setBusy(true);
    try {
      const r = await callChatMacro<{ id?: string }>('research_start', { sessionId, query });
      if (r.ok && r.id) {
        setQuery('');
        load();
        const got = await callChatMacro<{ run?: ResearchRun }>('research_get', { id: r.id });
        if (got?.run) setActive(got.run);
      }
    } finally { setBusy(false); }
  }, [sessionId, query, load]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-4xl flex flex-col" style={{ height: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Telescope className="w-4 h-4 text-cyan-400" /> Deep Research
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-3 border-b border-white/10 bg-cyan-500/5 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What should we research?"
            onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) startResearch(); }}
            className="flex-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          />
          <button
            onClick={startResearch}
            disabled={busy || !query.trim()}
            className="px-3 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Plan
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          <aside className="w-60 border-r border-white/10 overflow-y-auto p-2 space-y-0.5">
            {runs.length === 0 ? (
              <div className="text-xs text-white/40 text-center p-4">No research runs yet.</div>
            ) : (
              runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActive(r)}
                  className={`w-full text-left p-2 rounded text-sm ${active?.id === r.id ? 'bg-cyan-500/10 text-cyan-200' : 'text-white/80 hover:bg-white/5'}`}
                >
                  <div className="font-medium truncate">{r.query}</div>
                  <div className="text-xs text-white/40 flex items-center gap-2">
                    <span className={`uppercase ${
                      r.status === 'complete' ? 'text-cyan-300' :
                      r.status === 'executing' ? 'text-amber-300' :
                      r.status === 'failed' ? 'text-red-300' : 'text-white/40'
                    }`}>{r.status}</span>
                    <span>{r.step_count}/{(r.plan?.length || 0) || '?'}</span>
                  </div>
                </button>
              ))
            )}
          </aside>

          <div className="flex-1 overflow-y-auto p-4">
            {!active ? (
              <div className="text-center text-white/40 text-sm py-12">Pick a run on the left or start a new one above.</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-white">{active.query}</h4>
                  <div className="text-xs text-white/40 mt-1">Status: <span className="uppercase">{active.status}</span> · {active.step_count} steps · {new Date(active.created_at * 1000).toLocaleString()}</div>
                </div>

                {active.plan && active.plan.length > 0 && (
                  <section>
                    <h5 className="text-xs uppercase tracking-wide text-white/40 mb-2 flex items-center gap-1"><ListChecks className="w-3 h-3" /> Plan</h5>
                    <ol className="space-y-1">
                      {active.plan.map((s) => (
                        <li key={s.step} className="text-sm text-white/80 flex gap-2 p-2 bg-white/5 rounded">
                          <span className="text-cyan-300 font-mono text-xs mt-0.5">{s.step}.</span>
                          <div className="flex-1">
                            <div>{s.action}</div>
                            {s.expected && <div className="text-xs text-white/40 mt-0.5">Expected: {s.expected}</div>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {active.sources && active.sources.length > 0 && (
                  <section>
                    <h5 className="text-xs uppercase tracking-wide text-white/40 mb-2 flex items-center gap-1"><Link2 className="w-3 h-3" /> Sources</h5>
                    <ul className="space-y-1">
                      {active.sources.map((s, i) => (
                        <li key={i} className="text-sm bg-white/5 rounded p-2">
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200">{s.title || s.url}</a>
                          ) : (
                            <span className="text-white/80">{s.title}</span>
                          )}
                          {s.snippet && <div className="text-xs text-white/60 mt-1">{s.snippet}</div>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {active.report_md && (
                  <section>
                    <h5 className="text-xs uppercase tracking-wide text-white/40 mb-2">Report</h5>
                    <pre className="text-sm text-white/90 whitespace-pre-wrap bg-white/5 rounded p-3">{active.report_md}</pre>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

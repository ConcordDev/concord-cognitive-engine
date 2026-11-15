'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api/client';

export interface PaperSummary {
  problem: string;
  approach: string;
  results: string;
  limitations: string;
  whyItMatters: string;
  keyTerms: string[];
}

interface SavedSummary { id: string; savedAt: string; sourceTitle: string; sourceExcerpt: string; summary: PaperSummary }

export function PaperSummarizer() {
  const [text, setText] = useState('');
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // S6 (F10): summaries persist — saved to the member's list, restored
  // on return, deletable. The output no longer evaporates on a switch.
  const [saved, setSaved] = useState<SavedSummary[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  async function loadSaved() {
    try {
      const res = await api.post('/api/lens/run', { domain: 'paper', action: 'summary-list', input: {} });
      const result = res.data?.result as { summaries?: SavedSummary[] } | undefined;
      setSaved(result?.summaries || []);
    } catch { /* list is best-effort */ }
  }
  useEffect(() => { void loadSaved(); }, []);
  async function saveSummary() {
    if (!summary) return;
    const res = await api.post('/api/lens/run', { domain: 'paper', action: 'summary-save', input: { summary, sourceText: text, sourceTitle: text.trim().split('\n')[0]?.slice(0, 80) } });
    if ((res.data?.result as { ok?: boolean } | undefined)?.ok) { setJustSaved(true); void loadSaved(); }
  }
  async function deleteSaved(id: string) {
    await api.post('/api/lens/run', { domain: 'paper', action: 'summary-delete', input: { id } });
    void loadSaved();
  }

  async function summarize() {
    if (!text.trim() || text.length < 300) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/api/lens/run', { domain: 'paper', action: 'summarize', input: { text } });
      // register("lens","run") wraps ok:true at the transport layer even when
      // the macro itself failed (LLM parse failure, LLM down) — that failure
      // shape ({ ok:false, error }) then lands at res.data.result with no
      // problem/approach/etc fields. Treat that as a real failure instead of
      // rendering an undefined summary (summary.keyTerms.length would throw).
      const result = res.data?.result as (PaperSummary & { ok?: boolean; error?: string }) | undefined;
      if (!result || result.ok === false) {
        setError(result?.error || 'Summarization failed.');
        setSummary(null);
      } else {
        setSummary(result);
        setJustSaved(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Summarization failed.');
      console.error(e);
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Paper summarizer · 5-question structure</span>
      </header>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste paper abstract + introduction (min 300 chars)" rows={14} className="w-full px-3 py-2 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono resize-y" />
          <button onClick={summarize} disabled={loading || text.length < 300} className="w-full py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Summarize
          </button>
        </div>
        <div>
          {error ? (
            <div className="text-xs text-rose-300 bg-rose-950/30 border border-rose-900/50 rounded p-3">{error}</div>
          ) : !summary ? (
            <div className="text-xs text-gray-400 italic text-center py-10">Paste a paper to get a structured summary.</div>
          ) : (
            <div className="space-y-3 text-xs">
              {(['problem', 'approach', 'results', 'limitations', 'whyItMatters'] as const).map(k => (
                <div key={k} className="bg-white/[0.02] rounded p-3">
                  <h3 className="text-[10px] uppercase tracking-wider text-cyan-300 mb-1">{k === 'whyItMatters' ? 'Why it matters' : k}</h3>
                  <p className="text-gray-300">{summary[k]}</p>
                </div>
              ))}
              {summary.keyTerms.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {summary.keyTerms.map((t, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">{t}</span>)}
                </div>
              )}
              <button onClick={() => void saveSummary()} disabled={justSaved} className="px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 text-[11px] disabled:opacity-60">
                {justSaved ? 'Saved ✓ — it stays in your list below' : 'Save summary'}
              </button>
            </div>
          )}
        </div>
      </div>
      {saved.length > 0 && (
        <div className="border-t border-white/10 px-4 py-3">
          <h3 className="text-[10px] uppercase tracking-wider text-cyan-300 mb-2">Your saved summaries ({saved.length})</h3>
          <ul className="space-y-1.5">
            {saved.map(entry => (
              <li key={entry.id} className="flex items-center gap-2 text-[11px]">
                <button onClick={() => { setSummary(entry.summary); setJustSaved(true); }} className="flex-1 text-left text-zinc-300 hover:text-white truncate">
                  {entry.sourceTitle} <span className="text-zinc-400">· {new Date(entry.savedAt).toLocaleString()}</span>
                </button>
                <button onClick={() => void deleteSaved(entry.id)} className="text-rose-300 underline shrink-0">Delete</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
export default PaperSummarizer;

'use client';

import { useState } from 'react';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Finding { label: string; display: string }

const SAMPLES = [
  'Show me critical labs',
  'Any allergies to penicillin?',
  'Recent diabetes notes',
  'High blood pressure?',
];

export function EpicAskBar({ patientId }: { patientId?: string | null }) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    if (!patientId) { setFindings([{ label: 'system', display: 'Select a patient first — chart search needs a patientId.' }]); return; }
    setLoading(true); setFindings(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'healthcare', action: 'ai-chart-search', input: { patientId, query: question } });
      setFindings((r.data?.result?.findings || []) as Finding[]);
    } catch (e) { console.error('[Ask] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 focus-within:border-cyan-500/40">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={patientId ? "Ask anything about the open chart (Epic Conversational Search parity)…" : "Open a chart to enable conversational search…"}
            disabled={!patientId}
            className="flex-1 bg-transparent text-xs text-white placeholder:text-gray-500 outline-none disabled:opacity-50"
          />
          {q && patientId && (
            <button type="submit" disabled={loading} className="text-cyan-300 hover:text-cyan-200 p-0.5">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {SAMPLES.map(s => (
            <button key={s} type="button" onClick={() => { setQ(s); ask(s); }} disabled={!patientId} className="text-[10px] px-2 py-1 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/20 whitespace-nowrap disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
      </form>
      {findings && findings.length > 0 && (
        <div className="bg-cyan-500/[0.06] border border-cyan-500/20 rounded-md px-3 py-2 text-xs text-cyan-100 max-h-40 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 mb-1">{findings.length} finding(s)</div>
          <ul className="space-y-0.5">
            {findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-[9px] uppercase font-mono text-cyan-400 w-16">{f.label}</span>
                <span>{f.display}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {findings && findings.length === 0 && (
        <div className="bg-white/[0.03] border border-white/10 rounded-md px-3 py-2 text-xs text-gray-400">No findings matched the query.</div>
      )}
    </div>
  );
}

export default EpicAskBar;

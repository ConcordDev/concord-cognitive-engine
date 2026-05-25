'use client';

import { useState } from 'react';
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

export function PaperSummarizer() {
  const [text, setText] = useState('');
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [loading, setLoading] = useState(false);

  async function summarize() {
    if (!text.trim() || text.length < 300) return;
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'paper', action: 'summarize', input: { text } });
      setSummary(res.data?.result as PaperSummary || null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
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
          {!summary ? (
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export default PaperSummarizer;

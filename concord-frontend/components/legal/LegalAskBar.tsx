'use client';

import { useState } from 'react';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const SAMPLES = [
  'Show me upcoming deadlines',
  'How much unbilled time?',
  'What is my trust balance?',
  'Open matters?',
];

interface AnswerData {
  upcomingEvents?: unknown[];
  unbilledHours?: number;
  unbilledTime?: number;
  trustBalance?: number;
  openMatters?: number;
  context?: string;
}
interface Answer {
  answer: string;
  data?: AnswerData;
  intent?: string;
}

export function LegalAskBar() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    setLoading(true); setAnswer(null);
    try {
      const ql = question.toLowerCase();
      // Route deterministically to existing macros where we have them
      if (/dead?line|upcoming|hearing|trial|calendar/.test(ql)) {
        const r = await lensRun({ domain: 'legal', action: 'dashboard-summary', input: {} });
        const ev = (r.data?.result?.upcomingEvents || []) as Array<{ title: string; date: string; kind: string }>;
        setAnswer({
          answer: ev.length ? `${ev.length} upcoming event(s): ${ev.slice(0, 3).map(e => `${e.title} (${e.date})`).join('; ')}` : 'No upcoming events scheduled.',
          data: { upcomingEvents: ev },
        });
      } else if (/unbilled|how much.*time|hours/.test(ql)) {
        const r = await lensRun({ domain: 'legal', action: 'dashboard-summary', input: {} });
        const d = r.data?.result;
        setAnswer({ answer: `${d?.unbilledHours || 0} unbilled hours ($${(d?.unbilledTime || 0).toLocaleString()}) across all matters.`, data: d });
      } else if (/trust|iolta|balance/.test(ql)) {
        const r = await lensRun({ domain: 'legal', action: 'trust-balance', input: {} });
        setAnswer({ answer: `Trust balance: $${(r.data?.result?.total || 0).toLocaleString()} across ${r.data?.result?.byMatter?.length || 0} matter ledger(s).`, data: r.data?.result });
      } else if (/open matter|active matter|matters/.test(ql)) {
        const r = await lensRun({ domain: 'legal', action: 'matters-list', input: { status: 'open' } });
        const matters = (r.data?.result?.matters || []) as Array<{ name: string }>;
        setAnswer({ answer: `${matters.length} open matter(s)${matters.length ? `: ${matters.slice(0, 5).map(m => m.name).join('; ')}` : ''}.`, data: { openMatters: matters.length } });
      } else {
        // Long-tail — pass through to legal-question (brain-backed with required not-legal-advice caveat)
        const r = await lensRun({ domain: 'legal', action: 'legal-question', input: { question } });
        const ans = r.data?.result?.answer || 'Could not answer.';
        const caveat = (r.data?.result?.caveats || [])[0] || '';
        setAnswer({ answer: `${ans}${caveat ? `\n\n${caveat}` : ''}`, data: r.data?.result });
      }
    } catch (e) { console.error('[LegalAsk] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 focus-within:border-amber-500/40">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask anything (deadlines, trust balance, unbilled time, or a legal question…)"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-gray-400 outline-none"
          />
          {q && (
            <button type="submit" disabled={loading} className="text-amber-300 hover:text-amber-200 p-0.5">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {SAMPLES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { setQ(s); ask(s); }}
              className="text-[10px] px-2 py-1 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/20 whitespace-nowrap"
            >
              {s}
            </button>
          ))}
        </div>
      </form>
      {answer && (
        <div className="bg-amber-500/[0.06] border border-amber-500/20 rounded-md px-3 py-2 text-xs text-amber-100 flex items-start gap-2 whitespace-pre-wrap">
          <Sparkles className="w-3.5 h-3.5 text-amber-300 mt-0.5 flex-shrink-0" />
          <div>{answer.answer}</div>
        </div>
      )}
    </div>
  );
}

export default LegalAskBar;

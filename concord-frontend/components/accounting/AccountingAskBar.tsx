'use client';

/**
 * AccountingAskBar — JAX/Xero-style "Ask anything about your books" input.
 * Routes free-form questions to /api/lens/run accounting.ask which has
 * deterministic intents for the common ones (overdue, cash, P&L, bills,
 * runway) and falls back to the brain for the long tail.
 */

import { useState } from 'react';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const SAMPLES = [
  'Show me overdue invoices',
  'How much cash do we have?',
  'YTD profit?',
  'What bills are open?',
  'How much runway?',
];

interface Answer {
  intent: string;
  answer: string;
  data?: Record<string, unknown>;
}

export function AccountingAskBar() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer(null);
    try {
      const res = await lensRun({ domain: 'accounting', action: 'ask', input: { question } });
      setAnswer((res.data?.result as Answer) || null);
    } catch (e) { console.error('[ask] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => { e.preventDefault(); ask(q); }}
        className="flex items-center gap-2"
      >
        <div className="flex items-center gap-2 flex-1 bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 focus-within:border-emerald-500/40">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask anything about your books… (e.g. show me overdue invoices)"
            className="flex-1 bg-transparent text-xs text-white placeholder:text-gray-500 outline-none"
          />
          {q && (
            <button type="submit" disabled={loading} className="text-emerald-300 hover:text-emerald-200 p-0.5">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {SAMPLES.map((s) => (
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
        <div className="bg-emerald-500/[0.06] border border-emerald-500/20 rounded-md px-3 py-2 text-xs text-emerald-100 flex items-start gap-2">
          <Sparkles className="w-3.5 h-3.5 text-emerald-300 mt-0.5 flex-shrink-0" />
          <div>
            <div>{answer.answer}</div>
            <div className="text-[10px] text-emerald-400/60 mt-0.5 font-mono">intent: {answer.intent}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountingAskBar;

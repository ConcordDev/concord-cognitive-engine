'use client';

import { useRef, useState } from 'react';
import { Sparkles, Send, Loader2, User as UserIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  source?: string;
}

const SUGGESTIONS = [
  'How much should I be saving for retirement?',
  'Where am I overspending this month?',
  'Should I pay off debt or invest?',
  'What\'s the best way to hit my house-down-payment goal?',
];

export function FinanceAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setInput('');
    setPending(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'assistant-ask', input: { question: q } });
      const answer = (res.data?.result?.answer || '(empty response)') as string;
      const source = (res.data?.result?.source || undefined) as string | undefined;
      setMessages(prev => [...prev, { role: 'assistant', text: answer, source }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${e instanceof Error ? e.message : 'unknown'}`, source: 'error' }]);
    } finally {
      setPending(false);
      setTimeout(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight), 50);
    }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden flex flex-col" style={{ height: 520 }}>
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Finance assistant</span>
        <span className="ml-auto text-[10px] text-gray-400">grounded in your numbers · conscious brain</span>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-xs text-gray-400 py-8">
            <Sparkles className="w-8 h-8 mx-auto mb-3 text-violet-400/40" />
            <p className="mb-3">Ask anything about your finances.</p>
            <div className="space-y-1.5 max-w-md mx-auto">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} className="block w-full text-left px-3 py-2 rounded-md bg-white/[0.03] border border-white/5 text-gray-300 hover:bg-white/[0.06] hover:border-cyan-500/20 hover:text-white text-[11px]">
                  → {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-300 flex-shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-cyan-500/15 text-cyan-100 border border-cyan-500/20' : 'bg-white/[0.03] text-gray-100 border border-white/5'}`}>
              {m.text}
              {m.source && m.role === 'assistant' && (
                <div className="mt-1.5 text-[9px] text-gray-400 uppercase tracking-wider">{m.source}</div>
              )}
            </div>
            {m.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-300 flex-shrink-0">
                <UserIcon className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        ))}
        {pending && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-300"><Sparkles className="w-3.5 h-3.5" /></div>
            <div className="rounded-lg px-3 py-2 bg-white/[0.03] border border-white/5 inline-flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      <form onSubmit={e => { e.preventDefault(); send(input); }} className="border-t border-white/10 p-2 flex items-center gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about your finances…" disabled={pending} className="flex-1 px-3 py-2 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button aria-label="Send" type="submit" disabled={pending || !input.trim()} className="p-2 rounded bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40">
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}

export default FinanceAssistant;

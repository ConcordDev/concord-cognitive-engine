'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Loader2, RotateCcw, BookOpen, Lightbulb } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Message {
  role: 'student' | 'tutor';
  content: string;
  ts: number;
}

interface SocraticTutorProps {
  subject?: string;
  level?: string;
  context?: string;
  className?: string;
}

/**
 * Khanmigo-style Socratic tutor. The brain (Concord conscious) is
 * constrained to NEVER give direct answers — it asks scaffolded
 * questions, suggests next steps, and identifies prerequisite gaps.
 * Hints are 3-tier: prompt → nudge → reveal-step.
 */
export function SocraticTutor({ subject = 'general', level = 'high school', context, className }: SocraticTutorProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [hintLevel, setHintLevel] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        role: 'tutor',
        content: `Hi! I'm here to help you think through ${subject} problems. I won't just give you answers — I'll guide you to discover them. What are you working on?`,
        ts: Date.now(),
      }]);
    }
  }, [messages.length, subject]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [messages]);

  const send = useCallback(async (content?: string) => {
    const text = (content ?? draft).trim();
    if (!text || pending) return;
    const userMsg: Message = { role: 'student', content: text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setDraft('');
    setPending(true);
    try {
      const res = await lensRun({
        domain: 'education',
        action: 'tutor-ask',
        input: {
          subject, level,
          context: context || '',
          hintLevel,
          history: messages.concat(userMsg).map(m => ({ role: m.role, content: m.content })),
        },
      });
      const reply = String(res.data?.result?.text || res.data?.result?.content || '').trim();
      const next: Message = { role: 'tutor', content: reply || '(no response — try again)', ts: Date.now() };
      setMessages(prev => [...prev, next]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'tutor', content: `Error: ${e instanceof Error ? e.message : 'request failed'}`, ts: Date.now() }]);
    } finally { setPending(false); }
  }, [draft, pending, subject, level, context, hintLevel, messages]);

  function reset() {
    setMessages([]);
    setHintLevel(1);
  }

  function escalateHint() {
    const next = Math.min(3, hintLevel + 1);
    setHintLevel(next);
    const ask = next === 2
      ? 'Could you give me a small nudge?'
      : 'I am still stuck. Can you walk me through the next step?';
    send(ask);
  }

  return (
    <div className={cn('bg-[#0d1117] border border-purple-500/30 rounded-lg overflow-hidden flex flex-col', className || 'h-[600px]')}>
      <header className="px-4 py-2 border-b border-white/10 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-bold text-purple-300">Socratic tutor</span>
        <span className="text-[10px] text-gray-500">{subject} · {level}</span>
        <span className={cn('ml-auto text-[10px] px-1.5 py-0.5 rounded font-bold',
          hintLevel === 1 ? 'bg-green-500/20 text-green-300' :
          hintLevel === 2 ? 'bg-yellow-500/20 text-yellow-300' :
          'bg-orange-500/20 text-orange-300'
        )}>
          Hint tier {hintLevel}/3
        </span>
        <button
          onClick={reset}
          title="Reset"
          className="p-1 text-gray-400 hover:text-white"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m, i) => {
          const isStudent = m.role === 'student';
          return (
            <div key={i} className={cn('flex flex-col gap-1', isStudent ? 'items-end' : 'items-start')}>
              <div className="text-[9px] uppercase tracking-wider text-gray-600">{isStudent ? 'you' : 'tutor'}</div>
              <div className={cn(
                'max-w-[90%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap',
                isStudent ? 'bg-cyan-500/10 border border-cyan-500/30 text-gray-100' : 'bg-white/[0.03] border border-white/10 text-gray-200',
              )}>
                {m.content}
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-3 h-3 animate-spin" /> Thinking…
          </div>
        )}
      </div>
      <footer className="border-t border-white/10 p-3 space-y-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={2}
          placeholder='Ask a question or show your work…'
          disabled={pending}
          className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white resize-none"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => send()}
            disabled={!draft.trim() || pending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-purple-500 hover:bg-purple-400 text-white font-bold disabled:opacity-40"
          >
            <Send className="w-3 h-3" /> Ask
          </button>
          {messages.length > 1 && (
            <button
              onClick={escalateHint}
              disabled={pending || hintLevel >= 3}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-40"
              title="Get a deeper hint"
            >
              <Lightbulb className="w-3 h-3" /> Bigger hint
            </button>
          )}
          {context && (
            <span className="ml-auto text-[10px] text-gray-500 inline-flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> Lesson context loaded
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

export default SocraticTutor;

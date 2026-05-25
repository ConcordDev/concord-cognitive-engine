'use client';

/**
 * MhCompanionPanel — supportive, non-clinical check-in chat (Wysa-style).
 * Backed by the conscious brain via the `companion-chat` macro. Surfaces a
 * crisis line whenever the message risk-scan flags self-harm intent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, MessageCircleHeart, RotateCcw, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Turn { role: string; content: string; at: string; riskFlag?: boolean }

export function MhCompanionPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mental-health', 'companion-history', {});
    setTurns(r.data?.result?.turns || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [turns]);

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    const r = await lensRun('mental-health', 'companion-chat', { message });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); setSending(false); return; }
    setDraft('');
    await refresh();
    setSending(false);
  };

  const reset = async () => {
    await lensRun('mental-health', 'companion-reset', {});
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const riskActive = turns.some((t) => t.riskFlag);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <MessageCircleHeart className="w-3.5 h-3.5 text-sky-400" /> Check-in companion
        </h3>
        {turns.length > 0 && (
          <button type="button" onClick={reset}
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-300">
            <RotateCcw className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {riskActive && (
        <div className="flex items-start gap-2 bg-rose-950/50 border border-rose-800/60 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-rose-200">
            If you are in danger or thinking of harming yourself, call or text <strong>988</strong> (US Suicide &amp; Crisis Lifeline) or your local emergency number now. You are not alone.
          </p>
        </div>
      )}

      <div ref={scrollRef} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2 max-h-72 overflow-y-auto">
        {turns.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">
            This is a quiet space to put feelings into words. Say what is on your mind.
          </p>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-xl px-3 py-1.5 text-xs leading-relaxed',
                t.role === 'user'
                  ? 'bg-sky-600 text-white'
                  : t.riskFlag ? 'bg-rose-950/60 border border-rose-800/60 text-rose-100' : 'bg-zinc-800 text-zinc-100')}>
                {t.content}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-1">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="How are you feeling?"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={send} disabled={sending || !draft.trim()}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg">
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-[10px] text-zinc-400 italic">For reflection only — not a therapist and not medical advice.</p>
    </div>
  );
}

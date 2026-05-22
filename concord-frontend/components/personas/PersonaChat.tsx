'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PersonaChat — interactive in-lens chat preview, Character.AI's core loop.
 * Wires personas.chat_open + personas.chat_send. Replies are composed by the
 * backend deterministic engine from the persona's authored fields.
 */

import { useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface Turn { role: string; text: string; at: number; basis?: string }

export function PersonaChat({
  personaId,
  personaName,
  portrait,
}: {
  personaId: string;
  personaName: string;
  portrait?: string;
}) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('personas', 'chat_open', { personaId });
      if (cancelled) return;
      if (r.data?.ok) {
        const res = r.data.result as any;
        setChatId(res.chatId);
        setTurns(res.turns || []);
      } else {
        setErr(r.data?.error || 'chat_open_failed');
      }
    })();
    return () => { cancelled = true; };
  }, [personaId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const send = async () => {
    const message = draft.trim();
    if (!message || !chatId || busy) return;
    setBusy(true);
    setErr(null);
    setTurns((t) => [...t, { role: 'user', text: message, at: Date.now() / 1000 }]);
    setDraft('');
    const r = await lensRun('personas', 'chat_send', { chatId, message });
    setBusy(false);
    if (r.data?.ok) {
      const res = r.data.result as any;
      setTurns((t) => [...t, res.reply as Turn]);
    } else {
      setErr(r.data?.error || 'send_failed');
    }
  };

  return (
    <div className="flex flex-col h-[460px] rounded-xl border border-purple-800/50 bg-zinc-950/60">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        {portrait && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={portrait} alt={personaName} className="h-8 w-8 rounded-lg" />
        )}
        <div>
          <div className="text-sm font-semibold text-zinc-100">{personaName}</div>
          <div className="text-[10px] text-zinc-500">Chat preview</div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                t.role === 'user'
                  ? 'bg-purple-700 text-white'
                  : 'bg-zinc-800 text-zinc-100'
              }`}
            >
              {t.text}
              {t.role === 'persona' && t.basis && (
                <div className="mt-1 text-[9px] uppercase tracking-wider text-zinc-500">
                  {t.basis.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-[11px] text-zinc-500 italic">{personaName} is typing…</div>}
      </div>

      {err && (
        <div className="px-3 py-1 text-[11px] text-red-300">{err}</div>
      )}

      <div className="flex gap-2 border-t border-zinc-800 p-2">
        <input
          type="text" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
          placeholder={`Message ${personaName}…`}
          disabled={!chatId}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
        />
        <button
          type="button" onClick={send} disabled={!chatId || busy || !draft.trim()}
          className="px-4 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded-lg"
        >Send</button>
      </div>
    </div>
  );
}

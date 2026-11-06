'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PersonaChat — interactive in-lens chat preview, Character.AI's core loop.
 * Wires personas.chat_open + personas.chat_send + personas.chat_history.
 * The chat id is kept per persona (sessionStorage) and the conversation is
 * resumed from the server's record on mount — the server keeps every chat;
 * only "New chat" starts a fresh one. Replies are an exact authored
 * example when one matches, otherwise model-generated in character; if no model
 * is reachable the send fails visibly.
 */

import { useEffect, useRef, useState } from 'react';
import { runPersona } from './persona-envelope';

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
  const storageKey = `concord:personas:chat:${personaId}`;

  const openFresh = async () => {
    const r = await runPersona('chat_open', { personaId });
    if (r.ok) {
      const res = r.data as any;
      setChatId(res.chatId);
      setTurns(res.turns || []);
      try { sessionStorage.setItem(storageKey, res.chatId); } catch { /* storage unavailable */ }
      setErr(null);
    } else {
      setErr(r.error || 'chat_open_failed');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resume the conversation this surface already hosted, if the
      // server still holds it; a stale id falls through to a fresh open.
      let stored: string | null = null;
      try { stored = sessionStorage.getItem(storageKey); } catch { stored = null; }
      if (stored) {
        const h = await runPersona('chat_history', { chatId: stored });
        if (cancelled) return;
        if (h.ok) {
          const res = h.data as any;
          setChatId(res.chatId);
          setTurns(res.turns || []);
          return;
        }
      }
      if (!cancelled) await openFresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId]);

  const newChat = async () => {
    try { sessionStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    setChatId(null);
    setTurns([]);
    await openFresh();
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const send = async () => {
    const message = draft.trim();
    if (!message || !chatId || busy) return;
    setBusy(true);
    setErr(null);
    // Optimistic: show the user's turn instantly (real fact — it was sent).
    const optimistic: Turn = { role: 'user', text: message, at: Date.now() / 1000 };
    setTurns((t) => [...t, optimistic]);
    setDraft('');
    const r = await runPersona('chat_send', { chatId, message });
    setBusy(false);
    if (r.ok) {
      const res = r.data as any;
      setTurns((t) => [...t, res.reply as Turn]);
    } else {
      // Honest rollback: the send genuinely failed, so remove the optimistic
      // turn instead of leaving a message that never reached the persona.
      setTurns((t) => t.filter((turn) => turn !== optimistic));
      setDraft(message);
      setErr(r.error || 'send_failed');
    }
  };

  return (
    <div className="flex flex-col h-[460px] rounded-xl border border-purple-800/50 bg-zinc-950/60">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        {portrait && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={portrait} alt={personaName} className="h-8 w-8 rounded-lg" />
        )}
        <div className="flex-1">
          <div className="text-sm font-semibold text-zinc-100">{personaName}</div>
          <div className="text-[10px] text-zinc-400">Chat preview</div>
        </div>
        <button
          type="button" onClick={() => void newChat()}
          className="text-[11px] px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
        >New chat</button>
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
                <div className="mt-1 text-[9px] uppercase tracking-wider text-zinc-400">
                  {t.basis.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-[11px] text-zinc-400 italic">{personaName} is typing…</div>}
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

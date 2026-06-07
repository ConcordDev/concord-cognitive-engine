'use client';

// concord-frontend/components/conkay/ConKayOverlay.tsx
//
// ConKay, summonable on ANY lens — the cross-lens "take over and operate" surface
// (the Tony↔JARVIS interaction). This is the differentiator no other JARVIS clone
// has: it doesn't screen-scrape and it isn't limited to pre-wired per-app actions.
// It operates the host lens by calling that lens's REAL macros through Concord's
// unified action contract (`/api/lens/run` via `lensRun`), with the global ConKay
// skills available everywhere, voice, and the world-tree presence.
//
// Summon: Cmd/Ctrl+J anywhere, or dispatch `window` event 'conkay:summon'. Esc to
// dismiss. Self-contained (no store coupling) so it can mount once in the lens
// shell and ride over whatever lens you're on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { X, Send, Mic, MicOff, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { ConKayMessage, type ConKayReplyFields } from './ConKayViz';
import { useConKayVoice } from './useConKayVoice';
import { matchConKaySkill, type ConKaySkill } from './conkay-skills';
import type { ConKayState } from './conkay-persona';
import { getLensById } from '@/lib/lens-registry';
import { lensRun } from '@/lib/api/client';
import MessageRenderer from '@/components/chat/MessageRenderer';

// The world-tree field is WebGL — load client-only so SSR never touches it.
const ConKayBackdrop = dynamic(
  () => import('./ConKayBackdrop').then((m) => m.ConKayBackdrop),
  { ssr: false },
);

interface OverlayMsg extends ConKayReplyFields {
  id: string;
  role: 'user' | 'assistant';
}

function stripFence(s: string): string {
  return (s || '').replace(/```conkay-viz[\s\S]*?```/gi, '').trim();
}

// Active lens id from the path. The macro DOMAIN is, by Concord convention, the
// lens id for the great majority of lenses (music→music, accounting→accounting…).
function activeLensFromPath(pathname: string | null): { id: string; name: string } | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/lenses\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  const entry = getLensById(id);
  return { id, name: entry?.name || id };
}

export function ConKayOverlay() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<OverlayMsg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const spokeRef = useRef<string | null>(null);

  const lens = activeLensFromPath(pathname);
  // ConKay should not double up inside the chat lens (which has its own ConKay mode).
  const onChatLens = lens?.id === 'chat';

  // ── summon / dismiss ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    const onSummon = () => setOpen(true);
    const onDismiss = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('conkay:summon', onSummon);
    window.addEventListener('conkay:dismiss', onDismiss);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('conkay:summon', onSummon);
      window.removeEventListener('conkay:dismiss', onDismiss);
    };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const append = useCallback((m: OverlayMsg) => setMessages((prev) => [...prev, m]), []);

  // ── voice ───────────────────────────────────────────────────────────
  const voice = useConKayVoice({
    enabled: open,
    muted,
    onFinalTranscript: (t) => submit(t),
  });

  // Speak each new assistant reply once (fence stripped so no JSON read aloud).
  useEffect(() => {
    if (!open) return;
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last || last.id === spokeRef.current) return;
    spokeRef.current = last.id;
    if (!muted) voice.speak(stripFence(last.content));
  }, [messages, open, muted, voice]);

  // Greeting on summon.
  const greetedRef = useRef(false);
  useEffect(() => {
    if (!open) { greetedRef.current = false; return; }
    if (greetedRef.current) return;
    greetedRef.current = true;
    const where = lens && !onChatLens ? ` I'm on the ${lens.name} lens with you — tell me what to do, or say "brief me".` : " Ask me anything, or say \"brief me\".";
    if (!muted) voice.speak(`Kay here.${where}`);
  }, [open, lens, onChatLens, muted, voice]);

  const conkayState: ConKayState =
    running ? 'processing'
      : voice.speaking ? 'presenting'
        : voice.listening ? 'listening'
          : 'idle';

  // ── run a global skill ──────────────────────────────────────────────
  const runSkill = useCallback(async (text: string, match: { skill: ConKaySkill; args: Record<string, string> }) => {
    append({ id: `u-${Date.now()}`, role: 'user', content: text });
    setInput('');
    setRunning(true);
    try {
      const result = await match.skill.run(match.args, {
        apiBase: process.env.NEXT_PUBLIC_API_URL || '',
        fetchJson: async (path: string) => {
          try {
            const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}${path}`, { credentials: 'include' });
            return await r.json();
          } catch { return null; }
        },
      });
      const fence = result.viz ? `\n\n\`\`\`conkay-viz\n${JSON.stringify(result.viz)}\n\`\`\`` : '';
      append({ id: `a-${Date.now()}`, role: 'assistant', content: `${result.spoken}${fence}`, dtuRefs: result.dtuRefs, sources: result.sources, toolCalls: result.toolCalls, brain: 'kay' });
      if (result.navigate) { const dest = result.navigate; setTimeout(() => { window.location.href = dest; }, 900); }
    } catch {
      append({ id: `a-${Date.now()}`, role: 'assistant', content: 'I hit a snag running that — mind trying again?' });
    } finally {
      setRunning(false);
    }
  }, [append]);

  // ── operate the active lens by calling its real macro ───────────────
  const runLensMacro = useCallback(async (domain: string, macro: string, inputObj: Record<string, unknown>) => {
    append({ id: `u-${Date.now()}`, role: 'user', content: `run ${domain}.${macro}` });
    setInput('');
    setRunning(true);
    try {
      const { data } = await lensRun(domain, macro, inputObj);
      const ok = !!data?.ok;
      const resultStr = data?.result != null ? JSON.stringify(data.result, null, 2) : (ok ? '(done)' : (data?.error || 'no result'));
      const spoken = ok ? `Ran ${macro} on the ${domain} lens.` : `${macro} on ${domain} returned: ${data?.error || 'an error'}.`;
      const body = resultStr.length > 1200 ? resultStr.slice(0, 1200) + '\n…' : resultStr;
      append({
        id: `a-${Date.now()}`, role: 'assistant',
        content: `${spoken}\n\n\`\`\`json\n${body}\n\`\`\``,
        toolCalls: [{ tool: `${domain}.${macro}`, params: inputObj, result: data?.result ?? null, ok }],
        brain: 'kay',
      });
    } catch {
      append({ id: `a-${Date.now()}`, role: 'assistant', content: `I couldn't run ${domain}.${macro} just now.` });
    } finally {
      setRunning(false);
    }
  }, [append]);

  // ── command routing ─────────────────────────────────────────────────
  function submit(raw: string) {
    const t = (raw || '').trim();
    if (!t || running) return;
    // 1) a global ConKay skill (brief / search / activity / world / open / help)
    const m = matchConKaySkill(t);
    if (m) { runSkill(t, m); return; }
    // 2) operate THIS lens: "run <macro> [jsonInput]" → its real macro
    const rm = t.match(/^run\s+(?:([a-zA-Z0-9_-]+)\.)?([a-zA-Z0-9_-]+)\s*(\{[\s\S]*\})?$/i);
    if (rm && lens) {
      const domain = rm[1] || lens.id;
      const macro = rm[2];
      let inp: Record<string, unknown> = {};
      if (rm[3]) { try { inp = JSON.parse(rm[3]); } catch { /* leave empty */ } }
      runLensMacro(domain, macro, inp);
      return;
    }
    // 3) honest fallback (free-text → lens macro needs the brains; that's the
    //    documented follow-on). Guide the user to what works now.
    append({ id: `u-${Date.now()}`, role: 'user', content: t });
    setInput('');
    const hint = lens && !onChatLens
      ? `I'm on the ${lens.name} lens. Right now I can run its actions directly — try "run <action>" (e.g. run ${lens.id}.list) — or ask me to "brief me", "search my archive for …", or "open <lens>". Full natural-language control of this lens is coming as the brains come online.`
      : `Try "brief me", "search my archive for …", "show my activity", "open <lens>", or "what can you do".`;
    append({ id: `a-${Date.now()}`, role: 'assistant', content: hint, brain: 'kay' });
  }

  const onSubmitForm = (e: React.FormEvent) => { e.preventDefault(); submit(input); };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" role="dialog" aria-modal="true" aria-label="ConKay">
      {/* world-tree presence */}
      <ConKayBackdrop state={conkayState} listening={voice.listening} muted={muted} className="pointer-events-none absolute inset-0 -z-10" />
      <div className="absolute inset-0 -z-10 bg-black/55 backdrop-blur-sm" aria-hidden onClick={() => setOpen(false)} />

      {/* header */}
      <div className="flex items-center gap-3 px-5 py-3 text-cyan-100">
        <Sparkles className="h-5 w-5 text-cyan-300" />
        <span className="text-sm font-semibold tracking-wide">ConKay</span>
        {lens && !onChatLens && (
          <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 text-[11px] text-cyan-200">
            Operating: {lens.name}
          </span>
        )}
        <span className="ml-2 text-[11px] text-cyan-300/60">
          {conkayState === 'listening' ? 'listening…' : conkayState === 'processing' ? 'working…' : conkayState === 'presenting' ? 'speaking…' : 'ready'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setMuted((x) => !x)} title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}
            className="rounded-lg p-2 text-cyan-200 hover:bg-cyan-400/10">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button onClick={() => setOpen(false)} title="Dismiss (Esc)" aria-label="Dismiss"
            className="rounded-lg p-2 text-cyan-200 hover:bg-cyan-400/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* transcript */}
      <div className="flex-1 overflow-y-auto px-5">
        <div className="mx-auto max-w-2xl space-y-3 py-2">
          {messages.length === 0 && (
            <div className="mt-10 text-center text-sm text-cyan-100/70">
              {lens && !onChatLens
                ? <>I'm on the <span className="text-cyan-200">{lens.name}</span> lens with you. Tell me what to do — or “brief me”.</>
                : <>Ask me anything — “brief me”, “search my archive for …”, “open music”.</>}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={m.role === 'user'
                ? 'max-w-[80%] rounded-2xl rounded-br-md bg-cyan-500/15 border border-cyan-400/25 px-3.5 py-2 text-sm text-cyan-50'
                : 'max-w-[85%] rounded-2xl rounded-bl-md bg-black/40 border border-cyan-400/15 px-3.5 py-2 text-sm text-cyan-50'}>
                {m.role === 'assistant'
                  ? <ConKayMessage fields={m} renderProse={(t) => <MessageRenderer content={t} />} />
                  : m.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} aria-hidden />
        </div>
      </div>

      {/* command bar */}
      <form onSubmit={onSubmitForm} className="px-5 pb-5 pt-2">
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-cyan-400/25 bg-black/50 px-3 py-2 backdrop-blur">
          {voice.supported && (
            <button type="button" onClick={() => setMuted((x) => !x)}
              title={muted ? 'Voice off — click to enable' : voice.listening ? 'Listening…' : 'Voice on'} aria-label="Toggle voice"
              className={`rounded-lg p-2 ${voice.listening ? 'bg-cyan-400/20 text-cyan-200' : muted ? 'text-cyan-300/40' : 'text-cyan-300 hover:bg-cyan-400/10'}`}>
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={lens && !onChatLens ? `Ask Kay to operate the ${lens.name} lens…` : 'Ask Kay…'}
            className="flex-1 bg-transparent text-sm text-cyan-50 placeholder:text-cyan-200/40 outline-none"
            aria-label="Message ConKay"
          />
          <button type="submit" disabled={!input.trim() || running}
            className="rounded-lg bg-cyan-500 p-2 text-black disabled:opacity-40" aria-label="Send">
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mx-auto mt-1.5 max-w-2xl text-center text-[10px] text-cyan-200/40">
          ⌘/Ctrl+J to summon Kay on any lens · Esc to dismiss
        </p>
      </form>
    </div>
  );
}

export default ConKayOverlay;

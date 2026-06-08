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
import { ConKayWorkStatus, type WorkStep } from './ConKayWorkStatus';
import { useConkayHudStore } from './conkayHudStore';
import type { ConKayState } from './conkay-persona';
import { getLensById } from '@/lib/lens-registry';
import { lensRun } from '@/lib/api/client';
import { subscribe, connectSocket } from '@/lib/realtime/socket';
import MessageRenderer from '@/components/chat/MessageRenderer';

// A correlation id for one macro run. Passed to lensRun → sent as
// x-conkay-run-id → echoed back on the macro:started/completed events so the
// HUD can bind a step to the REAL backend call (never a guessed spinner).
function newRunId(): string {
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

// A live telemetry chip — every value here is a pure function of the real
// macro:* lifecycle (via the HUD store), never a guess. While a real macro is in
// flight it reads "● live · domain.action"; on completion it shows the actual
// returned facts (ok/failed + the elapsed ms the backend reported).
function ConKayTelemetryChip() {
  const inFlight = useConkayHudStore((s) => s.inFlight);
  const activeLabel = useConkayHudStore((s) => s.activeLabel);
  const last = useConkayHudStore((s) => s.last);
  if (inFlight > 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200" title="A real backend macro is in flight">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
        live · {activeLabel ?? 'backend'}
      </span>
    );
  }
  if (last) {
    return (
      <span
        className={`rounded-full border px-2 py-0.5 text-[11px] ${last.ok ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-rose-400/30 bg-rose-400/10 text-rose-200'}`}
        title="Last real macro result reported by the backend"
      >
        {last.domain}.{last.action} · {last.ok ? 'ok' : 'failed'}{last.ms != null ? ` · ${last.ms} ms` : ''}
      </span>
    );
  }
  return null;
}

export function ConKayOverlay() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<OverlayMsg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  // Work-animation state: a live status line + a step spine that resolves as
  // ConKay works (the JARVIS "you can see it building" surface).
  const [steps, setSteps] = useState<WorkStep[]>([]);
  const [workStatus, setWorkStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const spokeRef = useRef<string | null>(null);
  // The correlation id of the macro run currently in flight. The lifecycle
  // subscription below only reacts to events tagged with this id.
  const liveRunRef = useRef<string | null>(null);

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
  }, [messages.length, steps, workStatus]);

  // ── honest event spine ──────────────────────────────────────────────
  // The ONE rule: every animated beat is a pure function of a REAL backend
  // event. While ConKay is open we subscribe to the macro lifecycle the server
  // emits to our user:<id> room and bind a step (keyed by the run's correlation
  // id) to it: it lights when the backend reports the call *started* and
  // resolves when it reports *completed* — with the real elapsed ms. No
  // setInterval, no eased fake percentage. If the socket is offline the step
  // simply never appears; the await-bound choreography below still tells the
  // story (also real — the call literally returned).
  useEffect(() => {
    if (!open) return;
    connectSocket();
    const offStart = subscribe<{ runId?: string; domain?: string; action?: string }>(
      'macro:started',
      (d) => {
        if (!d?.runId || d.runId !== liveRunRef.current) return;
        const label = `Running ${d.domain ?? '?'}.${d.action ?? '?'} on the backend`;
        setWorkStatus(`Backend running ${d.domain ?? '?'}.${d.action ?? '?'}…`);
        setSteps((prev) =>
          prev.some((s) => s.id === d.runId)
            ? prev
            : [...prev, { id: d.runId!, label, state: 'active' as const }],
        );
        // Feed the honest HUD store (its ONLY writer) — the scene's rings spin
        // iff a real macro is in flight; this is that signal.
        useConkayHudStore.getState().macroStarted({ runId: d.runId, domain: d.domain, action: d.action });
      },
    );
    const offDone = subscribe<{ runId?: string; domain?: string; action?: string; ok?: boolean; ms?: number; error?: string }>(
      'macro:completed',
      (d) => {
        if (!d?.runId || d.runId !== liveRunRef.current) return;
        const failed = d.ok === false;
        const ms = typeof d.ms === 'number' ? ` in ${d.ms} ms` : '';
        const label = `${d.domain ?? '?'}.${d.action ?? '?'} ${failed ? 'failed' : 'completed'}${ms}`;
        setSteps((prev) =>
          prev.map((s) => (s.id === d.runId ? { ...s, state: failed ? ('error' as const) : ('done' as const), label } : s)),
        );
        setWorkStatus(failed ? 'Backend returned an error' : `Completed${ms}`);
        // Telemetry the HUD shows is the REAL returned facts (ok + elapsed ms).
        useConkayHudStore.getState().macroCompleted({ runId: d.runId, domain: d.domain, action: d.action, ok: d.ok, ms: d.ms });
      },
    );
    // Resetting on teardown clears any in-flight count so the rings never spin
    // after ConKay closes (no orphaned "work" with nothing running).
    return () => { offStart(); offDone(); useConkayHudStore.getState().reset(); };
  }, [open]);

  const append = useCallback((m: OverlayMsg) => setMessages((prev) => [...prev, m]), []);

  // Work-step helpers — set the plan, then advance each step's state as ConKay
  // works. `setStep` flips one step; `beginWork`/`clearWork` bracket a task.
  const beginWork = useCallback((status: string, plan: WorkStep[]) => { setWorkStatus(status); setSteps(plan); }, []);
  const setStep = useCallback((id: string, state: WorkStep['state'], status?: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state } : s)));
    if (status) setWorkStatus(status);
  }, []);
  const clearWork = useCallback(() => { setTimeout(() => { setSteps([]); setWorkStatus(''); }, 1400); }, []);

  // ── verification climax (Track B / Phase 1) ──────────────────────────
  // Run a reply's citations through the REAL reason.verify macro and stamp the
  // verdict onto the message — so the TrustBadge shows the actual verification
  // result (citations resolve / grounded / unsupported / fabricated_citation),
  // never a heuristic guess. "Verification IS the product." Rides the honest
  // event spine (a runId) like any other macro call; degrades silently to the
  // heuristic badge if the macro is unavailable.
  const verifyMessage = useCallback(async (msgId: string, claim: string, citationIds: string[]) => {
    if (!citationIds.length) return;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, verifyVerdict: 'pending' } : m)));
    try {
      const rid = newRunId();
      liveRunRef.current = rid;
      const { data } = await lensRun('reason', 'verify', { claim, citations: citationIds }, rid);
      const res = data?.result as { verdict?: string } | null;
      const verdict = res && typeof res === 'object' && res.verdict ? String(res.verdict) : 'unverified';
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, verifyVerdict: verdict } : m)));
    } catch {
      // verification unavailable → drop the pending state, fall back to the heuristic badge
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, verifyVerdict: undefined } : m)));
    }
  }, []);

  // Persist a revisitable artifact of what ConKay did — the task + its work +
  // result — as a DTU in the user's locker (fire-and-forget; never blocks the UX).
  // "show its work and the task it was provided" → a real, reopenable record.
  const persistArtifact = useCallback((title: string, work: Record<string, unknown>) => {
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || '';
      fetch(`${base}/api/dtus`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `ConKay · ${title}`.slice(0, 120),
          content: `**ConKay task artifact**\n\n\`\`\`json\n${JSON.stringify(work, null, 2)}\n\`\`\``,
          tags: ['conkay', 'artifact', work.lens ? `lens:${work.lens}` : ''].filter(Boolean),
          kind: 'conkay_artifact',
        }),
      }).catch(() => {});
    } catch { /* never throws */ }
  }, []);

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
    beginWork(`Understood — ${match.skill.label}`, [
      { id: 'parse', label: `Recognised: ${match.skill.label}`, state: 'done' },
      { id: 'gather', label: 'Gathering from your data…', state: 'active' },
      { id: 'render', label: 'Rendering the result', state: 'pending' },
    ]);
    try {
      const result = await match.skill.run(match.args, {
        apiBase: process.env.NEXT_PUBLIC_API_URL || '',
        fetchJson: async (path: string) => {
          try {
            const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}${path}`, { credentials: 'include' });
            return await r.json();
          } catch { return null; }
        },
        // Lets a skill delegate to a real deterministic backend engine (e.g. the
        // math CAS) via the unified macro contract instead of LLM-reasoning.
        // Each delegated call opts into the honest lifecycle so the spine binds
        // to the REAL backend macro:started/completed for that computation.
        runMacro: async (domain: string, name: string, input: Record<string, unknown>) => {
          try {
            const rid = newRunId();
            liveRunRef.current = rid;
            const { data } = await lensRun(domain, name, input, rid);
            return data;
          } catch { return null; }
        },
      });
      setStep('gather', 'done', 'Composing the answer');
      setStep('render', 'active');
      const fence = result.viz ? `\n\n\`\`\`conkay-viz\n${JSON.stringify(result.viz)}\n\`\`\`` : '';
      const aid = `a-${Date.now()}`;
      append({ id: aid, role: 'assistant', content: `${result.spoken}${fence}`, dtuRefs: result.dtuRefs, sources: result.sources, toolCalls: result.toolCalls, brain: 'kay' });
      setStep('render', 'done', 'Done');
      // Phase 1: verify the cited DTUs through the real reason.verify macro.
      const citeIds = (result.dtuRefs || []).map((d) => d.id).filter(Boolean);
      if (citeIds.length) verifyMessage(aid, result.spoken, citeIds);
      persistArtifact(`Skill: ${match.skill.label}`, { task: text, skill: match.skill.id, spoken: result.spoken, viz: result.viz ?? null });
      if (result.navigate) { const dest = result.navigate; setTimeout(() => { window.location.href = dest; }, 900); }
    } catch {
      setStep('render', 'error', 'Hit a snag');
      append({ id: `a-${Date.now()}`, role: 'assistant', content: 'I hit a snag running that — mind trying again?' });
    } finally {
      setRunning(false);
      clearWork();
    }
  }, [append, persistArtifact, beginWork, setStep, clearWork, verifyMessage]);

  // ── execute a lens macro (shared by explicit "run X" + the NL resolver) ──
  const executeMacro = useCallback(async (domain: string, macro: string, inputObj: Record<string, unknown>, preface?: string) => {
    if (preface) append({ id: `a-${Date.now()}-p`, role: 'assistant', content: preface, brain: 'kay' });
    try {
      // Opt into the honest lifecycle: the server will emit macro:started/
      // completed tagged with this id to our room, lighting the spine step.
      const rid = newRunId();
      liveRunRef.current = rid;
      const { data } = await lensRun(domain, macro, inputObj, rid);
      const ok = !!data?.ok;
      const resultStr = data?.result != null ? JSON.stringify(data.result, null, 2) : (ok ? '(done)' : (data?.error || 'no result'));
      const spoken = ok ? `Done — ran ${macro} on the ${domain} lens.` : `${macro} on ${domain} returned: ${data?.error || 'an error'}.`;
      const body = resultStr.length > 1200 ? resultStr.slice(0, 1200) + '\n…' : resultStr;
      append({
        id: `a-${Date.now()}`, role: 'assistant',
        content: `${spoken}\n\n\`\`\`json\n${body}\n\`\`\``,
        toolCalls: [{ tool: `${domain}.${macro}`, params: inputObj, result: data?.result ?? null, ok }],
        brain: 'kay',
      });
      // Persist a revisitable artifact of the task + its work to the DTU locker.
      persistArtifact(`Operated ${domain}.${macro}`, {
        task: preface || `run ${domain}.${macro}`,
        lens: domain, macro, input: inputObj, ok, result: data?.result ?? null,
      });
      return ok;
    } catch {
      append({ id: `a-${Date.now()}`, role: 'assistant', content: `I couldn't run ${domain}.${macro} just now.` });
      return false;
    }
  }, [append, persistArtifact]);

  const runLensMacro = useCallback(async (domain: string, macro: string, inputObj: Record<string, unknown>) => {
    append({ id: `u-${Date.now()}`, role: 'user', content: `run ${domain}.${macro}` });
    setInput('');
    setRunning(true);
    try { await executeMacro(domain, macro, inputObj); } finally { setRunning(false); }
  }, [append, executeMacro]);

  // ── NL → lens macro: the "operate by speaking" path (needs the brains) ──
  // Conscious brain maps the request onto ONE of the lens' REAL macros (from
  // /api/lens-actions/:domain) and emits {macro,input}; ConKay executes it via
  // the real macro contract, narrates while it works, and files an artifact.
  const resolveAndOperate = useCallback(async (text: string, domain: string, lensName: string) => {
    append({ id: `u-${Date.now()}`, role: 'user', content: text });
    setInput('');
    setRunning(true);
    beginWork(`Working on the ${lensName} lens…`, [
      { id: 'read', label: `Reading ${lensName} actions`, state: 'active' },
      { id: 'choose', label: 'Choosing the right action', state: 'pending' },
      { id: 'run', label: 'Running it', state: 'pending' },
      { id: 'render', label: 'Rendering the result', state: 'pending' },
    ]);
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || '';
      let actions: string[] = [];
      try {
        const r = await fetch(`${base}/api/lens-actions/${encodeURIComponent(domain)}`, { credentials: 'include' });
        const j = await r.json();
        actions = Array.isArray(j?.actions) ? j.actions.map((a: { name?: string } | string) => (typeof a === 'string' ? a : a?.name)).filter(Boolean) : [];
      } catch { /* no actions surface */ }
      setStep('read', 'done'); setStep('choose', 'active', 'Asking the conscious brain to choose…');
      const prompt = [
        `You are ConKay operating the "${lensName}" lens inside Concord.`,
        `Available macros for this lens (domain "${domain}"): ${actions.length ? actions.join(', ') : '(unknown — infer a reasonable one)'}.`,
        `The user said: "${text}".`,
        `Choose the single best macro and the JSON input it needs.`,
        `Respond with ONLY a JSON object: {"macro":"<name>","input":{...}} — or {"macro":null} if none fits.`,
      ].join('\n');
      let macro: string | null = null;
      let inputObj: Record<string, unknown> = {};
      try {
        const r = await fetch(`${base}/api/brain/conscious`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: prompt }),
        });
        const j = await r.json();
        const m = String(j?.reply || '').match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (parsed && typeof parsed.macro === 'string') { macro = parsed.macro; inputObj = (parsed.input && typeof parsed.input === 'object') ? parsed.input : {}; }
        }
      } catch { /* brains offline */ }
      if (macro) {
        setStep('choose', 'done', `Running ${macro}`); setStep('run', 'active');
        await executeMacro(domain, macro, inputObj, `On it — running ${macro} on the ${lensName} lens.`);
        setStep('run', 'done'); setStep('render', 'done', 'Done');
      } else {
        setStep('choose', 'error', 'Could not map that to an action');
        append({
          id: `a-${Date.now()}`, role: 'assistant',
          content: actions.length
            ? `I couldn't map that to a ${lensName} action right now (the brains may be offline). This lens exposes: ${actions.slice(0, 12).join(', ')}${actions.length > 12 ? '…' : ''}. You can also say "run <action>".`
            : `I need the brains online to operate the ${lensName} lens by voice. For now, say "run <action>", or ask me to "brief me" / "search my archive for …".`,
          brain: 'kay',
        });
      }
    } finally {
      setRunning(false);
      clearWork();
    }
  }, [append, executeMacro, beginWork, setStep, clearWork]);

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
    // 3) free-text on a lens → the conscious brain maps it onto a real macro and
    //    ConKay operates the lens (graceful fallback inside resolveAndOperate).
    if (lens && !onChatLens) { resolveAndOperate(t, lens.id, lens.name); return; }
    // 4) not on an operable lens — guide to the global skills.
    append({ id: `u-${Date.now()}`, role: 'user', content: t });
    setInput('');
    append({ id: `a-${Date.now()}`, role: 'assistant', brain: 'kay',
      content: `Try "brief me", "search my archive for …", "show my activity", "open <lens>", or "what can you do".` });
  }

  const onSubmitForm = (e: React.FormEvent) => { e.preventDefault(); submit(input); };

  // Closed: a persistent, discoverable summon button (the hotkey ⌘/Ctrl+J still
  // works, and the command palette still has "Summon Kay" — this just makes the
  // front door visible for people who don't know the shortcut). Suppressed on
  // the chat lens, which hosts its own ConKay mode.
  if (!open) {
    if (onChatLens) return null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Summon ConKay (⌘/Ctrl+J)"
        title="Summon Kay — ask in one sentence (⌘/Ctrl+J)"
        className="group fixed bottom-5 right-5 z-[55] flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/40 bg-black/70 text-cyan-200 shadow-lg shadow-cyan-500/20 backdrop-blur transition hover:scale-105 hover:bg-cyan-500/20 hover:text-cyan-100"
      >
        <Sparkles className="h-5 w-5" />
        <span className="pointer-events-none absolute right-14 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs text-cyan-100 opacity-0 transition group-hover:opacity-100">
          Ask Kay
        </span>
      </button>
    );
  }

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
        <span className="ml-2 truncate text-[11px] text-cyan-300/60">
          {voice.interim ? <span className="text-cyan-200/80">“{voice.interim}”</span>
            : conkayState === 'listening' ? 'listening…'
              : conkayState === 'processing' ? 'working…'
                : conkayState === 'presenting' ? 'speaking…' : 'ready'}
        </span>
        <ConKayTelemetryChip />
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
            <div key={m.id} className={`ck-reveal ${m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
              <div className={m.role === 'user'
                ? 'max-w-[80%] rounded-2xl rounded-br-md bg-cyan-500/15 border border-cyan-400/25 px-3.5 py-2 text-sm text-cyan-50'
                : 'max-w-[85%] rounded-2xl rounded-bl-md bg-black/40 border border-cyan-400/15 px-3.5 py-2 text-sm text-cyan-50'}>
                {m.role === 'assistant'
                  ? <ConKayMessage fields={m} renderProse={(t) => <MessageRenderer content={t} />} />
                  : m.content}
              </div>
            </div>
          ))}
          {/* JARVIS "you can see it building" — live arc-reactor + step spine */}
          <ConKayWorkStatus phase={conkayState} status={workStatus} steps={steps} active={running} />
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
          {voice.usingServerStt && voice.voiceUnavailable
            ? 'Voice transcription isn’t available in this browser — type to Kay instead.'
            : '⌘/Ctrl+J to summon Kay on any lens · Esc to dismiss'}
        </p>
      </form>
    </div>
  );
}

export default ConKayOverlay;

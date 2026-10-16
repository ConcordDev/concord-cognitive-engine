'use client';

/**
 * DesignBuilder — /conkay/designs/[id] as one working surface. The 3D model
 * (drawings, assembly, CAD mesh) sits beside ConKay chat: the first message
 * starts a workbench session (or resumes one from ?wb=), and every reply
 * reports what the server actually did — the fields that moved, the checks
 * that flipped, and the pass/fail counts + margins from the returned view.
 * When the design has a live run, its stream is embedded and each body
 * snapshot replaces the viewer so the user watches the build; no run, no
 * section. The workbench knobs are one collapsible panel away. Below is the
 * snapshot's own detail page, unchanged. Nothing here invents a number: every
 * value comes from the snapshot, the stream, or the workbench server's view.
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { fetchDesign, type CheckStatus, type DesignSnapshot } from '@/lib/conkay/designs-api';
import { retryNotice } from '@/lib/conkay/demo-api';
import { api } from '@/lib/api/client';
import { workbenchClient, type WorkbenchCheck, type WorkbenchReply, type WorkbenchView } from '@/lib/conkay/workbench-api';
import { liveFileUrl, type LiveSnapshot } from '@/lib/conkay/live-api';
import { Reply, Workbench } from '@/components/conkay/workbench/Workbench';
import { DesignDetails, DesignHead } from './DesignResult';
import { DrawingsPanel } from './DrawingsPanel';
import { LiveBuildStream } from './LiveBuild';
import { DesignsHeader } from './DesignsHeader';
import { CHECK_STYLE, PANEL } from './design-styles';

const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div className="h-[46vh] animate-pulse rounded-xl bg-white/[0.03]" aria-busy="true" />,
});

/** What POST /api/conkay/workbench answers with (WorkbenchStart reads the same shape). */
interface WorkbenchStartReply {
  id?: string;
  view?: WorkbenchView;
  stage?: string;
  questions?: { field: string; question: string }[];
  outcome?: { binding?: { why: string }[] };
}

interface ChatMessage {
  role: 'user' | 'conkay';
  text?: string;
  reply?: WorkbenchReply;
  questions?: { field: string; question: string }[];
  view?: WorkbenchView | null;
}

const CHECK_ORDER: string[] = ['PASS', 'WARN', 'FAIL', 'NOT_COMPUTED', 'ERROR'];

export function DesignBuilder({ id }: { id: string }) {
  const router = useRouter();
  const [design, setDesign] = useState<DesignSnapshot | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [wbId, setWbId] = useState<string | null>(null);
  const [wbView, setWbView] = useState<WorkbenchView | null>(null);
  const [wbNote, setWbNote] = useState('');
  const [wbOpen, setWbOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [liveSnap, setLiveSnap] = useState<LiveSnapshot | null>(null);
  const [liveMissing, setLiveMissing] = useState(false);

  // Load the showcase snapshot; a workbench UUID that is not a showcase id
  // still opens here as a live session.
  useEffect(() => {
    let live = true;
    fetchDesign(id, (r) => live && setNotice(retryNotice(r))).then((r) => {
      if (!live) return;
      setNotice('');
      if ('error' in r) {
        workbenchClient.get(id).then((w) => {
          if (!live) return;
          setWbId(id);
          setWbView(w.view);
        }).catch(() => { if (live) setError('No such design, and no workbench session with this id.'); });
      } else {
        setDesign(r);
      }
    });
    return () => { live = false; };
  }, [id]);

  // A session id in the URL (?wb=<uuid>) resumes that session: the chat asks
  // against it and the Workbench panel shows its view. Read once on mount —
  // the id comes from the URL, not from props.
  useEffect(() => {
    const wb = new URLSearchParams(window.location.search).get('wb');
    if (!wb) return;
    let live = true;
    workbenchClient.get(wb)
      .then((r) => { if (live) { setWbId(wb); setWbView(r.view); } })
      .catch(() => { if (live) { setWbId(wb); setWbNote('This workbench session could not be loaded (they live until the server restarts).'); } });
    return () => { live = false; };
  }, []);

  const push = (m: ChatMessage) => setMessages((ms) => [...ms, m]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    push({ role: 'user', text: t });
    setSending(true);
    try {
      if (!wbId) {
        const prompt = design ? `${design.brief}\n\n${t}` : t;
        const r = (await api.post('/api/conkay/workbench', { prompt })).data as WorkbenchStartReply;
        if (r.stage === 'questions' && Array.isArray(r.questions)) {
          push({ role: 'conkay', text: 'ConKay needs these first:', questions: r.questions });
        } else if (r.id) {
          setWbId(r.id);
          setWbView(r.view ?? null);
          router.replace(`/conkay/designs/${id}?wb=${encodeURIComponent(r.id)}`);
          push({ role: 'conkay', text: 'Workbench session started. The knobs, graph and receipts are in the Workbench panel below.', view: r.view ?? null });
        } else {
          push({ role: 'conkay', text: r.outcome?.binding?.[0]?.why || 'This design could not be built.' });
        }
      } else {
        const r = await workbenchClient.ask(wbId, t);
        push({ role: 'conkay', reply: r.reply, view: r.view });
        setWbView(r.view);
        // Keep the Workbench panel on the same revision the chat just reached.
        try {
          const g = await workbenchClient.get(wbId);
          setWbView(g.view);
        } catch { /* the ask's view is already shown; the panel just stays a step behind */ }
      }
    } catch (e) {
      push({ role: 'conkay', text: e instanceof Error ? e.message : 'The request failed.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#040a13] text-slate-100" data-lens-theme="conkay">
      <DesignsHeader crumb={{ label: design?.title || id }} />
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-4 p-3 sm:p-5">
        <Link href="/conkay/designs" className="flex w-fit items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
          <ArrowLeft className="h-3 w-3" aria-hidden /> All designs
        </Link>
        {notice && <p role="status" className="flex items-center gap-1.5 text-xs text-amber-200"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {notice}</p>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        {!design && !wbView && !error && <div className="h-64 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" aria-busy="true" />}
        {(design || wbView) && (
          <>
            {design ? (
              <DesignHead d={design} />
            ) : (
              <section className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">Workbench session</h1>
                <span className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-300">{id.slice(0, 8)}</span>
              </section>
            )}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
              <div className="flex min-w-0 flex-col gap-4">
                {liveSnap?.file && (
                  <section className={PANEL} aria-label="Live body">
                    <h2 className="text-sm font-semibold">Body from the live run</h2>
                    <div className="mt-2 h-[46vh] min-h-[280px] overflow-hidden rounded-xl border border-white/10 bg-[#050d18]">
                      <StlViewer url={liveFileUrl(id, liveSnap.file)} />
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-slate-500" data-testid="builder-live-body">
                      cad.body solid · {liveSnap.triangles ?? '?'} triangles · sha256 {liveSnap.sha256?.slice(0, 12) ?? '—'}
                    </p>
                  </section>
                )}
                {design ? (
                  <DrawingsPanel designId={design.id} drawings={design.drawings} model3d={design.model3d} assembly={design.assembly} />
                ) : (
                  <section className={PANEL} aria-label="Live workbench session">
                    <h2 className="text-sm font-semibold">A live workbench session</h2>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      This design exists only as a workbench session, so there is no precomputed snapshot: no drawings, no solver pages. Ask ConKay for a change — every number it reports comes from the session&apos;s real runs.
                    </p>
                  </section>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <section className={`${PANEL} flex flex-col gap-3`} aria-label="ConKay chat" data-testid="builder-chat">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">ConKay</h2>
                    {wbId && <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 font-mono text-[10px] text-sky-200" data-testid="builder-session">{wbId.slice(0, 8)}</span>}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    {wbId
                      ? 'Ask for a change — each reply reports the fields that moved, the checks that flipped, and the pass/fail counts from the runs it recomputed.'
                      : 'Describe the design you want. Your first message starts a workbench session on the real pipeline (a car body takes minutes).'}
                  </p>
                  {messages.length > 0 && (
                    <ol className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1" aria-live="polite">
                      {messages.map((m, i) => <MessageItem key={i} m={m} />)}
                    </ol>
                  )}
                  <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
                    <input
                      aria-label="Message ConKay"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={wbId ? 'What if…' : 'Describe the design'}
                      className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/50 focus:outline-none"
                    />
                    <button type="submit" disabled={sending || !text.trim()} className="inline-flex items-center gap-1 rounded-md bg-sky-500/80 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40">
                      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />} Send
                    </button>
                  </form>
                  {wbNote && <p role="note" className="text-xs text-amber-200">{wbNote}</p>}
                </section>
                {wbId && (
                  <section className={PANEL} aria-label="Workbench panel">
                    <button
                      type="button"
                      aria-expanded={wbOpen}
                      onClick={() => setWbOpen((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold"
                      data-testid="builder-workbench-toggle"
                    >
                      Workbench
                      <span className="font-mono text-[11px] font-normal text-slate-400">{wbView ? `revision ${wbView.revision}` : 'loading…'}</span>
                    </button>
                    {wbOpen && (wbView
                      ? <div className="mt-3"><Workbench key={`${wbView.revision}:${wbView.receipt}`} id={wbId} initialView={wbView} /></div>
                      : <p className="mt-2 text-xs text-slate-500">Loading the workbench…</p>)}
                  </section>
                )}
              </div>
            </div>
            {!liveMissing && <LiveBuildStream id={id} onSnapshot={setLiveSnap} onMissing={() => setLiveMissing(true)} />}
            {design && <DesignDetails d={design} />}
          </>
        )}
      </main>
    </div>
  );
}

function MessageItem({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <li className="rounded-lg border border-sky-400/25 bg-sky-400/10 px-2.5 py-1.5 text-sm text-sky-100" data-testid="builder-msg-user">{m.text}</li>
    );
  }
  return (
    <li className="flex flex-col gap-2" data-testid="builder-msg-conkay">
      {m.text && <p className="text-sm leading-relaxed text-slate-200">{m.text}</p>}
      {m.questions && m.questions.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-sky-200">{m.questions.map((q) => <li key={q.field}>{q.question}</li>)}</ul>
      )}
      {m.reply && <Reply r={m.reply} />}
      {m.view && <ChecksSummary checks={m.view.checks} />}
    </li>
  );
}

/** Real counts and margins from the server's view — 'not computed' when absent, never a made-up number. */
function ChecksSummary({ checks }: { checks: WorkbenchCheck[] }) {
  if (!checks || checks.length === 0) {
    return <p className="text-xs text-slate-500" data-testid="builder-checks">Checks: not computed.</p>;
  }
  const counts = new Map<string, number>();
  for (const c of checks) counts.set(c.status, (counts.get(c.status) || 0) + 1);
  const order = [...CHECK_ORDER, ...[...counts.keys()].filter((s) => !CHECK_ORDER.includes(s))];
  const line = order.filter((s) => counts.get(s)).map((s) => `${s} ${counts.get(s)}`).join(' · ');
  return (
    <div className="flex flex-col gap-1" data-testid="builder-checks">
      <p className="font-mono text-[11px] text-slate-300">{line}</p>
      <ul className="flex flex-col gap-0.5">
        {checks.map((c) => (
          <li key={c.runId} className="font-mono text-[11px] text-slate-400">
            <span className={`mr-1 rounded border px-1 py-0.5 ${CHECK_STYLE[(c.status as CheckStatus)] || CHECK_STYLE.NOT_COMPUTED}`}>{c.status}</span>
            {c.runId}
            {c.margins.length > 0
              ? c.margins.map((mm, i) => <span key={i}> · {mm.check} util {mm.utilization != null ? mm.utilization.toFixed(3) : 'not computed'}</span>)
              : <span> · margins not computed</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
'use client';

/** /conkay/workbench — start a design from a prompt; it opens on /conkay/designs/[id]. Signed in. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { DesignsHeader } from '@/components/conkay/designs/DesignsHeader';
import { PANEL } from '@/components/conkay/designs/design-styles';

function Shell({ crumb, children }: { crumb: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#040a13] text-slate-100" data-lens-theme="conkay">
      <DesignsHeader crumb={{ label: crumb }} />
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-4 p-3 sm:p-5">{children}</main>
    </div>
  );
}

interface WbClaim { label?: string; value?: unknown; display?: string; status?: string; note?: string; source?: string }
interface BeamAnswer {
  reactions?: { RA?: number; RB?: number };
  maxMoment?: { value?: number; atM?: number };
  steps?: string[];
  needs?: string[];
  note?: string;
  section?: { widthM?: number; depthM?: number };
  sizing?: { strengthDepthM?: number; deflectionDepthM?: number; selectedDepthM?: number; governs?: string };
  hand?: { sigmaPa?: number | null; deltaM?: number | null };
  pass?: boolean;
  governs?: string;
}

const m = (v?: number | null, digits = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');

/** A class-problem solver's answer, rendered from its own fields (ConKay F5). */
function SolvedAnswer({ domain, answer, claims }: { domain: string; answer: BeamAnswer; claims: WbClaim[] }) {
  const defaults = claims.filter((c) => c.status === 'default');
  return (
    <section className={PANEL} aria-label="solved design">
      <h2 className="text-sm font-semibold capitalize text-slate-100">{domain} — solved</h2>
      {answer.reactions && (
        <p className="mt-1 font-mono text-xs text-slate-300">
          R_A {m(answer.reactions.RA, 0)} N · R_B {m(answer.reactions.RB, 0)} N
          {answer.maxMoment ? ` · M_max ${m(answer.maxMoment.value, 0)} N·m at ${m(answer.maxMoment.atM, 2)} m` : ''}
        </p>
      )}
      {answer.section && (
        <p className="mt-1 text-xs text-slate-300">
          Section {m(answer.section.widthM)} m × {m(answer.section.depthM)} m
          {answer.sizing ? ` — depth sized from the R10 series (strength needs ${m(answer.sizing.strengthDepthM)} m${answer.sizing.deflectionDepthM ? `, deflection ${m(answer.sizing.deflectionDepthM)} m` : ''}; ${answer.sizing.governs || answer.governs || 'strength'} governs)` : ''}
          {answer.hand?.sigmaPa != null ? ` · σ ${m(answer.hand.sigmaPa / 1e6, 1)} MPa` : ''}
          {answer.hand?.deltaM != null ? ` · δ ${m(answer.hand.deltaM * 1000, 2)} mm` : ''}
          {typeof answer.pass === 'boolean' ? (answer.pass ? ' · PASS' : ' · FAILS its check') : ''}
        </p>
      )}
      {Array.isArray(answer.steps) && answer.steps.length > 0 && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 font-mono text-[11px] leading-relaxed text-slate-400">
          {answer.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {answer.note && <p className="mt-2 text-xs text-amber-200/90">{answer.note}</p>}
      {defaults.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-500">Assumed: {defaults.map((c) => `${c.label} = ${c.display ?? String(c.value)} (${c.note || c.source || 'default'})`).join('; ')}</p>
      )}
    </section>
  );
}

export function WorkbenchStart() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [turns, setTurns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<{ field: string; question: string }[]>([]);
  const [needs, setNeeds] = useState<string[]>([]);
  const [solved, setSolved] = useState<{ domain: string; answer: BeamAnswer; claims: WbClaim[] } | null>(null);
  const [error, setError] = useState('');

  const submit = async (text: string) => {
    const joined = [...turns, text].filter(Boolean).join('\n\n');
    setBusy(true); setError('');
    try {
      // A 400 carries the refusal (stage + errors): accept it so the body is read.
      const r = (await api.post('/api/conkay/workbench', { prompt: joined }, { validateStatus: (s) => (s >= 200 && s < 300) || s === 400 })).data as Record<string, unknown>;
      if (r.ok === false) {
        // The refusal names its failing constraint (F5) — never the bare line.
        const errs = Array.isArray(r.errors) ? (r.errors as Array<{ error?: string }>).map((x) => x.error).filter(Boolean) : [];
        setError(errs.length ? `The design did not run (${String(r.stage || 'refused')}): ${errs.join('; ')}` : `The design did not run (${String(r.stage || 'refused')}) — the pipeline gave no reason.`);
        return;
      }
      if (r.stage === 'questions') {
        setTurns([...turns, text]);
        setQuestions((r.questions as { field: string; question: string }[]) ?? []);
        setNeeds([]);
        return;
      }
      if (r.stage === 'solved' && r.answer) {
        const ans = r.answer as BeamAnswer;
        setSolved({ domain: String(r.domain || 'design'), answer: ans, claims: (r.claims as WbClaim[]) ?? [] });
        setQuestions([]);
        setNeeds(Array.isArray(ans.needs) ? ans.needs : []);
        setTurns([...turns, text]);
        return;
      }
      if (r.id) { router.push(`/conkay/designs/${r.id}`); return; }
      // A designed-stage refusal (car pipeline): name the binding constraint it returned.
      const outcome = r.outcome as { binding?: Array<{ why?: string }>; state?: string } | undefined;
      const why = outcome?.binding?.[0]?.why || outcome?.state;
      setError(why ? `This design could not be built: ${why}` : `This design could not be built — the pipeline returned no binding constraint (stage ${String(r.stage || 'unknown')}).`);
    } catch (e) { setError(e instanceof Error ? e.message : 'the request failed'); } finally { setBusy(false); }
  };

  const continuing = questions.length > 0 || needs.length > 0;
  return (
    <Shell crumb="Workbench">
      <h1 className="text-xl font-semibold tracking-tight">Workbench</h1>
      <form className={`${PANEL} flex flex-col gap-2`} onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) { void submit(prompt.trim()); setPrompt(''); } }}>
        <label htmlFor="wb-prompt" className="text-xs text-slate-400">{continuing ? 'Add the missing detail — it joins the same brief' : 'Describe the design (the solve runs on the real pipeline; a car\'s CAD body takes minutes)'}</label>
        <input id="wb-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={continuing ? 'e.g. 100 mm wide' : 'Design a four-seat electric car that holds 180 mph'}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/50 focus:outline-none" />
        <button type="submit" disabled={busy} className="inline-flex w-fit items-center gap-1 rounded-md bg-sky-500/80 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} {continuing ? 'Continue' : 'Design it'}
        </button>
      </form>
      {questions.length > 0 && (
        <section className={PANEL} aria-label="questions"><p className="text-sm text-slate-300">ConKay needs these first:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-sky-200">{questions.map((q) => <li key={q.field}>{q.question}</li>)}</ul></section>
      )}
      {solved && <SolvedAnswer domain={solved.domain} answer={solved.answer} claims={solved.claims} />}
      {needs.length > 0 && (
        <section className={PANEL} aria-label="still needed"><p className="text-sm text-slate-300">Still needed to finish:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-sky-200">{needs.map((n) => <li key={n}>{n}</li>)}</ul></section>
      )}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    </Shell>
  );
}

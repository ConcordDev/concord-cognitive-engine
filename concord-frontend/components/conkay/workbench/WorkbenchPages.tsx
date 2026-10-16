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

export function WorkbenchStart() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<{ field: string; question: string }[]>([]);
  const [error, setError] = useState('');
  const start = async () => {
    setBusy(true); setError(''); setQuestions([]);
    try {
      const r = (await api.post('/api/conkay/workbench', { prompt })).data;
      if (r.stage === 'questions') setQuestions(r.questions);
      else if (r.id) router.push(`/conkay/designs/${r.id}`);
      else setError(r.outcome?.binding?.[0]?.why || 'this design could not be built');
    } catch (e) { setError(e instanceof Error ? e.message : 'the request failed'); } finally { setBusy(false); }
  };
  return (
    <Shell crumb="Workbench">
      <h1 className="text-xl font-semibold tracking-tight">Workbench</h1>
      <form className={`${PANEL} flex flex-col gap-2`} onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) start(); }}>
        <label htmlFor="wb-prompt" className="text-xs text-slate-400">Describe the design (the solve runs on the real pipeline; a car's CAD body takes minutes)</label>
        <input id="wb-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Design a four-seat electric car that holds 180 mph"
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/50 focus:outline-none" />
        <button type="submit" disabled={busy} className="inline-flex w-fit items-center gap-1 rounded-md bg-sky-500/80 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Design it
        </button>
      </form>
      {questions.length > 0 && (
        <section className={PANEL} aria-label="questions"><p className="text-sm text-slate-300">ConKay needs these first:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-sky-200">{questions.map((q) => <li key={q.field}>{q.question}</li>)}</ul></section>
      )}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    </Shell>
  );
}

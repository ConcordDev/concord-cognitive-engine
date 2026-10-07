'use client';

/**
 * Cognition — one trace.
 *
 * listExports is the card. Open a trace calls exportTrace, then shows
 * the title only after listExports contains that id and the same title,
 * and shows the question only after getExport returns that same question
 * on the stored trace. A blank title is not sent. A call with no trace
 * is not sent. Title and trace live in cognition_traces, so a server
 * restart still lists them. Mode is not rendered. The row rules are
 * empty-card chrome. The inspector views are other macros. They are
 * not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface TraceRow {
  id: string;
  title: string;
  question: string;
}

type Phase = 'loading' | 'ready' | 'error';

function rowsFrom(rows: unknown): { id: string; title: string }[] {
  if (!Array.isArray(rows)) return [];
  const out: { id: string; title: string }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const title = (row as { title?: string }).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title: title.trim() });
  }
  return out;
}

function questionFrom(trace: unknown): string {
  if (!trace || typeof trace !== 'object') return '';
  const input = (trace as { input?: { question?: unknown } }).input;
  const question = input?.question;
  return typeof question === 'string' ? question : '';
}

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

async function runCognition<T>(name: string, input: Record<string, unknown>, fallback: string): Promise<T> {
  let last = fallback;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await lensRun<T>('cognition', name, input);
    if (response.data?.ok && response.data.result) return response.data.result;
    last = response.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

async function readTraces(): Promise<TraceRow[]> {
  const listed = await runCognition<{ exports?: unknown }>('listExports', {}, 'Could not read the trace.');
  const slim = rowsFrom(listed.exports);
  const out: TraceRow[] = [];
  for (const row of slim) {
    const detail = await runCognition<{ export?: { trace?: unknown } }>(
      'getExport',
      { exportId: row.id },
      'Could not read the trace.',
    );
    out.push({ id: row.id, title: row.title, question: questionFrom(detail.export?.trace) });
  }
  return out;
}

export default function CognitionPage() {
  useLensNav('cognition');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readTraces(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setTraces(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the trace.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setTraces(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the trace.');
    });
  }, [pull]);

  const openTrace = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = title.trim();
    const asked = question.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    if (!asked) {
      setActionError('A question is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await runCognition<{ exportId?: string }>(
        'exportTrace',
        { title: trimmed, trace: { input: { question: asked } } },
        'Could not open that trace.',
      );
      const id = created.exportId;
      if (!id) throw new Error('Could not open that trace.');
      const rows = await readTraces();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed || row.question !== asked) {
        throw new Error('Opened, but the trace did not read it back.');
      }
      setTraces(rows);
      setTitle('');
      setQuestion('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that trace.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, question, title]);

  useLensCommand(
    [{ id: 'cognition-open', keys: 'n', description: 'Open a trace', category: 'actions', action: () => { void openTrace(); } }],
    { lensId: 'cognition' },
  );

  const empty = phase === 'ready' && traces.length === 0 && !composing;

  return (
    <LensShell lensId="cognition" asMain={false}>
      <div data-lens-theme="cognition" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Cognition</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The trace{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Trace"
          className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5"
        >
          {phase === 'loading' && (
            <p data-testid="cg-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the trace.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="cg-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the trace.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <div data-testid="cg-empty">
              <p className="text-[14px] text-zinc-400">No trace yet.</p>
              <div aria-hidden="true" data-testid="cg-rule" className="mt-3 h-px bg-white/10" />
              <div aria-hidden="true" data-testid="cg-rule" className="mt-4 h-px bg-white/10" />
              <div aria-hidden="true" data-testid="cg-rule" className="mt-4 h-px bg-white/10" />
            </div>
          )}
          {phase === 'ready' && traces.length > 0 && (
            <ul data-testid="cg-traces" className="space-y-6">
              {traces.map((trace) => (
                <li key={trace.id}>
                  <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{trace.title}</h2>
                  {trace.question ? (
                    <p data-testid="cg-question" className="mt-3 text-[15px] text-zinc-300">{trace.question}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <div className="space-y-4">
              <label className="block text-[14px] text-zinc-400">
                Title
                <input
                  data-testid="cg-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Question
                <input
                  data-testid="cg-question-input"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void openTrace(); }
                  }}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                />
              </label>
            </div>
          )}
        </section>

        {actionError ? (
          <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
        ) : null}

        <button
          type="button"
          onClick={() => { void openTrace(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          Open a trace
        </button>
      </div>
    </LensShell>
  );
}

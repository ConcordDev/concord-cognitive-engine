'use client';

/**
 * Cognition — a personal question log (branch (b), the Lead's ruling).
 *
 * A logged question is the user's own record: a title and a question,
 * kept until they mark it answered. The surface says so plainly — this
 * log does not answer, derive, or compute; it keeps questions. Create
 * verifies by read-back (listExports contains the id + title, getExport
 * returns the same question) before anything displays. Lifecycle is
 * complete: edit (updateExport), delete (deleteExport, two-step), an
 * answered state (answerExport), and an identical re-create returns the
 * standing record (the server's duplicate flag) instead of a second
 * copy. Saving an entry as a DTU records the link on the entry
 * (linkExportDtu) so the saved state survives reload, and deleting a
 * linked entry offers to remove its DTU too instead of orphaning it. Title and trace live in cognition_traces, so a server restart
 * still lists them. Below the log, a labelled window states this lens's
 * relationship to the platform's emergent-entity store (D3).
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun, apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface TraceRow {
  id: string;
  title: string;
  question: string;
  answered: { note: string; at: string } | null;
  dtuId: string | null;
}

type Phase = 'loading' | 'ready' | 'error';

function rowsFrom(rows: unknown): { id: string; title: string; answered: { note: string; at: string } | null; dtuId: string | null }[] {
  if (!Array.isArray(rows)) return [];
  const out: { id: string; title: string; answered: { note: string; at: string } | null; dtuId: string | null }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const title = (row as { title?: string }).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    const ans = (row as { answered?: { note?: unknown; at?: unknown } | null }).answered;
    const dtuId = (row as { dtuId?: unknown }).dtuId;
    out.push({
      id,
      title: title.trim(),
      answered: ans && typeof ans.note === 'string' ? { note: ans.note, at: typeof ans.at === 'string' ? ans.at : '' } : null,
      dtuId: typeof dtuId === 'string' && dtuId ? dtuId : null,
    });
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
  const listed = await runCognition<{ exports?: unknown }>('listExports', {}, 'Could not read your question log.');
  const slim = rowsFrom(listed.exports);
  const out: TraceRow[] = [];
  for (const row of slim) {
    const detail = await runCognition<{ export?: { trace?: unknown } }>(
      'getExport',
      { exportId: row.id },
      'Could not read your question log.',
    );
    out.push({ id: row.id, title: row.title, question: questionFrom(detail.export?.trace), answered: row.answered, dtuId: row.dtuId });
  }
  return out;
}

export default function CognitionPage() {
  useLensNav('cognition');
  const [phase, setPhase] = useState<Phase>('loading');
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editQuestion, setEditQuestion] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [entities, setEntities] = useState<{ registered: number; label: string } | null>(null);

  // The D3 window's count is fetched only after the log itself has
  // loaded — one plain read, no retry loop; no count, no window.
  const fetchSummary = useCallback(() => {
    lensRun<{ registered?: number; label?: string }>('cognition', 'entityStoreSummary', {})
      .then((r) => {
        const res = r?.data?.result;
        if (res && typeof res.registered === 'number') {
          setEntities({ registered: res.registered, label: res.label || '' });
        }
      })
      .catch(() => { /* no count, no window */ });
  }, []);

  const pull = useCallback(async () => readTraces(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setTraces(rows);
      setPhase('ready');
      fetchSummary();
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load your question log.');
    });
    return () => { cancelled = true; };
  }, [pull, fetchSummary]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setTraces(rows);
      setPhase('ready');
      fetchSummary();
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load your question log.');
    });
  }, [pull, fetchSummary]);

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
      const created = await runCognition<{ exportId?: string; duplicate?: boolean }>(
        'exportTrace',
        { title: trimmed, trace: { input: { question: asked } } },
        'Could not log that question.',
      );
      const id = created.exportId;
      if (!id) throw new Error('Could not log that question.');
      const rows = await readTraces();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed || row.question !== asked) {
        throw new Error('Logged, but the entry did not read it back.');
      }
      setTraces(rows);
      setTitle('');
      setQuestion('');
      setComposing(false);
      // S-COG-2: an identical re-create offers the standing record.
      setNotice(created.duplicate ? 'Already logged — that title and question stand above as one record.' : '');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not log that question.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, question, title]);

  const refresh = useCallback(async () => {
    const rows = await readTraces();
    setTraces(rows);
  }, []);

  const saveEdit = useCallback(async (id: string) => {
    const t = editTitle.trim();
    const q = editQuestion.trim();
    if (!t || !q) { setActionError('A title and a question are both required.'); return; }
    setBusy(true);
    try {
      await runCognition('updateExport', { exportId: id, title: t, question: q }, 'Could not save that edit.');
      setEditingId(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that edit.');
    } finally { setBusy(false); }
  }, [editTitle, editQuestion, refresh]);

  const removeTrace = useCallback(async (id: string, opts?: { withDtu?: boolean }) => {
    // S-COG-2: delete is two-step — the first click names the entry.
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setConfirmDeleteId(null);
    setBusy(true);
    try {
      // FIX-cognition-002: deleting an entry that was saved as a DTU offers
      // to remove the DTU too, through the platform's own gated delete —
      // otherwise the DTU is orphaned with no surface pointing at it.
      if (opts?.withDtu) {
        const trace = traces.find((t) => t.id === id);
        if (trace?.dtuId) {
          try {
            await apiHelpers.dtus.delete(trace.dtuId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/not found|404/i.test(msg)) throw new Error(`Could not remove the DTU: ${msg}`);
            // Already gone — the log entry can still be deleted.
          }
        }
      }
      await runCognition('deleteExport', { exportId: id }, 'Could not delete that entry.');
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete that entry.');
    } finally { setBusy(false); }
  }, [confirmDeleteId, refresh, traces]);

  // FIX-cognition-002: record the DTU a Save-as-DTU just minted on the log
  // entry itself, so the saved state and the link survive a reload.
  const linkDtu = useCallback(async (id: string, dtuId: string) => {
    setTraces((rows) => rows.map((t) => (t.id === id ? { ...t, dtuId } : t)));
    try {
      await runCognition('linkExportDtu', { exportId: id, dtuId }, 'Could not record the DTU link.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not record the DTU link.');
    }
  }, []);

  const saveAnswer = useCallback(async (id: string) => {
    const note = answerText.trim();
    if (!note) { setActionError('Write the answer you settled on first.'); return; }
    setBusy(true);
    try {
      await runCognition('answerExport', { exportId: id, answer: note }, 'Could not mark that answered.');
      setAnsweringId(null);
      setAnswerText('');
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not mark that answered.');
    } finally { setBusy(false); }
  }, [answerText, refresh]);

  const clearAnswer = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await runCognition('answerExport', { exportId: id, clear: true }, 'Could not clear that mark.');
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not clear that mark.');
    } finally { setBusy(false); }
  }, [refresh]);

  useLensCommand(
    [{ id: 'cognition-open', keys: 'n', description: 'Log a question', category: 'actions', action: () => { void openTrace(); } }],
    { lensId: 'cognition' },
  );

  const empty = phase === 'ready' && traces.length === 0 && !composing;

  return (
    <LensShell lensId="cognition" asMain={false}>
      <div data-lens-theme="cognition" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-2 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Cognition</h1>
        <p className="mb-5 text-[15px] text-zinc-400">Questions you&apos;re carrying, kept in one place. This is your log — nothing here answers for you; you keep the question until you settle it.</p>

        <section
          aria-label="Question log"
          className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5"
        >
          {phase === 'loading' && (
            <p data-testid="cg-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-400">
              Opening your question log.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="cg-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load your question log.'}</p>
              <button type="button" onClick={load} className="mt-4 inline-flex min-h-[40px] items-center text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <div data-testid="cg-empty">
              <p className="text-[14px] text-zinc-400">No questions logged yet.</p>
              <p className="mt-2 max-w-md text-[13px] leading-relaxed text-zinc-400">
                Write down a question you&apos;re carrying — a decision you&apos;re circling, a thing you don&apos;t yet understand.
                It stays here in your words. When you settle it, mark it answered and note what you concluded.
              </p>
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
                  {trace.answered ? (
                    <p className="mt-2 text-[13px] text-teal-300">
                      Answered{trace.answered.at ? ` · ${trace.answered.at.slice(0, 10)}` : ''} — {trace.answered.note}
                    </p>
                  ) : (
                    <p className="mt-2 text-[12px] text-zinc-400">Still open.</p>
                  )}
                  {editingId === trace.id ? (
                    <div className="mt-3 space-y-2">
                      <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="Edit title"
                        className="w-full border-b border-white/15 bg-transparent pb-1 font-vault text-[1.1rem] text-zinc-100 outline-none" />
                      <input value={editQuestion} onChange={(e) => setEditQuestion(e.target.value)} aria-label="Edit question"
                        className="w-full border-b border-white/15 bg-transparent pb-1 text-[14px] text-zinc-100 outline-none" />
                      <div className="flex gap-3 text-[13px]">
                        <button type="button" onClick={() => { void saveEdit(trace.id); }} className="inline-flex min-h-[40px] items-center text-teal-300 underline">Save</button>
                        <button type="button" onClick={() => setEditingId(null)} className="inline-flex min-h-[40px] items-center text-zinc-400 underline">Cancel</button>
                      </div>
                    </div>
                  ) : answeringId === trace.id ? (
                    <div className="mt-3 space-y-2">
                      <input value={answerText} onChange={(e) => setAnswerText(e.target.value)} aria-label="Your answer"
                        placeholder="What did you settle on?"
                        className="w-full border-b border-white/15 bg-transparent pb-1 text-[14px] text-zinc-100 outline-none" />
                      <div className="flex gap-3 text-[13px]">
                        <button type="button" onClick={() => { void saveAnswer(trace.id); }} className="inline-flex min-h-[40px] items-center text-teal-300 underline">Mark answered</button>
                        <button type="button" onClick={() => setAnsweringId(null)} className="inline-flex min-h-[40px] items-center text-zinc-400 underline">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-zinc-400">
                      <button type="button" onClick={() => { setEditingId(trace.id); setEditTitle(trace.title); setEditQuestion(trace.question); }} className="inline-flex min-h-[40px] items-center underline hover:text-zinc-200">Edit</button>
                      {trace.answered ? (
                        <button type="button" onClick={() => { void clearAnswer(trace.id); }} className="inline-flex min-h-[40px] items-center underline hover:text-zinc-200">Reopen</button>
                      ) : (
                        <button type="button" onClick={() => { setAnsweringId(trace.id); setAnswerText(''); }} className="inline-flex min-h-[40px] items-center underline hover:text-zinc-200">Mark answered</button>
                      )}
                      {confirmDeleteId === trace.id ? (
                        <>
                          <span className="text-rose-300">Delete “{trace.title}”?</span>
                          <button type="button" onClick={() => { void removeTrace(trace.id); }} className="inline-flex min-h-[40px] items-center text-rose-300 underline">Delete</button>
                          {trace.dtuId && (
                            <button type="button" onClick={() => { void removeTrace(trace.id, { withDtu: true }); }} className="inline-flex min-h-[40px] items-center text-rose-300 underline">
                              Delete + remove its DTU
                            </button>
                          )}
                          <button type="button" onClick={() => setConfirmDeleteId(null)} className="inline-flex min-h-[40px] items-center underline hover:text-zinc-200">Keep</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => { void removeTrace(trace.id); }} className="inline-flex min-h-[40px] items-center underline hover:text-zinc-200">Delete</button>
                      )}
                      <SaveAsDtuButton compact
                        apiSource="cognition-question-log"
                        title={trace.title}
                        content={trace.answered ? `${trace.question}\n\nAnswered: ${trace.answered.note}` : trace.question}
                        extraTags={['cognition', 'question-log']}
                        initialSavedId={trace.dtuId || undefined}
                        onSaved={(dtuId) => { void linkDtu(trace.id, dtuId); }} />
                    </div>
                  )}
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
                  onChange={(event) => { setTitle(event.target.value); if (actionError) setActionError(''); }}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Question
                <input
                  data-testid="cg-question-input"
                  value={question}
                  onChange={(event) => { setQuestion(event.target.value); if (actionError) setActionError(''); }}
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
        {notice ? (
          <p className="mt-4 text-[14px] text-teal-300">{notice}</p>
        ) : null}

        {entities && (
          <section aria-label="Emergent entities" className="mt-8 rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5">
            <h2 className="text-[15px] font-medium text-zinc-200">The platform&apos;s emergent entities</h2>
            <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-zinc-400">
              Separate from your log: Concord also keeps a population of {entities.registered.toLocaleString()} registered emergent
              entities — system content, spawned and run by the platform&apos;s own emergent layer, not questions of yours and not
              activity counts. This lens is their named home; their working view lives in Attention.
            </p>
            <Link href="/lenses/attention" className="mt-3 inline-block text-[13px] text-teal-300 underline">
              Browse the entities in Attention&apos;s Cognition view →
            </Link>
          </section>
        )}

        <button
          type="button"
          onClick={() => { void openTrace(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          Log a question
        </button>
      </div>
    </LensShell>
  );
}

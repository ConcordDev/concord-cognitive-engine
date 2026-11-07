'use client';

/**
 * Commonsense — the obvious check.
 *
 * The lens is a capture journal, and its copy says so (D3): the user
 * asks a question, states the obvious, and notes the exception.
 * Branch (a)/D2: asking also answers — from the user's own thread,
 * in their own words, stamped with the date (check-answer). Nothing
 * else answers; every finding is stated by the user, dated, and can
 * be disputed by them (S-CS-2/S-CS-3).
 *
 * The frame matches the concept: one panel, empty thread, Ask.
 * Ask stores a question. The finding and the exception are later
 * steps inside that panel. check-list is id and question. The finding
 * and the exception show only after check-detail returns them.
 * ConceptNet and the fact desk stay unmounted.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';

interface CheckRow {
  id: string;
  question: string;
  finding: string;
  exception: string | null;
  flagged: boolean;
  findingAt: string;
  exceptionAt: string;
  updatedAt: string;
}

function provenanceDate(row: CheckRow, field: 'findingAt' | 'exceptionAt'): string {
  const iso = row[field] || row.updatedAt;
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ThreadAnswer {
  checkId: string;
  question: string;
  finding: string;
  exception: string | null;
  statedAt: string;
  disputed: boolean;
}

function answerDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

type Phase = 'loading' | 'ready' | 'error';
type Mode = 'view' | 'ask' | 'finding' | 'exception';

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

async function runCs<T>(name: string, input: Record<string, unknown>, fallback: string): Promise<T> {
  let last = fallback;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await lensRun<T>('commonsense', name, input);
    if (response.data?.ok && response.data.result) return response.data.result;
    last = response.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

async function readThread(): Promise<CheckRow[]> {
  const listed = await runCs<{ checks?: unknown }>('check-list', {}, 'Could not read the thread.');
  const slim: { id: string; question: string }[] = [];
  if (Array.isArray(listed.checks)) {
    for (const row of listed.checks) {
      if (!row || typeof row !== 'object') continue;
      const id = (row as { id?: unknown }).id;
      const question = (row as { question?: unknown }).question;
      if (typeof id !== 'string' || !id) continue;
      if (typeof question !== 'string' || !question.trim()) continue;
      slim.push({ id, question: question.trim() });
    }
  }
  const checks: CheckRow[] = [];
  for (const row of slim) {
    const detail = await runCs<{ check?: unknown }>('check-detail', { id: row.id }, 'Could not read the thread.');
    const check = detail.check;
    if (!check || typeof check !== 'object') continue;
    const body = check as { id?: unknown; question?: unknown; finding?: unknown; exception?: unknown; flagged?: unknown; findingAt?: unknown; exceptionAt?: unknown; updatedAt?: unknown };
    if (body.id !== row.id || typeof body.question !== 'string' || body.question.trim() !== row.question) continue;
    const exception = typeof body.exception === 'string' && body.exception.trim() ? body.exception : null;
    checks.push({
      id: row.id,
      question: row.question,
      finding: typeof body.finding === 'string' ? body.finding : '',
      exception,
      flagged: body.flagged === true,
      findingAt: typeof body.findingAt === 'string' ? body.findingAt : '',
      exceptionAt: typeof body.exceptionAt === 'string' ? body.exceptionAt : '',
      updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : '',
    });
  }
  return checks;
}

export default function CommonsenseLensPage() {
  useLensNav('commonsense');
  const [phase, setPhase] = useState<Phase>('loading');
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [question, setQuestion] = useState('');
  const [finding, setFinding] = useState('');
  const [exception, setException] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [answer, setAnswer] = useState<{ question: string; answers: ThreadAnswer[] } | null>(null);
  const [answerMiss, setAnswerMiss] = useState('');

  const applyThread = useCallback((rows: CheckRow[], preferId?: string) => {
    setChecks(rows);
    setSelectedId((current) => {
      const want = preferId || current;
      if (want && rows.some((item) => item.id === want)) return want;
      return rows[0]?.id || null;
    });
  }, []);

  const pull = useCallback(async (preferId?: string) => {
    const rows = await readThread();
    applyThread(rows, preferId);
    setMode('view');
    setPhase('ready');
  }, [applyThread]);

  useEffect(() => {
    let cancelled = false;
    readThread().then((rows) => {
      if (cancelled) return;
      applyThread(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the thread.');
    });
    return () => { cancelled = true; };
  }, [applyThread]);

  const retry = useCallback(() => {
    if (busy) return;
    setPhase('loading');
    setLoadError('');
    setActionError('');
    setQuestion('');
    setFinding('');
    setException('');
    pull().catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the thread.');
    });
  }, [busy, pull]);

  const ask = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (mode !== 'ask') {
      setMode('ask');
      setActionError('');
      setSavedNote('');
      return;
    }
    const trimmed = question.trim();
    if (!trimmed) {
      setActionError('A question is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    setAnswer(null);
    setAnswerMiss('');
    try {
      // D2: the thread answers first, in the user's own words. A hit
      // renders stamped and verbatim below; a miss says so plainly.
      // Either way the ask itself still records (or dedups) as before.
      try {
        const found = await runCs<{ answered?: boolean; answers?: ThreadAnswer[] }>('check-answer', { question: trimmed }, 'Could not ask that.');
        if (found.answered && Array.isArray(found.answers) && found.answers.length) {
          setAnswer({ question: trimmed, answers: found.answers });
        } else {
          setAnswerMiss('You have not stated the obvious on this yet — state it and the thread will answer with it next time.');
        }
      } catch (_answerErr) { /* the ask below owns the real error path */ }
      const created = await runCs<{ checkId?: string; duplicate?: boolean }>('check-ask', { question: trimmed }, 'Could not ask that.');
      const id = created.checkId;
      if (!id) throw new Error('Could not ask that.');
      const rows = await readThread();
      const row = rows.find((item) => item.id === id);
      if (created.duplicate) {
        // S-CS-2: the question already stands in the thread — the
        // server returned the standing entry instead of a duplicate.
        if (!row) throw new Error('Asked, but the thread did not read it back.');
        applyThread(rows, id);
        setQuestion('');
        setMode('view');
        setSavedNote('Already in your thread — opened the standing entry instead of duplicating it.');
        return;
      }
      if (!row || row.question !== trimmed || row.finding || row.exception) {
        throw new Error('Asked, but the thread did not read it back.');
      }
      applyThread(rows, id);
      setQuestion('');
      setMode('view');
      setSavedNote('Question added.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not ask that.');
    } finally {
      setBusy(false);
    }
  }, [applyThread, busy, mode, phase, question]);

  const saveFinding = useCallback(async () => {
    if (busy || phase !== 'ready' || !selectedId) return;
    if (mode !== 'finding') {
      const current = checks.find((item) => item.id === selectedId);
      setFinding(current?.finding || '');
      setMode('finding');
      setActionError('');
      setSavedNote('');
      return;
    }
    const next = finding.trim();
    if (!next) {
      setActionError('A finding is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await runCs('check-finding', { id: selectedId, finding: next }, 'Could not save that finding.');
      const rows = await readThread();
      const row = rows.find((item) => item.id === selectedId);
      if (!row || row.finding !== next) throw new Error('Saved, but the thread did not read the finding back.');
      applyThread(rows, selectedId);
      setFinding('');
      setMode('view');
      setSavedNote('Finding saved.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that finding.');
    } finally {
      setBusy(false);
    }
  }, [applyThread, busy, checks, finding, mode, phase, selectedId]);

  const saveException = useCallback(async () => {
    if (busy || phase !== 'ready' || !selectedId) return;
    const current = checks.find((item) => item.id === selectedId);
    if (!current?.finding) return;
    if (mode !== 'exception') {
      setException(current.exception || '');
      setMode('exception');
      setActionError('');
      setSavedNote('');
      return;
    }
    const note = exception.trim();
    if (!note) {
      setActionError('An exception is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await runCs('check-exception', { id: selectedId, exception: note }, 'Could not save that exception.');
      const rows = await readThread();
      const row = rows.find((item) => item.id === selectedId);
      if (!row || row.exception !== note) throw new Error('Saved, but the thread did not read the exception back.');
      applyThread(rows, selectedId);
      setException('');
      setMode('view');
      setSavedNote('Exception saved.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that exception.');
    } finally {
      setBusy(false);
    }
  }, [applyThread, busy, checks, exception, mode, phase, selectedId]);

  const toggleFlag = useCallback(async () => {
    if (busy || phase !== 'ready' || !selectedId) return;
    const current = checks.find((item) => item.id === selectedId);
    if (!current?.finding) return;
    setBusy(true);
    setActionError('');
    try {
      const res = await runCs<{ flagged?: boolean }>('check-flag', { id: selectedId, flagged: !current.flagged }, 'Could not set the dispute.');
      const rows = await readThread();
      const row = rows.find((item) => item.id === selectedId);
      if (!row || row.flagged !== (res.flagged === true)) throw new Error('Saved, but the thread did not read the dispute back.');
      applyThread(rows, selectedId);
      setSavedNote(current.flagged ? 'Dispute withdrawn.' : 'Finding disputed — marked as yours to revisit.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not set the dispute.');
    } finally {
      setBusy(false);
    }
  }, [applyThread, busy, checks, phase, selectedId]);

  const deleteEntry = useCallback(async () => {
    if (busy || phase !== 'ready' || !selectedId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await runCs('check-delete', { id: selectedId }, 'Could not delete that entry.');
      const rows = await readThread();
      if (rows.some((item) => item.id === selectedId)) throw new Error('Deleted, but the thread still shows the entry.');
      applyThread(rows);
      setConfirmDelete(false);
      setMode('view');
      setSavedNote('Entry deleted.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete that entry.');
    } finally {
      setBusy(false);
    }
  }, [applyThread, busy, confirmDelete, phase, selectedId]);

  const openCheck = useCallback(async (id: string) => {
    if (busy || phase !== 'ready') return;
    setBusy(true);
    setActionError('');
    try {
      const detail = await runCs<{ check?: { id?: string; question?: string; finding?: unknown; exception?: unknown; flagged?: unknown; findingAt?: unknown; exceptionAt?: unknown; updatedAt?: unknown } }>(
        'check-detail',
        { id },
        'Could not read the thread.',
      );
      const body = detail.check;
      setChecks((rows) => rows.map((item) => {
        if (item.id !== id || !body || body.id !== id || body.question !== item.question) return item;
        return {
          ...item,
          finding: typeof body.finding === 'string' ? body.finding : '',
          exception: typeof body.exception === 'string' && body.exception.trim() ? body.exception : null,
          flagged: body.flagged === true,
          findingAt: typeof body.findingAt === 'string' ? body.findingAt : item.findingAt,
          exceptionAt: typeof body.exceptionAt === 'string' ? body.exceptionAt : item.exceptionAt,
          updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : item.updatedAt,
        };
      }));
      setConfirmDelete(false);
      setSelectedId(id);
      setMode('view');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not read the thread.');
    } finally {
      setBusy(false);
    }
  }, [busy, phase]);

  useLensCommand(
    [{ id: 'cs-ask', keys: 'a', description: 'Ask', category: 'actions', action: () => { void ask(); } }],
    { lensId: 'commonsense' },
  );

  const selected = checks.find((item) => item.id === selectedId) || null;
  const empty = phase === 'ready' && mode === 'view' && checks.length === 0;

  return (
    <LensShell lensId="commonsense" asMain={false}>
      <div data-lens-theme="commonsense" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-2 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Commonsense</h1>
        <p className="mb-5 text-[15px] text-zinc-400">
          State the obvious. Note the exception. Your common sense, written down — you state it, you date it, you keep it.
        </p>

        <section aria-label="Thread" className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5">
          {phase === 'loading' && (
            <p data-testid="cs-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Reading the thread.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="cs-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the thread.'}</p>
              <button type="button" onClick={retry} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <div data-testid="cs-empty" className="flex min-h-[16rem] flex-col items-center justify-center gap-2 text-center">
              <p className="text-[15px] text-zinc-300">The thread is empty.</p>
              <p className="max-w-md text-[14px] text-zinc-500">
                Ask a question below. Then state the obvious answer, in your own words — and note the exception, where the obvious breaks.
                The thread answers from what you stated: your words, dated. Nothing else answers for you.
              </p>
            </div>
          )}
          {phase === 'ready' && mode === 'view' && selected && (
            <div className="mb-6">
              <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{selected.question}</h2>
              {selected.finding ? (
                <>
                  <p data-testid="cs-finding" className="mt-3 text-[15px] text-zinc-300">{selected.finding}</p>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    Stated by you{provenanceDate(selected, 'findingAt') ? `, ${provenanceDate(selected, 'findingAt')}` : ''}
                    {selected.flagged ? <span className="text-red-300"> · disputed by you</span> : null}
                  </p>
                </>
              ) : null}
              {selected.exception ? (
                <>
                  <p data-testid="cs-exception" className="mt-3 text-[15px] text-zinc-300">{selected.exception}</p>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    Noted by you{provenanceDate(selected, 'exceptionAt') ? `, ${provenanceDate(selected, 'exceptionAt')}` : ''}
                  </p>
                </>
              ) : null}
            </div>
          )}
          {phase === 'ready' && mode === 'view' && checks.length > 0 && (
            <ul data-testid="cs-thread" className="space-y-2 border-t border-white/10 pt-4">
              {checks.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={item.question}
                    onClick={() => { void openCheck(item.id); }}
                    className="text-left text-[15px] text-zinc-200 underline-offset-4 hover:underline"
                  >
                    {item.question}
                    {item.exception ? (
                      <span aria-hidden="true" className="font-serif italic" title="This one has a boundary — it carries an exception."> *</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && mode === 'view' && checks.some((item) => item.exception) && (
            <section aria-label="Exceptions" className="mt-8 border-t border-white/10 pt-4">
              <h3 className="font-vault text-[1.125rem] text-zinc-100">Where the obvious breaks</h3>
              <p className="mt-1 text-[12px] text-zinc-500">
                {checks.filter((item) => item.exception).length} {checks.filter((item) => item.exception).length === 1 ? 'entry carries' : 'entries carry'} an exception — the boundary of what you stated.
              </p>
              <ul className="mt-3 space-y-3">
                {checks.filter((item) => item.exception).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-label={item.question}
                      onClick={() => { void openCheck(item.id); }}
                      className="text-left text-[14px] text-zinc-200 underline-offset-4 hover:underline"
                    >
                      {item.question}
                    </button>
                    <p className="text-[14px] text-zinc-400">{item.exception}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {phase === 'ready' && mode === 'ask' && (
            <label className="block text-[14px] text-zinc-400">
              Question
              <input
                data-testid="cs-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {phase === 'ready' && mode === 'finding' && (
            <label className="block text-[14px] text-zinc-400">
              Finding
              <input
                data-testid="cs-finding-input"
                value={finding}
                onChange={(event) => setFinding(event.target.value)}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {phase === 'ready' && mode === 'exception' && (
            <label className="block text-[14px] text-zinc-400">
              Exception
              <input
                data-testid="cs-exception-input"
                value={exception}
                onChange={(event) => setException(event.target.value)}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {phase === 'ready' && mode === 'view' && selected && (
            <div className="mt-6 flex flex-wrap gap-4">
              <button type="button" onClick={() => { void saveFinding(); }} className="text-[14px] text-zinc-100 underline">
                {selected.finding ? 'Edit the finding' : 'State the obvious'}
              </button>
              {selected.finding ? (
                <button type="button" onClick={() => { void saveException(); }} className="text-[14px] text-zinc-100 underline">
                  {selected.exception ? 'Edit the exception' : 'Note an exception'}
                </button>
              ) : null}
              {selected.finding ? (
                <button type="button" onClick={() => { void toggleFlag(); }} className="text-[14px] text-zinc-100 underline">
                  {selected.flagged ? 'Withdraw the dispute' : 'Dispute this finding'}
                </button>
              ) : null}
              {confirmDelete ? (
                <button type="button" onClick={() => { void deleteEntry(); }} disabled={busy} className="text-[14px] text-red-300 underline disabled:opacity-60"
                  title="Confirm delete — removes this question, its finding, and its exception">
                  Delete?
                </button>
              ) : (
                <button type="button" onClick={() => { void deleteEntry(); }} className="text-[14px] text-zinc-400 underline">
                  Delete this entry
                </button>
              )}
            </div>
          )}
          {phase === 'ready' && mode === 'finding' && (
            <button type="button" onClick={() => { void saveFinding(); }} disabled={busy} className="mt-6 text-[14px] text-zinc-100 underline disabled:opacity-60">
              Save the finding
            </button>
          )}
          {phase === 'ready' && mode === 'exception' && (
            <button type="button" onClick={() => { void saveException(); }} disabled={busy} className="mt-6 text-[14px] text-zinc-100 underline disabled:opacity-60">
              Save the exception
            </button>
          )}
        </section>

        {answer ? (
          <section data-testid="cs-answer" aria-label="Answer from your thread" className="mt-6 rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5">
            <h3 className="font-vault text-[1.125rem] text-zinc-100">From your thread</h3>
            {answer.answers.map((item) => (
              <div key={item.checkId} className="mt-3">
                <p className="text-[15px] text-zinc-300">{item.finding}</p>
                <p className="mt-1 text-[12px] text-zinc-500">
                  {item.disputed
                    ? <>You disputed this finding{answerDate(item.statedAt) ? ` — stated by you, ${answerDate(item.statedAt)}` : ''}. It stands contested, not settled.</>
                    : <>You stated the obvious{answerDate(item.statedAt) ? ` on ${answerDate(item.statedAt)}` : ''}.</>}
                </p>
                {item.exception ? (
                  <p className="mt-1 text-[13px] text-zinc-400">Its boundary, as you noted it: {item.exception}</p>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        {answerMiss ? <p data-testid="cs-answer-miss" className="mt-4 text-[13px] text-zinc-500">{answerMiss}</p> : null}
        {actionError ? <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p> : null}
        {savedNote ? <p data-testid="cs-saved" className="mt-4 text-[13px] text-zinc-500">{savedNote}</p> : null}

        <button
          type="button"
          onClick={() => { void ask(); }}
          disabled={phase === 'loading' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {mode === 'ask' ? 'Ask this' : 'Ask'}
        </button>
      </div>
    </LensShell>
  );
}

'use client';

/**
 * Commonsense — the obvious check.
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface CheckRow {
  id: string;
  question: string;
  finding: string;
  exception: string | null;
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
    const body = check as { id?: unknown; question?: unknown; finding?: unknown; exception?: unknown };
    if (body.id !== row.id || typeof body.question !== 'string' || body.question.trim() !== row.question) continue;
    const exception = typeof body.exception === 'string' && body.exception.trim() ? body.exception : null;
    checks.push({
      id: row.id,
      question: row.question,
      finding: typeof body.finding === 'string' ? body.finding : '',
      exception,
    });
  }
  return checks;
}

export default function CommonsenseLensPage() {
  useLensNav('commonsense');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      return;
    }
    const trimmed = question.trim();
    if (!trimmed) {
      setActionError('A question is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await runCs<{ checkId?: string }>('check-ask', { question: trimmed }, 'Could not ask that.');
      const id = created.checkId;
      if (!id) throw new Error('Could not ask that.');
      const rows = await readThread();
      const row = rows.find((item) => item.id === id);
      if (!row || row.question !== trimmed || row.finding || row.exception) {
        throw new Error('Asked, but the thread did not read it back.');
      }
      applyThread(rows, id);
      setQuestion('');
      setMode('view');
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
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that exception.');
    } finally {
      setBusy(false);
    }
  }, [applyThread, busy, checks, exception, mode, phase, selectedId]);

  const openCheck = useCallback(async (id: string) => {
    if (busy || phase !== 'ready') return;
    setBusy(true);
    setActionError('');
    try {
      const detail = await runCs<{ check?: { id?: string; question?: string; finding?: unknown; exception?: unknown } }>(
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
        };
      }));
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
        <p className="text-[14px] text-zinc-500">Commonsense</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The obvious check{who ? `, ${who}` : ''}
        </h1>

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
            <p data-testid="cs-empty" className="flex min-h-[16rem] items-center justify-center text-center text-[15px] text-zinc-400">
              The thread is empty.
            </p>
          )}
          {phase === 'ready' && mode === 'view' && selected && (
            <div className="mb-6">
              <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{selected.question}</h2>
              {selected.finding ? <p data-testid="cs-finding" className="mt-3 text-[15px] text-zinc-300">{selected.finding}</p> : null}
              {selected.exception ? <p data-testid="cs-exception" className="mt-3 text-[15px] text-zinc-300">{selected.exception}</p> : null}
            </div>
          )}
          {phase === 'ready' && mode === 'view' && checks.length > 0 && (
            <ul data-testid="cs-thread" className="space-y-2 border-t border-white/10 pt-4">
              {checks.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => { void openCheck(item.id); }}
                    className="text-left text-[15px] text-zinc-200 underline-offset-4 hover:underline"
                  >
                    {item.question}
                  </button>
                </li>
              ))}
            </ul>
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

        {actionError ? <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p> : null}

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

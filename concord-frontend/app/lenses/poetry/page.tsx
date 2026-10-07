'use client';

/**
 * Poetry — one poem.
 *
 * poem-list is the page. + New poem calls poem-create, then shows the
 * title only after poem-list contains that id and the same title, and
 * shows the lines only after poem-detail returns that same body. A blank
 * title is not sent. A blank body is not sent. Title and body are stored
 * in poetry_poems, so a server restart still lists them. Form and status
 * stay off this screen. The numbered comment is empty-page chrome. It
 * is not a text field. The notebook views are other macros. They are
 * not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface Poem {
  id: string;
  title: string;
  body: string;
}

type Phase = 'loading' | 'ready' | 'error';

function poemsFrom(rows: unknown): { id: string; title: string }[] {
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

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

async function runPoetry<T>(name: string, input: Record<string, unknown>, fallback: string): Promise<T> {
  let last = fallback;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await lensRun<T>('poetry', name, input);
    if (response.data?.ok && response.data.result) return response.data.result;
    last = response.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

// poem-list is a small read. A 503 here is the admission gate refusing
// PROTECTED calls while boot lag is over 900ms, not a failed poem query.
// Retry on that gate only. Any other error surfaces immediately.
async function readPoems(): Promise<Poem[]> {
  const listed = await runPoetry<{ poems?: unknown }>('poem-list', {}, 'Could not read the poem.');
  const slim = poemsFrom(listed.poems);
  const out: Poem[] = [];
  for (const poem of slim) {
    const detail = await runPoetry<{ poem?: { body?: unknown; title?: unknown } }>(
      'poem-detail',
      { id: poem.id },
      'Could not read the poem.',
    );
    const body = detail.poem?.body;
    if (typeof body !== 'string') throw new Error('Could not read the poem.');
    out.push({ id: poem.id, title: poem.title, body });
  }
  return out;
}

function LineNumbers({ count }: { count: number }) {
  const n = Math.max(4, count);
  return (
    <ol className="w-10 shrink-0 select-none border-r border-white/10 py-4 text-right font-mono text-[13px] text-zinc-600">
      {Array.from({ length: n }, (_, index) => (
        <li key={index + 1} className="h-7 px-2 leading-7">{index + 1}</li>
      ))}
    </ol>
  );
}

export default function PoetryPage() {
  useLensNav('poetry');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [poems, setPoems] = useState<Poem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readPoems(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setPoems(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the poem.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setPoems(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the poem.');
    });
  }, [pull]);

  const openPoem = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = title.trim();
    const lines = body.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    if (!lines) {
      setActionError('A line is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await runPoetry<{ poem?: { id?: string } }>(
        'poem-create',
        { title: trimmed, body: lines },
        'Could not open that poem.',
      );
      const id = created.poem?.id;
      if (!id) throw new Error('Could not open that poem.');
      const rows = await readPoems();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed || row.body !== lines) {
        throw new Error('Opened, but the poem did not read it back.');
      }
      setPoems(rows);
      setTitle('');
      setBody('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that poem.');
    } finally {
      setBusy(false);
    }
  }, [body, busy, composing, phase, title]);

  useLensCommand(
    [{ id: 'poetry-new', keys: 'n', description: '+ New poem', category: 'actions', action: () => { void openPoem(); } }],
    { lensId: 'poetry' },
  );

  const empty = phase === 'ready' && poems.length === 0 && !composing;

  return (
    <LensShell lensId="poetry" asMain={false}>
      <div data-lens-theme="poetry" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Poetry</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The poem{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Poem"
          className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950"
        >
          {phase === 'loading' && (
            <p data-testid="po-loading" role="status" aria-busy="true" className="px-6 py-5 text-[14px] text-zinc-500">
              Opening the poem.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="po-error" role="alert" className="px-6 py-5">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the poem.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <div data-testid="po-empty" className="flex min-h-[20rem]">
              <LineNumbers count={4} />
              <div className="px-4 py-4 font-mono text-[14px]">
                <p className="h-7 leading-7 text-zinc-500">{'// the page is empty.'}</p>
                <p className="h-7" />
                <p className="flex h-7 items-center">
                  <span data-testid="po-caret" className="inline-block h-4 w-2 bg-teal-400" />
                </p>
              </div>
            </div>
          )}
          {phase === 'ready' && poems.length > 0 && (
            <ul data-testid="po-poems">
              {poems.map((poem) => {
                const lines = poem.body.split('\n');
                return (
                  <li key={poem.id} className="border-b border-white/10 px-6 py-5 last:border-b-0">
                    <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{poem.title}</h2>
                    <div className="mt-3 flex">
                      <LineNumbers count={lines.length} />
                      <div className="px-4 py-4 font-mono text-[14px] text-zinc-300">
                        {lines.map((line, index) => (
                          <p key={`${poem.id}-${index}`} data-testid="po-line" className="h-7 leading-7">{line}</p>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <div className="space-y-4 px-6 py-5">
              <label className="block text-[14px] text-zinc-400">
                Title
                <input
                  data-testid="po-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Lines
                <textarea
                  data-testid="po-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={6}
                  className="mt-1 w-full resize-none border-b border-white/15 bg-transparent pb-2 font-mono text-[14px] text-zinc-100 outline-none"
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
          onClick={() => { void openPoem(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New poem
        </button>
      </div>
    </LensShell>
  );
}

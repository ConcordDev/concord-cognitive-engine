'use client';

/**
 * Game Design — one design.
 *
 * game-list is the card. + New design calls game-create, then shows the
 * title only after game-list contains that id and the same title. A blank
 * title is not sent. Titles are stored in game_designs, so a server
 * restart still lists them. Genre and platform stay off this screen.
 * The two rules are empty-card chrome. The workbench tabs are other
 * macros. They are not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface Design {
  id: string;
  title: string;
}

type Phase = 'loading' | 'ready' | 'error';

function designsFrom(rows: unknown): Design[] {
  if (!Array.isArray(rows)) return [];
  const out: Design[] = [];
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

// game-list is a small read. A 503 here is the admission gate refusing
// PROTECTED calls while boot lag is over 900ms, not a failed design query.
// Retry on that gate only. Any other error surfaces immediately.
async function readDesigns(): Promise<Design[]> {
  let last = 'Could not read the design.';
  for (let attempt = 0; attempt < 8; attempt++) {
    const list = await lensRun<{ games?: unknown }>('game-design', 'game-list', {});
    if (list.data?.ok) return designsFrom(list.data.result?.games);
    last = list.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

export default function GameDesignPage() {
  useLensNav('game-design');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readDesigns(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setDesigns(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the design.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setDesigns(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the design.');
    });
  }, [pull]);

  const openDesign = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await lensRun<{ game?: { id?: string; title?: string } }>(
        'game-design',
        'game-create',
        { title: trimmed },
      );
      const id = created.data?.result?.game?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not open that design.');
      }
      const rows = await readDesigns();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed) {
        throw new Error('Opened, but the design did not read it back.');
      }
      setDesigns(rows);
      setTitle('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that design.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, title]);

  useLensCommand(
    [{ id: 'game-design-new', keys: 'n', description: '+ New design', category: 'actions', action: () => { void openDesign(); } }],
    { lensId: 'game-design' },
  );

  const empty = phase === 'ready' && designs.length === 0 && !composing;

  return (
    <LensShell lensId="game-design" asMain={false}>
      <div data-lens-theme="game-design" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Game Design</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The design{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Design"
          className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5"
        >
          {phase === 'loading' && (
            <p data-testid="gd-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the design.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="gd-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the design.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <div data-testid="gd-empty">
              <p className="text-[14px] text-zinc-500">No design open.</p>
              <div aria-hidden="true" data-testid="gd-rule" className="mt-6 h-px w-2/3 bg-white/10" />
              <div aria-hidden="true" data-testid="gd-rule" className="mt-4 h-px w-1/2 bg-white/10" />
            </div>
          )}
          {phase === 'ready' && designs.length > 0 && (
            <ul data-testid="gd-designs" className="space-y-4">
              {designs.map((item) => (
                <li key={item.id}>
                  <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{item.title}</h2>
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <label className="mt-4 block text-[14px] text-zinc-400">
              Title
              <input
                data-testid="gd-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); void openDesign(); }
                }}
                className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
        </section>

        {actionError ? (
          <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
        ) : null}

        <button
          type="button"
          onClick={() => { void openDesign(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New design
        </button>
      </div>
    </LensShell>
  );
}

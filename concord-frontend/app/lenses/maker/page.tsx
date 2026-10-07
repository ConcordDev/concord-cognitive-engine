'use client';

/**
 * Maker — the bench.
 *
 * One list: app-maker.projectList for the signed-in user.
 * One action: + New make calls app-maker.projectCreate, then shows
 * the name only after projectList contains that id and the same name.
 *
 * The editor, quest graph, and showcase are other macros. They are
 * not on this screen. A blank name is not sent, so the server's
 * "Untitled App" default is never stored from here.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface Make {
  id: string;
  name: string;
}

type Phase = 'loading' | 'ready' | 'error';

interface ProjectRow {
  id?: string;
  name?: string;
}

function makesFrom(rows: unknown): Make[] {
  if (!Array.isArray(rows)) return [];
  const out: Make[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as ProjectRow).id;
    const name = (row as ProjectRow).name;
    if (typeof id !== 'string' || !id) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    out.push({ id, name: name.trim() });
  }
  return out;
}

async function readBench(): Promise<Make[]> {
  const list = await lensRun<{ projects?: unknown }>('app-maker', 'projectList', {});
  if (!list.data?.ok) throw new Error(list.data?.error || 'Could not read the bench.');
  return makesFrom(list.data.result?.projects);
}

export default function MakerPage() {
  useLensNav('maker');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [makes, setMakes] = useState<Make[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readBench(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setMakes(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the bench.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setMakes(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the bench.');
    });
  }, [pull]);

  const make = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setActionError('A name is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await lensRun<{ project?: { id?: string } }>(
        'app-maker',
        'projectCreate',
        { name: trimmed },
      );
      const id = created.data?.result?.project?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not start that make.');
      }
      const rows = await readBench();
      const row = rows.find((item) => item.id === id);
      if (!row || row.name !== trimmed) {
        throw new Error('Made, but the bench did not read it back.');
      }
      setMakes(rows);
      setName('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start that make.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, name, phase]);

  useLensCommand(
    [{ id: 'maker-new', keys: 'n', description: '+ New make', category: 'actions', action: () => { void make(); } }],
    { lensId: 'maker' },
  );

  return (
    <LensShell lensId="maker" asMain={false}>
      <div data-lens-theme="maker" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Maker</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The make{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Bench"
          className="flex min-h-[22rem] flex-col justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16"
        >
          {phase === 'loading' && (
            <p data-testid="maker-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the bench.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="maker-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the bench.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && makes.length === 0 && !composing && (
            <div data-testid="maker-empty" className="text-center">
              <p className="text-[14px] text-zinc-500">Nothing on the bench.</p>
            </div>
          )}
          {phase === 'ready' && makes.length > 0 && (
            <ul data-testid="maker-makes" className="space-y-6">
              {makes.map((item) => (
                <li key={item.id}>
                  <h2 className="font-vault text-[1.5rem] text-zinc-100">{item.name}</h2>
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <label className="mt-6 block text-[14px] text-zinc-400">
              Name
              <input
                data-testid="maker-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); void make(); }
                }}
                className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-[16px] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {actionError ? (
            <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
          ) : null}
        </section>

        <button
          type="button"
          onClick={() => { void make(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New make
        </button>
      </div>
    </LensShell>
  );
}

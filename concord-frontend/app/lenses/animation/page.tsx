'use client';

/**
 * Animation — one shot.
 *
 * anim-list is the cabinet. + New shot calls anim-create, then shows
 * the title only after anim-list contains that id and the same title.
 * Titles are stored in animation_shots, so a server restart still lists
 * them. A blank title is not sent. Frames, the toolkit, and the
 * reference wall are other macros. They are not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface Shot {
  id: string;
  title: string;
}

type Phase = 'loading' | 'ready' | 'error';

interface ShotRow {
  id?: string;
  title?: string;
}

function shotsFrom(rows: unknown): Shot[] {
  if (!Array.isArray(rows)) return [];
  const out: Shot[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as ShotRow).id;
    const title = (row as ShotRow).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title: title.trim() });
  }
  return out;
}

async function readShots(): Promise<Shot[]> {
  const list = await lensRun<{ animations?: unknown }>('animation', 'anim-list', {});
  if (!list.data?.ok) throw new Error(list.data?.error || 'Could not read the shot.');
  return shotsFrom(list.data.result?.animations);
}

export default function AnimationPage() {
  useLensNav('animation');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [shots, setShots] = useState<Shot[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readShots(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setShots(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the shot.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setShots(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the shot.');
    });
  }, [pull]);

  const openShot = useCallback(async () => {
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
      const created = await lensRun<{ animation?: { id?: string; title?: string } }>(
        'animation',
        'anim-create',
        { title: trimmed },
      );
      const id = created.data?.result?.animation?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not open that shot.');
      }
      const rows = await readShots();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed) {
        throw new Error('Opened, but the shot did not read it back.');
      }
      setShots(rows);
      setTitle('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that shot.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, title]);

  useLensCommand(
    [{ id: 'animation-new', keys: 'n', description: '+ New shot', category: 'actions', action: () => { void openShot(); } }],
    { lensId: 'animation' },
  );

  return (
    <LensShell lensId="animation" asMain={false}>
      <div data-lens-theme="animation" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Animation</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The shot{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Shot"
          className="flex min-h-[22rem] flex-col justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16"
        >
          {phase === 'loading' && (
            <p data-testid="animation-loading" role="status" aria-busy="true" className="text-center text-[14px] text-zinc-500">
              Opening the shot.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="animation-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the shot.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && shots.length === 0 && !composing && (
            <div data-testid="animation-empty" className="text-center">
              <p className="text-[14px] text-zinc-500">No shot open.</p>
            </div>
          )}
          {phase === 'ready' && shots.length > 0 && (
            <ul data-testid="animation-shots" className="space-y-6">
              {shots.map((item) => (
                <li key={item.id}>
                  <h2 className="font-vault text-[1.5rem] text-zinc-100">{item.title}</h2>
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <label className="mt-6 block text-[14px] text-zinc-400">
              Title
              <input
                data-testid="animation-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); void openShot(); }
                }}
                className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-[16px] text-zinc-100 outline-none"
                autoFocus
              />
            </label>
          )}
          {actionError ? (
            <p role="alert" className="mt-4 text-center text-[14px] text-zinc-300">{actionError}</p>
          ) : null}
        </section>

        <button
          type="button"
          onClick={() => { void openShot(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New shot
        </button>
      </div>
    </LensShell>
  );
}

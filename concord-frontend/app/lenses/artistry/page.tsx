'use client';

/**
 * Artistry — one study.
 *
 * projectList is the cabinet. + New study calls projectCreate, then
 * shows the title only after projectList contains that id and the same
 * title. Titles are stored in artistry_studies, so a server restart
 * still lists them. A blank title is not sent. The feed, profile,
 * collections, and sketchpad are other macros. They are not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface Study {
  id: string;
  title: string;
}

type Phase = 'loading' | 'ready' | 'error';

interface StudyRow {
  id?: string;
  title?: string;
}

function studiesFrom(rows: unknown): Study[] {
  if (!Array.isArray(rows)) return [];
  const out: Study[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as StudyRow).id;
    const title = (row as StudyRow).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title: title.trim() });
  }
  return out;
}

async function readStudies(): Promise<Study[]> {
  const list = await lensRun<{ projects?: unknown }>('artistry', 'projectList', {});
  if (!list.data?.ok) throw new Error(list.data?.error || 'Could not read the study.');
  return studiesFrom(list.data.result?.projects);
}

export default function ArtistryLensPage() {
  useLensNav('artistry');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [studies, setStudies] = useState<Study[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readStudies(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setStudies(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the study.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setStudies(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the study.');
    });
  }, [pull]);

  const openStudy = useCallback(async () => {
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
      const created = await lensRun<{ project?: { id?: string; title?: string } }>(
        'artistry',
        'projectCreate',
        { title: trimmed },
      );
      const id = created.data?.result?.project?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not open that study.');
      }
      const rows = await readStudies();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed) {
        throw new Error('Opened, but the study did not read it back.');
      }
      setStudies(rows);
      setTitle('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that study.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, title]);

  useLensCommand(
    [{ id: 'artistry-new', keys: 'n', description: '+ New study', category: 'actions', action: () => { void openStudy(); } }],
    { lensId: 'artistry' },
  );

  return (
    <LensShell lensId="artistry" asMain={false}>
      <div data-lens-theme="artistry" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Artistry</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The study{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Study"
          className="flex min-h-[22rem] flex-col justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16"
        >
          {phase === 'loading' && (
            <p data-testid="artistry-loading" role="status" aria-busy="true" className="text-center text-[14px] text-zinc-500">
              Opening the study.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="artistry-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the study.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && studies.length === 0 && !composing && (
            <div data-testid="artistry-empty" className="text-center">
              <p className="text-[14px] text-zinc-500">The study is empty.</p>
            </div>
          )}
          {phase === 'ready' && studies.length > 0 && (
            <ul data-testid="artistry-studies" className="space-y-6">
              {studies.map((item) => (
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
                data-testid="artistry-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); void openStudy(); }
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
          onClick={() => { void openStudy(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New study
        </button>
      </div>
    </LensShell>
  );
}

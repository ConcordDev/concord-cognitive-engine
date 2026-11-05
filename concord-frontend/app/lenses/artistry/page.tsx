'use client';

/**
 * Artistry — the real project studio.
 *
 * projectList is used once at page-load only to pass through the shared
 * admission-gate warm-up retry (a 503 here is boot lag, not a failed
 * query). Once that gate clears, the real panel is mounted:
 *
 * - <ProjectStudio>: a gallery of studies (create, open, Edit, Delete,
 *   appreciate, comment) whose create/edit form now also has a real
 *   drawing medium — <StudyCanvas>, a layered canvas with a color/size
 *   brush and per-layer undo — alongside the existing external-URL paste
 *   and native file-upload paths. A drawing is rasterized and uploaded
 *   through the same artistry.project-image-upload macro the file
 *   picker already used, so it becomes a real project image, not a
 *   title-only heading (lens-reviews/artistry.md F2/F3).
 *
 * All of this already existed in components/artistry/ and called real
 * artistry.* macros (server/domains/artistry.js) except the drawing
 * medium itself (new, this pass) — ProjectStudio was simply never
 * mounted on this page, which had been reduced to a bare title-only
 * cabinet with no drawable surface and no way to reopen, rename, or
 * delete a study. The feed, profile, collections, DMs, notifications,
 * job board, and curated galleries are other macros/components. They
 * are not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';
import { ProjectStudio } from '@/components/artistry';

type Phase = 'warming' | 'ready' | 'error';

const WARM_RETRY_MS = 1200;
const WARM_MAX_ATTEMPTS = 6;

function isWarming(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /503|not.?ready|starting|warm/i.test(message);
}

async function probeReady(): Promise<void> {
  const r = await lensRun('artistry', 'projectList', {});
  if (!r.data?.ok) throw new Error(r.data?.error || 'Could not reach the studio.');
}

export default function ArtistryLensPage() {
  useLensNav('artistry');
  const [phase, setPhase] = useState<Phase>('warming');
  const [loadError, setLoadError] = useState('');

  const warmUp = useCallback(async () => {
    for (let attempt = 0; attempt < WARM_MAX_ATTEMPTS; attempt += 1) {
      try {
        await probeReady();
        return true;
      } catch (err) {
        if (!isWarming(err) || attempt === WARM_MAX_ATTEMPTS - 1) throw err;
        await new Promise((resolve) => setTimeout(resolve, WARM_RETRY_MS));
      }
    }
    return false;
  }, []);

  const load = useCallback(() => {
    setPhase('warming');
    setLoadError('');
    warmUp()
      .then(() => setPhase('ready'))
      .catch((err) => {
        setPhase('error');
        setLoadError(err instanceof Error ? err.message : 'Could not load the studio.');
      });
  }, [warmUp]);

  useEffect(() => { load(); }, [load]);

  const focusNewStudy = useCallback(() => {
    if (phase !== 'ready') return;
    const newButton = document.querySelector<HTMLButtonElement>('[data-artistry-new-project]');
    newButton?.click();
  }, [phase]);

  useLensCommand(
    [{ id: 'artistry-new', keys: 'n', description: '+ New study', category: 'actions', action: focusNewStudy }],
    { lensId: 'artistry' },
  );

  return (
    <LensShell lensId="artistry" asMain={false}>
      <div data-lens-theme="artistry" className="relative min-h-full bg-black px-8 pb-10 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Artistry</h1>

        {phase === 'warming' && (
          <section aria-label="Study" className="flex min-h-[22rem] flex-col justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16">
            <p data-testid="artistry-warming" role="status" aria-busy="true" className="text-center text-[14px] text-zinc-500">
              Opening the study.
            </p>
          </section>
        )}
        {phase === 'error' && (
          <section aria-label="Study" className="flex min-h-[22rem] flex-col justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16">
            <div data-testid="artistry-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the studio.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          </section>
        )}
        {phase === 'ready' && (
          <section aria-label="Study" data-testid="artistry-ready">
            <ProjectStudio />
          </section>
        )}
      </div>
    </LensShell>
  );
}

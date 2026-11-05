'use client';

/**
 * Animation — the real frame-by-frame studio.
 *
 * anim-list is used once at page-load only to pass through the shared
 * admission-gate warm-up retry (a 503 here is boot lag, not a failed
 * query). Once that gate clears, two real panels are reachable by tab:
 *
 * - Studio: <AnimationStudioSection> — a gallery of shots (create,
 *   open, delete, start from a blank-scaffold template) that opens
 *   <AnimStudio>, a full frame-by-frame editor (canvas drawing, layers,
 *   onion-skinning, undo/redo, play/pause, audio tracks, brushes, bone
 *   rigging, and a real token-based share link via <AnimToolsPanel>).
 * - Reference images: <AnimationReferenceImages> — real rotoscope-style
 *   reference-image upload/gallery with "Import onto frame" onto
 *   whichever frame is open in Studio.
 *
 * All of this already existed in components/animation/ and called real
 * animation.* macros (server/domains/animation.js, ~55 macros) — it was
 * simply never mounted on this page, which had been reduced to a bare
 * title-only cabinet with no drawable surface and no way to reopen,
 * rename, or delete a shot (lens-reviews/animation.md F2/F3).
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';
import { AnimationStudioSection } from '@/components/animation/AnimationStudioSection';
import { AnimationReferenceImages } from '@/components/animation/AnimationReferenceImages';

type Phase = 'loading' | 'ready' | 'error';
type Tab = 'studio' | 'reference';

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

// anim-list is a small read. A 503 here is the admission gate refusing
// PROTECTED calls while boot lag is over 900ms, not a failed shot query.
// Retry on that gate only. Any other error surfaces immediately.
// AnimationStudioSection does its own anim-list call once mounted; this
// is solely to decide the page's loading/error/ready phase before
// handing off to it.
async function probeReady(): Promise<void> {
  let last = 'Could not reach the animation studio.';
  for (let attempt = 0; attempt < 8; attempt++) {
    const list = await lensRun<{ animations?: unknown }>('animation', 'anim-list', {});
    if (list.data?.ok) return;
    last = list.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

export default function AnimationPage() {
  useLensNav('animation');
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('studio');

  useEffect(() => {
    let cancelled = false;
    probeReady().then(() => {
      if (cancelled) return;
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the animation studio.');
    });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    probeReady().then(() => {
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the animation studio.');
    });
  }, []);

  const focusNewShot = useCallback(() => {
    setTab('studio');
    // Studio may not be mounted yet (switching away from Reference
    // images unmounts it) — defer the focus one tick so it runs after
    // React has flushed the tab swap.
    setTimeout(() => {
      const el = document.getElementById('anim-new-title');
      if (el instanceof HTMLInputElement) el.focus();
    }, 0);
  }, []);

  useLensCommand(
    [{ id: 'animation-new', keys: 'n', description: '+ New shot', category: 'actions', action: focusNewShot }],
    { lensId: 'animation' },
  );

  return (
    <LensShell lensId="animation" asMain={false}>
      <div data-lens-theme="animation" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Animation</h1>

        {phase === 'ready' && (
          <div className="mb-4 flex gap-2" role="tablist" aria-label="Animation views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'studio'}
              onClick={() => setTab('studio')}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                tab === 'studio' ? 'bg-cyan-500 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Studio
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'reference'}
              onClick={() => setTab('reference')}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                tab === 'reference' ? 'bg-cyan-500 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Reference images
            </button>
          </div>
        )}

        {phase === 'loading' && (
          <p data-testid="animation-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
            Opening the animation studio.
          </p>
        )}
        {phase === 'error' && (
          <div data-testid="animation-error" role="alert">
            <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the animation studio.'}</p>
            <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
              Retry
            </button>
          </div>
        )}
        {phase === 'ready' && tab === 'studio' && <AnimationStudioSection />}
        {phase === 'ready' && tab === 'reference' && <AnimationReferenceImages />}

        <button
          type="button"
          onClick={focusNewShot}
          disabled={phase !== 'ready'}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New shot
        </button>
      </div>
    </LensShell>
  );
}

'use client';

/**
 * Game Design — the real workbench.
 *
 * game-list is used once at page-load only to pass through the shared
 * admission-gate warm-up retry (a 503 here is boot lag, not a failed
 * query). Once that gate clears, <GameDesignSection> owns the design
 * roster + every tab: GDD, mechanics, loops, entities, levels (a real
 * paintable tile-grid level editor), narrative (a node/link story graph),
 * assets, animation, behavior (condition->action rules), playtest,
 * collab, and analysis. All of it already existed in
 * components/game-design/ and called real game-design.* macros — it was
 * simply never mounted on this page, which had been reduced to a bare
 * title-only card with no way to reopen, rename, delete, or actually
 * design anything (lens-reviews/game-design.md F2/F3).
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';
import { GameDesignSection } from '@/components/game-design/GameDesignSection';

type Phase = 'loading' | 'ready' | 'error';

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

// game-list is a small read. A 503 here is the admission gate refusing
// PROTECTED calls while boot lag is over 900ms, not a failed design
// query. Retry on that gate only. Any other error surfaces immediately.
// GameDesignSection does its own game-list call once mounted; this is
// solely to decide the page's loading/error/ready phase before handing
// off to it, so the warm-up retry behavior already fixed here survives.
async function probeReady(): Promise<void> {
  let last = 'Could not reach the design workbench.';
  for (let attempt = 0; attempt < 8; attempt++) {
    const list = await lensRun<{ games?: unknown }>('game-design', 'game-list', {});
    if (list.data?.ok) return;
    last = list.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

export default function GameDesignPage() {
  useLensNav('game-design');
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    probeReady().then(() => {
      if (cancelled) return;
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the design workbench.');
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
      setLoadError(err instanceof Error ? err.message : 'Could not load the design workbench.');
    });
  }, []);

  const focusNewDesign = useCallback(() => {
    const el = document.getElementById('gd-new-game-title');
    if (el instanceof HTMLInputElement) el.focus();
  }, []);

  useLensCommand(
    [{ id: 'game-design-new', keys: 'n', description: '+ New design', category: 'actions', action: focusNewDesign }],
    { lensId: 'game-design' },
  );

  return (
    <LensShell lensId="game-design" asMain={false}>
      <div data-lens-theme="game-design" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Game Design</h1>

        {phase === 'loading' && (
          <p data-testid="gd-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
            Opening the design workbench.
          </p>
        )}
        {phase === 'error' && (
          <div data-testid="gd-error" role="alert">
            <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the design workbench.'}</p>
            <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
              Retry
            </button>
          </div>
        )}
        {phase === 'ready' && <GameDesignSection />}

        <button
          type="button"
          onClick={focusNewDesign}
          disabled={phase !== 'ready'}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New design
        </button>
      </div>
    </LensShell>
  );
}

'use client';

/**
 * Housing — one player-housing app (claim / decorate / visit).
 *
 * Single active union (mine | visit). Screens extracted to panels; REST
 * routes + land_claims.list_for_user preserved.
 */

import { useCallback, useState } from 'react';
import { Home } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { MineHousesPanel } from '@/components/housing/MineHousesPanel';
import { VisitHousesPanel } from '@/components/housing/VisitHousesPanel';

type HousingView = 'mine' | 'visit';

const VIEWS: { id: HousingView; label: string; keys: string }[] = [
  { id: 'mine', label: 'My houses', keys: '1' },
  { id: 'visit', label: 'Visit', keys: '2' },
];

export default function HousingLensPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<HousingView>('mine');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const onFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 2500);
  }, []);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `housing-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'housing' },
  );

  return (
    <LensShell lensId="housing" asMain={false}>
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-emerald-950/10 text-slate-100">
        <header className="border-b border-emerald-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
              <Home className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Housing</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Claim land, place a building, decorate, lock the door.</p>
            </div>
            <nav className="flex gap-1" aria-label="Housing views">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActive(v.id)}
                  className={cn(
                    'rounded px-2 py-1 text-xs',
                    active === v.id ? 'bg-emerald-500/20 text-emerald-100' : 'text-slate-400 hover:text-slate-200',
                  )}
                >
                  {v.label}
                </button>
              ))}
            </nav>
          </div>
          {flash && (
            <div className={`mx-auto mt-2 max-w-screen-2xl rounded-md px-3 py-1 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
              {flash.msg}
            </div>
          )}
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            {active === 'mine' ? (
              <MineHousesPanel flash={flash} onFlash={onFlash} />
            ) : (
              <VisitHousesPanel onFlash={onFlash} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </LensShell>
  );
}

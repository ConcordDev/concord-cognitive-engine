'use client';

/**
 * Courtship — one romance-ops app.
 *
 * Single `active` union: courtships | marriages | family | past.
 * All REST + macros live in useCourtshipDesk (extracted from the welded page).
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Heart, Crown, Baby, History, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { HeartEventModal } from '@/components/courtship/HeartEventModal';
import { ConfirmDissolveModal } from '@/components/courtship/ConfirmDissolveModal';
import { useCourtshipDesk } from '@/components/courtship/useCourtshipDesk';
import { CourtshipsPanel } from '@/components/courtship/CourtshipsPanel';
import { MarriagesPanel } from '@/components/courtship/MarriagesPanel';
import { FamilyPanel } from '@/components/courtship/FamilyPanel';
import { PastMarriagesPanel } from '@/components/courtship/PastMarriagesPanel';

type CourtshipView = 'courtships' | 'marriages' | 'family' | 'past';

const VIEWS: { id: CourtshipView; label: string; keys: string; icon: typeof Heart }[] = [
  { id: 'courtships', label: 'Courtships', keys: 'c', icon: Heart },
  { id: 'marriages', label: 'Marriages', keys: 'm', icon: Crown },
  { id: 'family', label: 'Family', keys: 'f', icon: Baby },
  { id: 'past', label: 'Past', keys: 'p', icon: History },
];

export default function CourtshipLensPage() {
  useLensNav('courtship');
  useLensIdentity('courtship');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<CourtshipView>('courtships');
  const desk = useCourtshipDesk();

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'courtship' },
  );

  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="courtship" asMain={false}>
      <FirstRunTour lensId="courtship" />
      <DepthBadge lensId="courtship" size="sm" className="ml-2" />
      <div data-lens-theme="courtship" className={cn(ds.pageContainer, 'max-w-4xl mx-auto space-y-6')}>
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-pink-200">
            <Heart size={22} aria-hidden="true" /> Courtships
          </h1>
          <p className="text-sm text-zinc-400">Track affinity, propose, wed, raise children.</p>
        </header>

        <nav className="flex gap-1 border-b border-pink-500/20 overflow-x-auto" aria-label="Courtship views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on ? 'border-pink-400 text-pink-100' : 'border-transparent text-zinc-400 hover:text-pink-200',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline text-[10px] text-white/30 font-mono">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {desk.loadState === 'loading' && (
          <div
            data-testid="courtship-loading"
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-pink-500/20 bg-zinc-900/40 p-6 text-sm text-pink-200/80"
          >
            <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            Loading your courtships…
          </div>
        )}

        {desk.loadState === 'error' && (
          <div
            data-testid="courtship-error"
            role="alert"
            className="space-y-3 rounded-lg border border-red-500/40 bg-red-950/30 p-6"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
              <AlertTriangle size={16} aria-hidden="true" /> Couldn&apos;t load courtships
            </div>
            <p className="text-xs text-red-300/80">{desk.errorMsg || 'Something went wrong.'}</p>
            <button
              type="button"
              aria-label="Retry loading courtships"
              onClick={desk.refresh}
              className="inline-flex items-center gap-1 rounded bg-red-500/30 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/50"
            >
              <RefreshCw size={12} aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        {desk.loadState === 'ready' && (
          <>
            {desk.errorMsg && (
              <div role="alert" className="rounded border border-amber-500/40 bg-amber-950/30 p-2 text-xs text-amber-200">
                {desk.errorMsg}
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div key={active} {...motionProps}>
                {active === 'courtships' && <CourtshipsPanel desk={desk} />}
                {active === 'marriages' && <MarriagesPanel desk={desk} />}
                {active === 'family' && <FamilyPanel desk={desk} />}
                {active === 'past' && <PastMarriagesPanel desk={desk} />}
              </motion.div>
            </AnimatePresence>
          </>
        )}

        {desk.pending && (
          <div role="status" aria-live="polite" className="text-center text-xs text-pink-300/70">
            <Loader2 className="inline animate-spin" size={11} aria-hidden="true" /> updating…
          </div>
        )}
      </div>

      {desk.heartEvent && (
        <HeartEventModal
          scene={desk.heartEvent.scene}
          partnerLabel={desk.heartEvent.partnerLabel}
          onClose={() => desk.setHeartEvent(null)}
        />
      )}

      {desk.dissolveTarget && (
        <ConfirmDissolveModal
          partnerLabel={`${desk.dissolveTarget.partner_kind}:${String(desk.dissolveTarget.partner_id ?? "").slice(0, 14)}`}
          pending={desk.pending}
          onConfirm={desk.confirmDissolve}
          onCancel={() => desk.setDissolveTarget(null)}
        />
      )}
    </LensShell>
  );
}

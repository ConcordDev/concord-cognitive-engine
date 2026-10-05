'use client';

/**
 * Pets Lens — owner-facing pet-care & health-record app (Frontend
 * Rebuild Program, Wave 2). Capability map + reference-parity checklist:
 * docs/lens-specs/pets-capability-map.md.
 *
 * REBUILT: the previous page's PRIMARY visible surface was a generic
 * "Pets/Health/Feeding/Activity/Expenses/Documents" CRUD library backed
 * by `useLensData('pets', 'PetProfile'|'HealthRecord'|…)` — a fabricated,
 * fully disconnected data model (generic `STATE.lensArtifacts`, not the
 * real STATE-backed `pets.js` pet/vaccine/medication/weight records).
 * `PetActionDrawer`/`PetCarePlanner`/`ActivityWeightDashboard` all read
 * from that same fake store. That entire system is retired here. The
 * real, already-macro-wired `PetCareSection` (Health/Wellness/Reminders/
 * Care Services/Records & ID tabs, all real `pets.*` macros) is now the
 * lens's one and only pet-record surface, extended with two new tabs
 * (Insights, Discover) that fold in the fixed calculator/breed panels.
 *
 * Generic scaffold retired: `ManifestActionBar`, `AutoActionStrip`,
 * `RecentMineCard`, `CrossLensRecentsPanel`, `UniversalActions`,
 * `LensFeaturePanel` — plus `useRealtimeLens`/`LiveIndicator`/
 * `RealtimeDataPanel` (the `pets` domain has no `DOMAIN_EVENTS` entry in
 * `hooks/useRealtimeLens.ts`, so `isLive` was always `false`: a
 * permanently-dark "live" indicator, the same honesty smell the
 * supplychain rebuild found and removed).
 */

import { useCallback, useEffect, useState } from 'react';
import { PawPrint, RefreshCw, ShieldAlert } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { PetCareSection } from '@/components/pets/PetCareSection';
import { DensityToggle, ErrorState } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

interface LostCard { id: string; petName: string; status: string }

export default function PetsLensPage() {
  useLensNav('pets');
  const { user } = useAuth();

  const [activeLostCards, setActiveLostCards] = useState<LostCard[]>([]);
  const [lostLoading, setLostLoading] = useState(true);
  const [lostLoadError, setLostLoadError] = useState<string | null>(null);

  const applyLostCards = useCallback((r: { data?: { ok?: boolean; error?: string | null; result?: { cards?: LostCard[] } | null } }) => {
    if (r.data?.ok === false) {
      setLostLoadError(r.data?.error || 'Could not load lost-pet alerts.');
    } else {
      setLostLoadError(null);
      setActiveLostCards((r.data?.result?.cards || []).filter((c) => c.status === 'lost'));
    }
    setLostLoading(false);
  }, []);

  const refreshLostCards = useCallback(async () => {
    setLostLoading(true);
    applyLostCards(await lensRun('pets', 'lost-card-list', {}));
  }, [applyLostCards]);

  useEffect(() => {
    let cancelled = false;
    void lensRun('pets', 'lost-card-list', {}).then((r) => { if (!cancelled) applyLostCards(r); });
    return () => { cancelled = true; };
  }, [applyLostCards]);

  const focusAddPet = useCallback(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-pets-care] input:not([type="file"]), [data-pets-care] button[aria-label*="Add" i]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, []);

  useLensCommand(
    [
      { id: 'pets-add', keys: 'n', description: 'Add a pet', category: 'actions', action: focusAddPet },
      { id: 'refresh-lost-cards', keys: 'r', description: 'Refresh lost-pet alerts', category: 'actions', action: () => void refreshLostCards() },
    ],
    { lensId: 'pets' },
  );

  const who = titleCaseDisplayName(user?.username);

  return (
    <LensShell lensId="pets" asMain={false}>
      <FirstRunTour lensId="pets" />
      <DepthBadge lensId="pets" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="pets"
        crumb="Pets"
        title={who ? `How your pets are doing, ${who}` : 'How your pets are doing'}
        subtitle="Health records, vaccines, feeding, caregivers and lost-pet ID cards for pets you own."
        actions={
          <div className="flex items-center gap-2">
            <DensityToggle variant="dropdown" />
            <button
              type="button"
              onClick={() => void refreshLostCards()}
              disabled={lostLoading}
              className="rounded-full border border-white/10 p-2 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-50"
              aria-label="Refresh lost-pet alerts"
              title="r — refresh lost-pet alerts"
            >
              <RefreshCw className={cn('h-4 w-4', lostLoading && 'animate-spin')} />
            </button>
          </div>
        }
        cta={{ label: 'Add a pet', icon: PawPrint, onClick: focusAddPet, title: 'Add a pet (N)' }}
      >
        {lostLoadError && (
          <ErrorState variant="inline" message={lostLoadError} onRetry={() => void refreshLostCards()} />
        )}

        {activeLostCards.length > 0 && (
          <div role="alert" className="mb-4 flex items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {activeLostCards.length} active lost-pet report{activeLostCards.length === 1 ? '' : 's'}: {activeLostCards.map((c) => c.petName).join(', ')}. Open the Records tab for the public ID card.
            </span>
          </div>
        )}

        <div data-pets-care>
          <PetCareSection />
        </div>

        <section className="mt-5">
          <LensFeedButton domain="pets" label="Live dog-breed reference feed" />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}

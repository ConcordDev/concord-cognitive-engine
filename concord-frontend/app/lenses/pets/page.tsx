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
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { PetCareSection } from '@/components/pets/PetCareSection';
import { DensityToggle } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LostCard { id: string; petName: string; status: string }

export default function PetsLensPage() {
  useLensNav('pets');

  const [activeLostCards, setActiveLostCards] = useState<LostCard[]>([]);
  const [lostLoading, setLostLoading] = useState(true);

  const refreshLostCards = useCallback(async () => {
    setLostLoading(true);
    const r = await lensRun('pets', 'lost-card-list', {});
    const cards: LostCard[] = r.data?.result?.cards || [];
    setActiveLostCards(cards.filter((c) => c.status === 'lost'));
    setLostLoading(false);
  }, []);

  useEffect(() => { void refreshLostCards(); }, [refreshLostCards]);

  useLensCommand(
    [
      { id: 'refresh-lost-cards', keys: 'r', description: 'Refresh lost-pet alerts', category: 'actions', action: () => void refreshLostCards() },
    ],
    { lensId: 'pets' },
  );

  return (
    <LensShell lensId="pets" asMain={false}>
      <FirstRunTour lensId="pets" />
      <div data-lens-theme="pets" className="space-y-4 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <PawPrint className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white">Pets</h1>
                <DepthBadge lensId="pets" size="sm" />
              </div>
              <p className="text-xs text-gray-400">Health records, vaccines, feeding, caregivers &amp; lost-pet ID cards — for pets you own</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DensityToggle variant="dropdown" />
            <button
              type="button"
              onClick={() => void refreshLostCards()}
              disabled={lostLoading}
              className="p-1.5 rounded border border-lattice-border text-gray-400 hover:text-white hover:bg-lattice-elevated transition-colors disabled:opacity-50"
              aria-label="Refresh lost-pet alerts"
              title="r — refresh lost-pet alerts"
            >
              <RefreshCw className={cn('w-4 h-4', lostLoading && 'animate-spin')} />
            </button>
            <DTUExportButton domain="pets" data={{}} compact />
          </div>
        </header>

        {activeLostCards.length > 0 && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {activeLostCards.length} active lost-pet report{activeLostCards.length === 1 ? '' : 's'}: {activeLostCards.map((c) => c.petName).join(', ')} — open the Records tab for the public ID card.
            </span>
          </div>
        )}

        <PetCareSection />

        <section>
          <LensFeedButton domain="pets" label="Live dog-breed reference feed" />
        </section>
      </div>
    </LensShell>
  );
}

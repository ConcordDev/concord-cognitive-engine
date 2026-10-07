'use client';

/**
 * Eco lens: the north-star look (serif title, pill views, teal floating CTA)
 * over every real eco tool, grouped by intent and all kept on screen.
 * Air = Open-Meteo weather/AQI + saved-location alerts; Life = species ID,
 * GBIF sightings, life list; Footprint = calculator, trend, solar; Do = cited
 * climate actions + streak challenges; Organization = ESG scoring.
 */

import { useCallback, useState } from 'react';
import { Bird, Building2, Flame, Leaf, Plus, Wind } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import WeatherHero, { type WeatherPayload } from '@/components/lens/WeatherHero';
import { WeatherPanel } from '@/components/eco/WeatherPanel';
import { WeatherRadar } from '@/components/eco/WeatherRadar';
import { AQIPanel } from '@/components/eco/AQIPanel';
import { EnvAlerts } from '@/components/eco/EnvAlerts';
import { ClimateActions } from '@/components/eco/ClimateActions';
import { EcoChallenges } from '@/components/eco/EcoChallenges';
import { SpeciesIdentifier } from '@/components/eco/SpeciesIdentifier';
import { SpeciesSuggest } from '@/components/eco/SpeciesSuggest';
import { BiodiversityLog } from '@/components/eco/BiodiversityLog';
import { ObservationFeed } from '@/components/eco/ObservationFeed';
import { CarbonCalculator } from '@/components/eco/CarbonCalculator';
import { FootprintTrend } from '@/components/eco/FootprintTrend';
import { EnergyEstimator } from '@/components/eco/EnergyEstimator';
import { OrganizationESGPanel } from '@/components/eco/OrganizationESGPanel';
import { api } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

type View = 'air' | 'life' | 'footprint' | 'do' | 'org';

const VIEWS: { id: View; label: string; keys: string; title: string; hint: string; icon: typeof Wind }[] = [
  { id: 'air', label: 'Air', keys: '1', title: 'The air around you', hint: 'Weather, radar, AQI and alerts', icon: Wind },
  { id: 'life', label: 'Life', keys: '2', title: 'What lives near you', hint: 'Identify, log and browse species', icon: Bird },
  { id: 'footprint', label: 'Footprint', keys: '3', title: 'What you leave behind', hint: 'Carbon, trend and solar', icon: Leaf },
  { id: 'do', label: 'Do', keys: '4', title: 'What you can change', hint: 'Cited actions and habit streaks', icon: Flame },
  { id: 'org', label: 'Organization', keys: '5', title: 'How an organization scores', hint: 'Corporate ESG, not personal', icon: Building2 },
];

export default function EcoLensPage() {
  useLensNav('eco');
  useLensIdentity('eco');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('eco');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('air');
  const [footprintRefreshKey, setFootprintRefreshKey] = useState(0);
  const [lifeRefreshKey, setLifeRefreshKey] = useState(0);

  const logSighting = useCallback(() => {
    setView('life');
    requestAnimationFrame(() => document.getElementById('eco-species-id')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
      {
        id: 'eco-log-sighting',
        keys: 'n',
        description: 'Log a sighting',
        category: 'actions' as const,
        action: logSighting,
      },
    ],
    { lensId: 'eco' },
  );

  const handleAcceptSpecies = useCallback(async (s: { commonName: string; scientificName: string }, imageDataUrl?: string) => {
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'eco', action: 'biodiversity-log',
        input: { commonName: s.commonName, scientificName: s.scientificName, imageDataUrl, observedAt: new Date().toISOString() },
      });
      if (res.data?.ok === false) throw new Error(res.data?.error || 'Could not log that sighting.');
      useUIStore.getState().addToast({ type: 'success', message: `Logged ${s.commonName}.` });
      setLifeRefreshKey((k) => k + 1);
    } catch (e) {
      useUIStore.getState().addToast({ type: 'error', message: (e as Error).message || 'Could not log that sighting.' });
    }
  }, []);

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="eco" asMain={false}>
      <FirstRunTour lensId="eco" />
      <DepthBadge lensId="eco" size="sm" className="ml-2" />
      <div data-lens-theme="eco" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Ecosystem</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{view === 'air' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <DTUExportButton domain="eco" data={{}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Eco views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {view === 'air' && (
          <div className="space-y-5">
            <WeatherHero data={realtimeData as WeatherPayload | null} isLive={isLive} lastUpdated={lastUpdated} />
            <div className="grid gap-5 xl:grid-cols-2">
              <AQIPanel />
              <WeatherRadar />
            </div>
            <div className="grid gap-5 xl:grid-cols-2">
              <EnvAlerts />
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4"><WeatherPanel /></section>
            </div>
            <RealtimeDataPanel domain="eco" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
          </div>
        )}

        {view === 'life' && (
          <div className="space-y-5">
            <div id="eco-species-id" className="grid scroll-mt-6 gap-5 xl:grid-cols-2">
              <SpeciesIdentifier onAccept={handleAcceptSpecies} />
              <BiodiversityLog key={lifeRefreshKey} />
            </div>
            <div className="grid gap-5 xl:grid-cols-2">
              <ObservationFeed />
              <SpeciesSuggest />
            </div>
          </div>
        )}

        {view === 'footprint' && (
          <div className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-2">
              <CarbonCalculator onSaved={() => setFootprintRefreshKey((k) => k + 1)} />
              <FootprintTrend key={footprintRefreshKey} />
            </div>
            <EnergyEstimator />
          </div>
        )}

        {view === 'do' && (
          <div className="grid gap-5 xl:grid-cols-2">
            <ClimateActions />
            <EcoChallenges />
          </div>
        )}

        {view === 'org' && (
          <div className="max-w-5xl">
            <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-zinc-500">
              Scores an organization or team on board diversity, compliance and labor practices. It is not a personal footprint metric.
            </p>
            <OrganizationESGPanel />
          </div>
        )}

        <CrossLensRecentsPanel lensId="eco" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={logSighting}
          title="Log a sighting (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Log a sighting
        </button>
      </div>
    </LensShell>
  );
}

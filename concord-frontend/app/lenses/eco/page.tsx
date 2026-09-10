'use client';

import { useCallback, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WeatherPanel } from '@/components/eco/WeatherPanel';
import { WeatherRadar } from '@/components/eco/WeatherRadar';
import { AQIPanel } from '@/components/eco/AQIPanel';
import { ClimateActions } from '@/components/eco/ClimateActions';
import { SpeciesIdentifier } from '@/components/eco/SpeciesIdentifier';
import { EnergyEstimator } from '@/components/eco/EnergyEstimator';
import { BiodiversityLog } from '@/components/eco/BiodiversityLog';
import { ObservationFeed } from '@/components/eco/ObservationFeed';
import { FootprintTrend } from '@/components/eco/FootprintTrend';
import { CarbonCalculator } from '@/components/eco/CarbonCalculator';
import { EcoChallenges } from '@/components/eco/EcoChallenges';
import { EnvAlerts } from '@/components/eco/EnvAlerts';
import { SpeciesSuggest } from '@/components/eco/SpeciesSuggest';
import { OrganizationESGPanel } from '@/components/eco/OrganizationESGPanel';
import { api } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import {
  Leaf, Sun, Wind, TreeDeciduous, Cloud, Bug, Globe, Bird, LineChart, Flame, Bell, Building2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { cn } from '@/lib/utils';
import WeatherHero, { type WeatherPayload } from '@/components/lens/WeatherHero';
import { EcoOverviewHero } from '@/components/eco/EcoOverviewHero';

// ── Types ─────────────────────────────────────────────────────────────────────

type EcoTab = 'overview' | 'weather' | 'air' | 'actions' | 'species' | 'energy' | 'lifelist' | 'feed' | 'footprint' | 'challenges' | 'alerts' | 'org-esg';

// ── Component ─────────────────────────────────────────────────────────────────

export default function EcoLensPage() {
  useLensNav('eco');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('eco');

  const [activeTab, setActiveTab] = useState<EcoTab>('overview');
  const [footprintRefreshKey, setFootprintRefreshKey] = useState(0);

  // Lens-scoped keyboard commands (auto-wired by codemod; remapped to the
  // real, backend-wired tabs after the fabricated overview/populations/
  // climate/biodiversity-sim/impact scaffold was removed — see the eco
  // capability map for why).
  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveTab('overview') },
      { id: 'tab-weather', keys: 'w', description: 'Weather', category: 'navigation', action: () => setActiveTab('weather') },
      { id: 'tab-air', keys: 'q', description: 'Air quality', category: 'navigation', action: () => setActiveTab('air') },
      { id: 'tab-species', keys: 's', description: 'Species ID', category: 'navigation', action: () => setActiveTab('species') },
      { id: 'tab-footprint', keys: 'f', description: 'Footprint trend', category: 'navigation', action: () => setActiveTab('footprint') },
      { id: 'tab-org-esg', keys: 'g', description: 'Org ESG (not personal)', category: 'navigation', action: () => setActiveTab('org-esg') },
    ],
    { lensId: 'eco' }
  );

  const handleAcceptSpecies = useCallback(async (s: { commonName: string; scientificName: string }, imageDataUrl?: string) => {
    try {
      await api.post('/api/lens/run', {
        domain: 'eco', action: 'biodiversity-log',
        input: { commonName: s.commonName, scientificName: s.scientificName, imageDataUrl, observedAt: new Date().toISOString() },
      });
    } catch (e) {
      console.error('[Eco] log species failed', e);
    }
  }, []);

  const handleFootprintSaved = useCallback(() => {
    setFootprintRefreshKey((k) => k + 1);
  }, []);

  const tabs: { id: EcoTab; label: string; icon: React.ComponentType<{ className?: string }>; blurb: string; shortcut?: string }[] = [
    { id: 'weather', label: 'Weather', icon: Cloud, blurb: '7-day forecast + hourly detail from Open-Meteo, live for any coordinate.', shortcut: 'w' },
    { id: 'air', label: 'Air quality', icon: Wind, blurb: 'US AQI + PM2.5/PM10/O₃/NO₂/SO₂/CO from Open-Meteo Air Quality.', shortcut: 'q' },
    { id: 'actions', label: 'Climate actions', icon: Leaf, blurb: 'Curated high-impact actions cited to Drawdown/IPCC/EPA — log what you do.' },
    { id: 'species', label: 'Species ID', icon: Bug, blurb: 'Photograph an organism; LLaVA vision suggests candidate species.', shortcut: 's' },
    { id: 'feed', label: 'Sightings feed', icon: Bird, blurb: 'Real biodiversity occurrence records near you, from GBIF.' },
    { id: 'lifelist', label: 'Life list', icon: TreeDeciduous, blurb: 'Your personal species log, with a Shannon/Simpson diversity index.' },
    { id: 'footprint', label: 'Footprint trend', icon: LineChart, blurb: 'Compute a real carbon footprint and track it as a trend over time.', shortcut: 'f' },
    { id: 'challenges', label: 'Challenges', icon: Flame, blurb: 'Recurring sustainability habits with streaks, JouleBug-style.' },
    { id: 'alerts', label: 'Eco alerts', icon: Bell, blurb: 'Save locations; get AQI/UV/pollen alerts against published thresholds.' },
    { id: 'energy', label: 'Solar estimator', icon: Sun, blurb: 'Deterministic PVWatts-style solar production estimate for any site.' },
  ];

  // Deliberately kept OUT of `tabs` above: this one scores an ORGANIZATION,
  // not a person, so it's rendered as its own visually-distinct section
  // (amber, not the lens's personal-ecology green) rather than mixed into
  // the personal-tool grid where it could be mistaken for a personal score.
  const orgTab = { id: 'org-esg' as const, label: 'Org ESG', icon: Building2, blurb: 'Corporate ESG scoring (board diversity, compliance, labor practices) for an organization or team — not a personal footprint metric.', shortcut: 'g' };

  return (
    <LensShell lensId="eco" asMain={false}>
      <FirstRunTour lensId="eco" />
      <DepthBadge lensId="eco" size="sm" className="ml-2" />
    <div data-lens-theme="eco" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌿</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Eco Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">
              Weather, air quality, species ID, carbon footprint, and sustainability tracking — all real data, no simulation.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="eco" data={{}} compact />
        </div>
      </header>

      {/* Live Open-Meteo weather hero — temperature + conditions + 7-day strip */}
      <WeatherHero
        data={realtimeData as WeatherPayload | null}
        isLive={isLive}
        lastUpdated={lastUpdated}
      />

      <RealtimeDataPanel domain="eco" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* Tab Navigation — a shared `motion.span` layoutId slides between
          whichever button is active, driven purely by real `activeTab`
          state (a data-driven transition, not a page-mount fade). */}
      <nav className={cn('flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap')}>
        <button
          onClick={() => setActiveTab('overview')}
          className={cn(
            'relative flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap',
            activeTab === 'overview' ? 'text-neon-green' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated transition-colors'
          )}
        >
          {activeTab === 'overview' && (
            <motion.span layoutId="eco-tab-pill" className="absolute inset-0 rounded-lg bg-neon-green/20" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
          )}
          <Globe className="w-4 h-4 relative" />
          <span className="relative">Overview</span>
        </button>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap',
              activeTab === tab.id ? 'text-neon-green' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated transition-colors'
            )}
          >
            {activeTab === tab.id && (
              <motion.span layoutId="eco-tab-pill" className="absolute inset-0 rounded-lg bg-neon-green/20" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
            )}
            <tab.icon className="w-4 h-4 relative" />
            <span className="relative">{tab.label}</span>
          </button>
        ))}
        {/* Visually separated (divider + amber accent) — an organization
            tool living among personal-ecology tabs, kept honestly distinct. */}
        <span className="w-px h-5 bg-lattice-border mx-1" aria-hidden="true" />
        <button
          onClick={() => setActiveTab('org-esg')}
          title="Organization ESG — not a personal footprint metric"
          className={cn(
            'relative flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap',
            activeTab === 'org-esg' ? 'text-amber-300' : 'text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10 transition-colors'
          )}
        >
          {activeTab === 'org-esg' && (
            <motion.span layoutId="eco-tab-pill" className="absolute inset-0 rounded-lg bg-amber-500/20" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
          )}
          <orgTab.icon className="w-4 h-4 relative" />
          <span className="relative">{orgTab.label}</span>
        </button>
      </nav>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <EcoOverviewHero tabs={tabs} orgTab={orgTab} onSelectTab={(id) => setActiveTab(id as EcoTab)} />
      )}
      {activeTab === 'weather' && <WeatherRadar />}
      {activeTab === 'air' && <AQIPanel />}
      {activeTab === 'actions' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <ClimateActions />
          </div>
          <div className="lens-card text-xs text-gray-400 space-y-2">
            <h3 className="text-sm font-bold text-white">Why this matters</h3>
            <p>Each action below cites real lifecycle research. The kgCO₂e saved is a per-instance estimate; the more you log, the more accurate your annual delta.</p>
            <p>Log the actions you take below; the Footprint trend tab turns your running total into a tracked delta over time.</p>
          </div>
        </div>
      )}
      {activeTab === 'species' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SpeciesIdentifier onAccept={handleAcceptSpecies} />
            <BiodiversityLog />
          </div>
          <SpeciesSuggest />
        </div>
      )}
      {activeTab === 'feed' && <ObservationFeed />}
      {activeTab === 'lifelist' && <BiodiversityLog />}
      {activeTab === 'footprint' && (
        <div className="space-y-4">
          <CarbonCalculator onSaved={handleFootprintSaved} />
          <FootprintTrend key={footprintRefreshKey} />
        </div>
      )}
      {activeTab === 'challenges' && <EcoChallenges />}
      {activeTab === 'alerts' && <EnvAlerts />}
      {activeTab === 'energy' && <EnergyEstimator />}
      {activeTab === 'org-esg' && <OrganizationESGPanel />}

      {/* Bespoke Open-Meteo weather + AQI with Save-as-DTU */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <WeatherPanel />
      </section>
    </div>          <CrossLensRecentsPanel lensId="eco" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

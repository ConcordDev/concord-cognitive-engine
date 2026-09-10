'use client';

import dynamic from 'next/dynamic';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EarthquakeList } from '@/components/geology/EarthquakeList';
import { FieldLog } from '@/components/geology/FieldLog';
import { GeologicMapPanel } from '@/components/geology/GeologicMapPanel';
import { StructuralCompass } from '@/components/geology/StructuralCompass';
import { SamplePhotoCapture } from '@/components/geology/SamplePhotoCapture';
import { SpecimenCollection } from '@/components/geology/SpecimenCollection';
import { FieldTripPlanner } from '@/components/geology/FieldTripPlanner';
import { RockMineralIdPanel } from '@/components/geology/RockMineralIdPanel';
import { SeismicHazardPanel } from '@/components/geology/SeismicHazardPanel';
import { StratigraphicColumnPanel } from '@/components/geology/StratigraphicColumnPanel';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { UsgsQuakePanel } from '@/components/geology/UsgsQuakePanel';
import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';
import { useState } from 'react';
import {
  Mountain,
  Compass,
  Gem,
  ShieldAlert,
  Map,
  BookMarked,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { LensPageShell } from '@/components/lens/LensPageShell';

type GeoTab = 'field' | 'identify' | 'structure' | 'seismic' | 'map' | 'collection';

const TABS: { key: GeoTab; label: string; icon: typeof Mountain }[] = [
  { key: 'field', label: 'Field Log', icon: Mountain },
  { key: 'identify', label: 'Identify', icon: Gem },
  { key: 'structure', label: 'Structure & Strat', icon: Compass },
  { key: 'seismic', label: 'Seismic', icon: ShieldAlert },
  { key: 'map', label: 'Map', icon: Map },
  { key: 'collection', label: 'Collection', icon: BookMarked },
];

export default function GeologyLensPage() {
  const [activeTab, setActiveTab] = useState<GeoTab>('field');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-field', keys: 'f', description: 'Field log', category: 'navigation', action: () => setActiveTab('field') },
      { id: 'tab-identify', keys: 'i', description: 'Identify', category: 'navigation', action: () => setActiveTab('identify') },
      { id: 'tab-structure', keys: 't', description: 'Structure & stratigraphy', category: 'navigation', action: () => setActiveTab('structure') },
      { id: 'tab-seismic', keys: 'q', description: 'Seismic', category: 'navigation', action: () => setActiveTab('seismic') },
      { id: 'tab-map', keys: 'm', description: 'Map', category: 'navigation', action: () => setActiveTab('map') },
      { id: 'tab-collection', keys: 'c', description: 'Collection', category: 'navigation', action: () => setActiveTab('collection') },
    ],
    { lensId: 'geology' }
  );

  return (
    <LensShell lensId="geology" asMain={false}>
      <FirstRunTour lensId="geology" />      <DepthBadge lensId="geology" size="sm" className="ml-2" />
      <LensPageShell
        domain="geology"
        title="Geology Lens"
        description="Field observations, rock & mineral ID, structural geology, seismic hazard, and stratigraphy"
        headerIcon={<Mountain className="w-6 h-6 text-orange-400" />}
      >
        {/* Tabs */}
        <div className="flex gap-2 border-b border-white/10 pb-2 flex-wrap">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === key ? 'bg-orange-400/20 text-orange-400 border-b-2 border-orange-400' : 'text-gray-400 hover:text-white'}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {activeTab === 'field' && (
          <div className="panel p-4">
            <FieldLog />
          </div>
        )}

        {activeTab === 'identify' && (
          <div className="panel p-4">
            <RockMineralIdPanel />
          </div>
        )}

        {activeTab === 'structure' && (
          <div className="space-y-4">
            <div className="panel p-4">
              <StructuralCompass />
            </div>
            <div className="panel p-4">
              <StratigraphicColumnPanel />
            </div>
          </div>
        )}

        {activeTab === 'seismic' && (
          <div className="space-y-4">
            <div className="panel p-4">
              <SeismicHazardPanel />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <UsgsQuakePanel />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <EarthquakeList />
            </div>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="space-y-4">
            <div className="panel p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Map className="w-4 h-4 text-orange-400" /> Field Sites Map
              </h3>
              <MapView markers={[]} className="h-[420px]" />
              <p className="text-[11px] text-gray-500 mt-2">
                Geotagged observations and strike/dip measurements appear on the bedrock overlay below once logged in Field Log / Structure.
              </p>
            </div>
            {/* Macrostrat geologic-map overlay + "rocks near me" bedrock lookup */}
            <div className="panel p-4">
              <GeologicMapPanel />
            </div>
          </div>
        )}

        {activeTab === 'collection' && (
          <div className="space-y-4">
            {/* Geotagged sample photos with EXIF GPS */}
            <div className="panel p-4">
              <SamplePhotoCapture />
            </div>
            {/* Minerals & rocks identified checklist */}
            <div className="panel p-4">
              <SpecimenCollection />
            </div>
            {/* Field-trip / outcrop sequencing */}
            <div className="panel p-4">
              <FieldTripPlanner />
            </div>
          </div>
        )}

        {/* Live Web Feed */}
        <div className="px-4 mb-2">
          <LensFeedPanel lensId="geology" />
        </div>
        {/* Live Wikipedia geology reference. */}
        <section className="mt-4 mx-4">
          <WikipediaSearchPanel domain="geology" title="Wikipedia · geology" />
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 mx-4">
          <LensFeedButton domain="geology" />
        </section>
      </LensPageShell>      <CrossLensRecentsPanel lensId="geology" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

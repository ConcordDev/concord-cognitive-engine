'use client';

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { FireIncidents } from '@/components/forestry/FireIncidents';
import { ForestryActionPanel } from '@/components/forestry/ForestryActionPanel';
import { StandManager } from '@/components/forestry/StandManager';
import { GrowthProjectionPanel } from '@/components/forestry/GrowthProjectionPanel';
import { StandPolygonPanel } from '@/components/forestry/StandPolygonPanel';
import { CruisePanel } from '@/components/forestry/CruisePanel';
import { PestPanel } from '@/components/forestry/PestPanel';
import { ReplantingPanel } from '@/components/forestry/ReplantingPanel';
import { CarbonCreditPanel } from '@/components/forestry/CarbonCreditPanel';
import { GbifPanel } from '@/components/environment/GbifPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { TreePine, Calculator, Flame, Ruler, Bug, Coins, Map, Plus } from 'lucide-react';

/**
 * Forestry lens: north-star chrome over stand management, timber and
 * silviculture calculators, wildfire watch, growth projection and cruise
 * inventory, pests and replanting, carbon credits, and stand polygons with
 * GBIF wildlife. Every tab is a real forestry.* workbench.
 */

type ForestryTab = 'stands' | 'calculators' | 'fire' | 'growth' | 'pests' | 'carbon' | 'map';

const TABS: { key: ForestryTab; label: string; keys: string; title: string; hint: string; icon: typeof TreePine }[] = [
  { key: 'stands', label: 'Stands', keys: 's', title: 'Your stands', hint: 'Stand registry, activities, dashboard', icon: TreePine },
  { key: 'calculators', label: 'Calculators', keys: 'c', title: 'Run the timber numbers', hint: 'Board feet, volume, site index, harvest planning', icon: Calculator },
  { key: 'fire', label: 'Fire Watch', keys: 'f', title: 'What is burning near you', hint: 'Live wildfire incidents', icon: Flame },
  { key: 'growth', label: 'Growth & Inventory', keys: 'g', title: 'How the forest will grow', hint: 'Growth and yield projection, timber cruise', icon: Ruler },
  { key: 'pests', label: 'Pests & Replanting', keys: 'p', title: 'Protect and renew', hint: 'Pest and disease tracking, replanting plans', icon: Bug },
  { key: 'carbon', label: 'Carbon Credits', keys: 'b', title: 'What the carbon is worth', hint: 'Carbon stock and credit estimates', icon: Coins },
  { key: 'map', label: 'Map & Wildlife', keys: 'm', title: 'Draw and survey', hint: 'Stand polygons and GBIF wildlife', icon: Map },
];

export default function ForestryLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [activeTab, setActiveTab] = useState<ForestryTab>('stands');

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.key}`,
        keys: t.keys,
        description: `${t.label} — ${t.hint}`,
        category: 'navigation' as const,
        action: () => setActiveTab(t.key),
      })),
      { id: 'forestry-new-stand', keys: 'n', description: 'Add a stand', category: 'actions' as const, action: () => setActiveTab('stands') },
    ],
    { lensId: 'forestry' },
  );

  const current = TABS.find((t) => t.key === activeTab)!;

  return (
    <LensShell lensId="forestry" asMain={false}>
      <FirstRunTour lensId="forestry" />
      <DepthBadge lensId="forestry" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="forestry"
        crumb="Forestry"
        title={`${current.title}${activeTab === 'stands' && who ? `, ${who}` : ''}`}
        subtitle="Timber stands, harvest planning, fire management, growth and yield, pests and carbon credits."
        tabs={TABS.map((t) => ({ id: t.key, label: t.label, keys: t.keys, hint: t.hint, icon: t.icon }))}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as ForestryTab)}
        cta={{ label: 'Add a stand', icon: Plus, onClick: () => setActiveTab('stands'), title: 'Add a stand (N)' }}
      >
        {activeTab === 'stands' && <StandManager />}
        {activeTab === 'calculators' && (
          <PipingProvider>
            <ForestryActionPanel />
          </PipingProvider>
        )}
        {activeTab === 'fire' && (
          <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <FireIncidents />
          </div>
        )}
        {activeTab === 'growth' && (
          <div className="space-y-5">
            <GrowthProjectionPanel />
            <CruisePanel />
          </div>
        )}
        {activeTab === 'pests' && (
          <div className="space-y-5">
            <PestPanel />
            <ReplantingPanel />
          </div>
        )}
        {activeTab === 'carbon' && <CarbonCreditPanel />}
        {activeTab === 'map' && (
          <div className="space-y-5">
            <StandPolygonPanel />
            <GbifPanel domain="forestry" />
          </div>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}

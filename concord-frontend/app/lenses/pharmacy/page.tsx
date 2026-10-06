'use client';

import { useState } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { PharmacyOverview } from '@/components/pharmacy/PharmacyOverview';
import { PharmacyRxSection } from '@/components/pharmacy/PharmacyRxSection';
import { FdaDrugReference } from '@/components/pharmacy/FdaDrugReference';
import { FdaLivePanel } from '@/components/pharmacy/FdaLivePanel';
import { RxFormularyToolsPanel } from '@/components/pharmacy/RxFormularyToolsPanel';
import { PharmacyActionPanel } from '@/components/pharmacy/PharmacyActionPanel';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { PipingProvider } from '@/components/panel-polish';
import { Pill, AlertTriangle, ShieldCheck, LayoutGrid, HeartPulse, Bell, Plus } from 'lucide-react';

type Destination = 'overview' | 'meds' | 'reference' | 'bench';

const DESTINATIONS: { id: Destination; label: string; icon: typeof Pill; key: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, key: 'o' },
  { id: 'meds', label: 'My Meds', icon: Pill, key: 'm' },
  { id: 'reference', label: 'Drug Reference & Safety', icon: HeartPulse, key: 'd' },
  { id: 'bench', label: 'Rx Bench', icon: Bell, key: 'b' },
];

export default function PharmacyLensPage() {
  useLensNav('pharmacy');

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [destination, setDestination] = useState<Destination>('overview');
  const [referenceTab, setReferenceTab] = useState<'lookup' | 'browse' | 'tools'>('lookup');

  useLensCommand(
    DESTINATIONS.map((d) => ({
      id: `dest-${d.id}`, keys: d.key, description: d.label, category: 'navigation',
      action: () => setDestination(d.id),
    })),
    { lensId: 'pharmacy' },
  );

  return (
    <LensShell lensId="pharmacy" asMain={false}>
      <FirstRunTour lensId="pharmacy" />
      <DepthBadge lensId="pharmacy" size="sm" className="ml-2" />

      <NorthStarFrame
        lensId="pharmacy"
        crumb="Pharmacy"
        title={`Your medications${who ? `, ${who}` : ''}`}
        subtitle="Dose adherence, refills, pricing and FDA drug safety reference"
        tabs={DESTINATIONS.map((d) => ({ id: d.id, label: d.label, icon: d.icon, keys: d.key }))}
        activeTab={destination}
        onTab={(id) => setDestination(id as Destination)}
        tabsLabel="Pharmacy destinations"
        cta={{ label: 'Add a medication', icon: Plus, onClick: () => setDestination('meds'), title: 'Open My Meds' }}
      >
        <div className="space-y-5">
        {/* Safety disclaimer — always visible, not tab-scoped */}
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-red-200">
              Not medical or pharmaceutical advice. Always consult a licensed healthcare provider or pharmacist before
              starting, stopping, or changing any medication. Do not rely on this tool for drug interaction or dosage decisions.
            </p>
            <span className="flex items-center gap-1 text-xs text-red-400/70 mt-1">
              <ShieldCheck className="w-3 h-3" /> Informational only
            </span>
          </div>
        </div>

        {destination === 'overview' && <PharmacyOverview onNavigate={setDestination} />}

        {destination === 'meds' && <PharmacyRxSection />}

        {destination === 'reference' && (
          <div className="space-y-3">
            <div className="flex gap-1 border-b border-white/5">
              {([
                { id: 'lookup' as const, label: 'Deep Dive (single drug)' },
                { id: 'browse' as const, label: 'Browse & Recalls' },
                { id: 'tools' as const, label: 'Formulary & Inventory Tools' },
              ]).map((t) => (
                <button key={t.id} type="button" onClick={() => setReferenceTab(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    referenceTab === t.id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            {referenceTab === 'lookup' && (
              <div className="panel p-4"><FdaDrugReference /></div>
            )}
            {referenceTab === 'browse' && <FdaLivePanel />}
            {referenceTab === 'tools' && <RxFormularyToolsPanel />}
          </div>
        )}

        {destination === 'bench' && (
          <PipingProvider>
            <div className="space-y-4">
              <PharmacyActionPanel />
              <div className="panel p-4">
                <label className="block text-xs text-gray-400 mb-1">Patient / counseling notes (auto-saved as you type)</label>
                <DraftedTextarea
                  lensId="pharmacy"
                  draftKey="rxBenchNotes"
                  placeholder="Notes, allergies, prior reactions, doctor's instructions…"
                  className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm h-24 resize-y"
                  wrapperClassName="w-full"
                />
              </div>
            </div>
          </PipingProvider>
        )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}

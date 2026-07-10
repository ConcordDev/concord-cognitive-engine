'use client';

import { useState } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PharmacyOverview } from '@/components/pharmacy/PharmacyOverview';
import { PharmacyRxSection } from '@/components/pharmacy/PharmacyRxSection';
import { FdaDrugReference } from '@/components/pharmacy/FdaDrugReference';
import { FdaLivePanel } from '@/components/pharmacy/FdaLivePanel';
import { RxFormularyToolsPanel } from '@/components/pharmacy/RxFormularyToolsPanel';
import { PharmacyActionPanel } from '@/components/pharmacy/PharmacyActionPanel';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { PipingProvider } from '@/components/panel-polish';
import { Pill, AlertTriangle, ShieldCheck, LayoutGrid, HeartPulse, Bell } from 'lucide-react';

type Destination = 'overview' | 'meds' | 'reference' | 'bench';

const DESTINATIONS: { id: Destination; label: string; icon: typeof Pill; key: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, key: 'o' },
  { id: 'meds', label: 'My Meds', icon: Pill, key: 'm' },
  { id: 'reference', label: 'Drug Reference & Safety', icon: HeartPulse, key: 'd' },
  { id: 'bench', label: 'Rx Bench', icon: Bell, key: 'b' },
];

export default function PharmacyLensPage() {
  useLensNav('pharmacy');

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

      <div data-lens-theme="pharmacy" className="p-6 space-y-5">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Pill className="w-8 h-8 text-amber-400" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">Pharmacy</h1>
                <DepthBadge lensId="pharmacy" size="sm" />
              </div>
              <p className="text-sm text-gray-400">Medications, dose adherence, refills, pricing and FDA drug safety reference</p>
            </div>
          </div>
        </header>

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

        {/* Destination nav */}
        <nav className="flex gap-1 border-b border-white/10 pb-0.5 overflow-x-auto" aria-label="Pharmacy destinations">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon;
            const active = destination === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDestination(d.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                  active ? 'bg-amber-500/20 text-amber-300 border-b-2 border-amber-400' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {d.label}
              </button>
            );
          })}
        </nav>

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
    </LensShell>
  );
}

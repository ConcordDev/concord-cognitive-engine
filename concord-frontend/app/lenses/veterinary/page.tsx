'use client';

import { useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { VetFeed } from '@/components/veterinary/VetFeed';
import { DashboardPanel } from '@/components/veterinary/DashboardPanel';
import { PatientsPanel } from '@/components/veterinary/PatientsPanel';
import { AppointmentsPanel } from '@/components/veterinary/AppointmentsPanel';
import { BillingPanel } from '@/components/veterinary/BillingPanel';
import { RecordsPanel } from '@/components/veterinary/RecordsPanel';
import { PharmacyPanel } from '@/components/veterinary/PharmacyPanel';
import { LabPanel } from '@/components/veterinary/LabPanel';
import { InventoryPanel } from '@/components/veterinary/InventoryPanel';
import { RemindersPanel } from '@/components/veterinary/RemindersPanel';
import { OwnerPortalPanel } from '@/components/veterinary/OwnerPortalPanel';
import { CalculatorsPanel } from '@/components/veterinary/CalculatorsPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import {
  Heart,
  BarChart3,
  Calendar,
  Receipt,
  ClipboardList,
  Pill,
  FlaskConical,
  Boxes,
  BellRing,
  UserCircle,
  Calculator,
} from 'lucide-react';

type ModeTab =
  | 'Dashboard'
  | 'Patients'
  | 'Appointments'
  | 'Billing'
  | 'Records'
  | 'Pharmacy'
  | 'Lab'
  | 'Inventory'
  | 'Reminders'
  | 'Owner Portal'
  | 'Calculators';

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Heart }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Patients', label: 'Patients', icon: Heart },
  { key: 'Appointments', label: 'Appointments', icon: Calendar },
  { key: 'Billing', label: 'Billing', icon: Receipt },
  { key: 'Records', label: 'SOAP Records', icon: ClipboardList },
  { key: 'Pharmacy', label: 'Pharmacy', icon: Pill },
  { key: 'Lab', label: 'Lab & Imaging', icon: FlaskConical },
  { key: 'Inventory', label: 'Inventory', icon: Boxes },
  { key: 'Reminders', label: 'Reminders', icon: BellRing },
  { key: 'Owner Portal', label: 'Owner Portal', icon: UserCircle },
  { key: 'Calculators', label: 'Calculators', icon: Calculator },
];

export default function VeterinaryLensPage() {
  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  const bumpDashboard = () => setRefreshKey((k) => k + 1);

  useLensCommand(
    [
      {
        id: 'goto-dashboard',
        keys: 'd',
        description: 'Dashboard',
        category: 'navigation',
        action: () => setActiveMode('Dashboard'),
      },
      {
        id: 'goto-patients',
        keys: 'p',
        description: 'Patients',
        category: 'navigation',
        action: () => setActiveMode('Patients'),
      },
      {
        id: 'goto-appointments',
        keys: 'a',
        description: 'Appointments',
        category: 'navigation',
        action: () => setActiveMode('Appointments'),
      },
    ],
    { lensId: 'veterinary' },
  );

  return (
    <LensShell lensId="veterinary" asMain={false}>
      <FirstRunTour lensId="veterinary" />
      <ManifestActionBar />
      <DepthBadge lensId="veterinary" size="sm" className="ml-2" />
      <LensVerticalHero lensId="veterinary" className="mx-6 mt-4" />
      <LensPageShell
        domain="veterinary"
        title="Veterinary Practice"
        description="Patients, scheduling, billing, SOAP charting, pharmacy, lab, inventory & owner portal"
        headerIcon={<Heart className="h-5 w-5 text-pink-400" />}
      >
        <div ref={tabsRef} className="flex flex-wrap gap-1 rounded-lg bg-zinc-900 p-1">
          {MODE_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveMode(key)}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                activeMode === key
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-300',
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {activeMode === 'Dashboard' && <DashboardPanel refreshKey={refreshKey} />}
          {activeMode === 'Patients' && <PatientsPanel onChanged={bumpDashboard} />}
          {activeMode === 'Appointments' && <AppointmentsPanel onChanged={bumpDashboard} />}
          {activeMode === 'Billing' && <BillingPanel onChanged={bumpDashboard} />}
          {activeMode === 'Records' && <RecordsPanel />}
          {activeMode === 'Pharmacy' && <PharmacyPanel />}
          {activeMode === 'Lab' && <LabPanel />}
          {activeMode === 'Inventory' && <InventoryPanel />}
          {activeMode === 'Reminders' && <RemindersPanel />}
          {activeMode === 'Owner Portal' && <OwnerPortalPanel />}
          {activeMode === 'Calculators' && <CalculatorsPanel />}
        </div>

        <UniversalActions domain="veterinary" artifactId={null} />

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <VetFeed />
        </section>
      </LensPageShell>

      {/* accessibility-only sentinels — never visually displayed */}
      <div className="sr-only" aria-hidden="true">
        Veterinary practice-management lens with patients, scheduling, billing, charting and pharmacy.
      </div>
      <a
        href="#veterinary-skip"
        className="sr-only focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        Skip to veterinary content
      </a>
      <section className="mt-4">
        <LensFeedButton domain="veterinary" label="Live vet-safety feed" />
      </section>
      <RecentMineCard domain="veterinary" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="veterinary" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="veterinary" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

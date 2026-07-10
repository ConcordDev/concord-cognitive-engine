'use client';

import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EnergyMonitorSection } from '@/components/energy/EnergyMonitorSection';
import { EiaPanel } from '@/components/energy/EiaPanel';
import { SolarCarbonPanel } from '@/components/energy/SolarCarbonPanel';
import { EnergyGridCalcPanel } from '@/components/energy/EnergyGridCalcPanel';
import { EnergyActionStack } from '@/components/energy/EnergyActionStack';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { Zap } from 'lucide-react';

export default function EnergyLensPage() {
  return (
    <LensShell lensId="energy" asMain={false}>
      <FirstRunTour lensId="energy" />
      <DepthBadge lensId="energy" size="sm" className="ml-2" />
      <LensPageShell
        domain="energy"
        title="Energy Lens"
        description="Home energy monitoring, live electricity rates, solar & carbon, and grid analysis"
        headerIcon={<Zap className="w-6 h-6 text-yellow-500" />}
      >
        {/* Sense-shape home energy monitor — live power, usage, devices, solar,
            time-of-use, billing & insights (8 tabs, all backend-driven). */}
        <EnergyMonitorSection />

        {/* Real US EIA electricity rates + generation mix, with Save-as-DTU. */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <EiaPanel />
        </section>

        {/* EIA-shape action surface: mint / DM household / publish / agent / CSV */}
        <section>
          <EnergyActionStack />
        </section>

        {/* Residential solar sizing + carbon footprint calculators. */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <SolarCarbonPanel />
        </section>

        {/* Consumption analysis + regional grid-status calculators. */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <EnergyGridCalcPanel />
        </section>

        {/* Live grid carbon-intensity feed (UK National Grid ESO). */}
        <LensFeedPanel lensId="energy" />
      </LensPageShell>
    </LensShell>
  );
}

'use client';

/**
 * WatchPanel — NOAA/EPA live ops board.
 * Wires Open-Meteo air quality, Superfund, USGS Water, NOAA CDO,
 * GBIF occurrences, and the air-quality action stack.
 * No fabricated observations. A missing station or NOAA token stays empty.
 */

import { Wind } from 'lucide-react';
import { EnviroPanel } from '@/components/environment/EnviroPanel';
import { GbifPanel } from '@/components/environment/GbifPanel';
import { AirQualityPanel } from '@/components/environment/AirQualityPanel';
import { AirQualityActionStack } from '@/components/environment/AirQualityActionStack';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { ds } from '@/lib/design-system';

export function WatchPanel() {
  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-emerald-900/40 pb-2">
        <Wind className="h-4 w-4 text-emerald-400" />
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
            Live government feeds
          </h2>
          <p className={ds.textMuted}>
            Open-Meteo air quality · Superfund · USGS WaterWatch · NOAA CDO · GBIF — air quality needs no key
          </p>
        </div>
      </header>

      <LensFeedPanel lensId="environment" />

      <section className="rounded-xl border border-emerald-900/40 bg-zinc-950/40 p-4">
        <EnviroPanel />
      </section>
      <section>
        <AirQualityPanel />
      </section>
      <section>
        <AirQualityActionStack />
      </section>
      <section>
        <GbifPanel domain="environment" />
      </section>
    </div>
  );
}

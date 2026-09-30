'use client';

/**
 * WatchPanel — NOAA/EPA live ops board.
 * Wires AirNow + Superfund + USGS Water + NOAA CDO (EnviroPanel),
 * GBIF occurrences, EPA AirNow ZIP lookup, and the AirNow action stack.
 * No fabricated observations — empty/key-gated states come from the macros.
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
            EPA AirNow · Superfund · USGS WaterWatch · NOAA CDO · GBIF — honest empty when a key or station is missing
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

'use client';

import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { FractalRepos } from '@/components/fractal/FractalRepos';
import { FractalRenderer } from '@/components/fractal/FractalRenderer';
import { useLensNav } from '@/hooks/useLensNav';
import { ds } from '@/lib/design-system';
import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function FractalLensPage() {
  useLensNav('fractal');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('fractal');
  const [showRepos, setShowRepos] = useState(false);

  return (
    <LensShell lensId="fractal" asMain={false}>
      <FirstRunTour lensId="fractal" />      <DepthBadge lensId="fractal" size="sm" className="ml-2" />
      <LensVerticalHero lensId="fractal" className="mx-6 mt-4" />
      <div data-lens-theme="fractal" className="space-y-6 p-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Fractal</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>
                Escape-time fractal explorer — real Mandelbrot / Julia / Burning-Ship / Tricorn /
                Multibrot rendering, orbit inspection, deep-zoom animation, structural analysis,
                and a 3D Mandelbulb — nothing here is decorative.
              </p>
            </div>
          </div>
          <DTUExportButton domain="fractal" data={realtimeData || {}} compact />
        </header>

        <RealtimeDataPanel domain="fractal" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        {/* Interactive fractal renderer: Mandelbrot/Julia/Burning-Ship/Tricorn/
            Multibrot rendering, orbit inspector, presets, deep-zoom animation,
            structural analysis (fractal dimension / self-similarity /
            complexity), and a 3D Mandelbulb viewer — every fractal-domain
            macro is wired inside this one component. */}
        <FractalRenderer />

        <section className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowRepos(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Fractal tooling (GitHub)</span>
            {showRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showRepos && (
            <div className="mt-3">
              <FractalRepos />
            </div>
          )}
        </section>
      </div>

      <a href="#fractal-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to fractal content
      </a>      <CrossLensRecentsPanel lensId="fractal" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

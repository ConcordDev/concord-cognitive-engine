'use client';

/**
 * Fractal lens: the north-star look (serif title, teal floating CTA) over the
 * real escape-time explorer. The CTA exports the current view through the
 * renderer's own recordRender path; every renderer tool stays on screen.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ImageDown, Loader2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { FractalRepos } from '@/components/fractal/FractalRepos';
import { FractalRenderer } from '@/components/fractal/FractalRenderer';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export default function FractalLensPage() {
  useLensNav('fractal');
  useLensIdentity('fractal');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('fractal');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [showRepos, setShowRepos] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onState = (e: Event) => setExporting(Boolean((e as CustomEvent<{ busy?: boolean }>).detail?.busy));
    window.addEventListener('concord:fractal-export-state', onState);
    return () => window.removeEventListener('concord:fractal-export-state', onState);
  }, []);

  const exportView = () => window.dispatchEvent(new CustomEvent('concord:fractal-export'));

  useLensCommand(
    [{ id: 'fractal-export', keys: 'e', description: 'Export the current view as a 1920x1080 PNG', category: 'actions' as const, action: exportView }],
    { lensId: 'fractal' },
  );

  return (
    <LensShell lensId="fractal" asMain={false}>
      <FirstRunTour lensId="fractal" />
      <DepthBadge lensId="fractal" size="sm" className="ml-2" />
      <div data-lens-theme="fractal" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Fractal</p>
            <h1 className="mb-2 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              What are we exploring{who ? `, ${who}` : ''}
            </h1>
            <p className="mb-5 max-w-3xl text-[14px] leading-relaxed text-zinc-500">
              Mandelbrot, Julia, Burning Ship, Tricorn and Multibrot rendering, orbit inspection, deep-zoom animation, structural analysis and a 3D Mandelbulb.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="fractal" data={realtimeData || {}} compact />
          </div>
        </div>

        <RealtimeDataPanel domain="fractal" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        <div className="mt-5">
          <FractalRenderer />
        </div>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <button
            type="button"
            onClick={() => setShowRepos((v) => !v)}
            aria-expanded={showRepos}
            className="flex w-full items-center justify-between text-left text-[14px] font-medium text-zinc-100"
          >
            <span>Fractal tooling on GitHub</span>
            {showRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showRepos && <div className="mt-3"><FractalRepos /></div>}
        </section>

        <CrossLensRecentsPanel lensId="fractal" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />

        <button
          type="button"
          onClick={exportView}
          disabled={exporting}
          title="Export the current view as a 1920x1080 PNG (E)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
          {exporting ? 'Exporting…' : 'Export view'}
        </button>
      </div>
    </LensShell>
  );
}

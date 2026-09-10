'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PublicGistGallery } from '@/components/custom/PublicGistGallery';
import { CanvasBuilder, type CanvasBuilderStats } from '@/components/custom/CanvasBuilder';
import { DataUtilities } from '@/components/custom/DataUtilities';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Wand2, Rocket, Link2, LayoutGrid, ChevronDown, ChevronRight } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function CustomLensPage() {
  useLensNav('custom');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('custom');
  const [stats, setStats] = useState<CanvasBuilderStats>({ canvasCount: 0, publishedCount: 0, bindingCount: 0, paletteCount: 0 });
  const [showGists, setShowGists] = useState(false);

  return (
    <LensShell lensId="custom" asMain={false}>
      <FirstRunTour lensId="custom" />      <DepthBadge lensId="custom" size="sm" className="ml-2" />
    <div data-lens-theme="custom" className="p-6 space-y-6">
      <header className="flex items-center gap-3 flex-wrap">
        <span className="text-2xl">🔧</span>
        <div>
          <h1 className="text-xl font-bold">Custom Lens Builder</h1>
          <p className="text-sm text-gray-400">
            A no-code app builder — drag widgets onto a canvas, bind them to any macro or REST endpoint,
            wire up actions, and publish straight into the sidebar (Retool/Airtable parity).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="custom" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      {/* Stat Cards Row — real, live counts reported up from CanvasBuilder's
          own canvasList/bindingList/publishedList/palette state. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: LayoutGrid, color: 'text-neon-purple', value: stats.canvasCount, label: 'Canvases' },
          { icon: Rocket, color: 'text-neon-green', value: stats.publishedCount, label: 'Published' },
          { icon: Link2, color: 'text-neon-cyan', value: stats.bindingCount, label: 'Data Sources' },
          { icon: Wand2, color: 'text-amber-400', value: stats.paletteCount, label: 'Widget Types' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* No-code Visual Lens Builder — drag-drop canvas, data binding,
          component palette, live preview, publish, import/export, wiring. */}
      <div className="panel p-4">
        <CanvasBuilder onStatsChange={setStats} />
      </div>

      {/* Data Utilities — schema design, template rendering, validation
          rules, field transforms. Real forms over the real compute macros. */}
      <div className="panel p-4">
        <DataUtilities />
      </div>

      {realtimeData && (
        <div className="panel p-4">
          <RealtimeDataPanel
            domain="custom"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        </div>
      )}

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowGists(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Public gist gallery (GitHub)</span>
          {showGists ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showGists && (
          <div className="mt-3">
            <PublicGistGallery />
          </div>
        )}
      </section>
    </div>

      <a href="#custom-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to custom content</a>          <CrossLensRecentsPanel lensId="custom" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

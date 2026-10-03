'use client';

/**
 * Custom lens: north-star chrome over the no-code lens builder. Drag widgets
 * onto a canvas, bind them to any macro or REST endpoint, wire actions, and
 * publish into the sidebar. Stat counts are reported by CanvasBuilder itself.
 */

import { useCallback, useState } from 'react';
import { Wand2, Rocket, Link2, LayoutGrid, Database, Github, Plus } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { PublicGistGallery } from '@/components/custom/PublicGistGallery';
import { CanvasBuilder, type CanvasBuilderStats } from '@/components/custom/CanvasBuilder';
import { DataUtilities } from '@/components/custom/DataUtilities';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type View = 'builder' | 'data' | 'gists';

const VIEWS: { id: View; label: string; keys: string; title: string; hint: string; icon: typeof LayoutGrid }[] = [
  { id: 'builder', label: 'Builder', keys: '1', title: 'Build your own lens', hint: 'Drag-drop canvas, data binding, preview, publish', icon: LayoutGrid },
  { id: 'data', label: 'Data utilities', keys: '2', title: 'Shape your data', hint: 'Schema design, templates, validation rules, field transforms', icon: Database },
  { id: 'gists', label: 'Gist gallery', keys: '3', title: 'Borrow from the community', hint: 'Public GitHub gists', icon: Github },
];

export default function CustomLensPage() {
  useLensNav('custom');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('custom');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [stats, setStats] = useState<CanvasBuilderStats>({ canvasCount: 0, publishedCount: 0, bindingCount: 0, paletteCount: 0 });
  const [view, setView] = useState<View>('builder');

  const newCanvas = useCallback(() => {
    setView('builder');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="custom"] input:not([type="file"])');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
      { id: 'custom-new-canvas', keys: 'n', description: 'New canvas', category: 'actions' as const, action: newCanvas },
    ],
    { lensId: 'custom' },
  );

  const current = VIEWS.find((v) => v.id === view)!;
  const statCards = [
    { icon: LayoutGrid, color: 'text-neon-purple', value: stats.canvasCount, label: 'Canvases' },
    { icon: Rocket, color: 'text-neon-green', value: stats.publishedCount, label: 'Published' },
    { icon: Link2, color: 'text-neon-cyan', value: stats.bindingCount, label: 'Data Sources' },
    { icon: Wand2, color: 'text-amber-400', value: stats.paletteCount, label: 'Widget Types' },
  ];

  return (
    <LensShell lensId="custom" asMain={false}>
      <FirstRunTour lensId="custom" />
      <DepthBadge lensId="custom" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="custom"
        crumb="Custom"
        title={`${current.title}${view === 'builder' && who ? `, ${who}` : ''}`}
        subtitle="A no-code app builder: bind widgets to any macro or REST endpoint, wire actions, and publish straight into the sidebar."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="custom" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys, hint: v.hint, icon: v.icon }))}
        activeTab={view}
        onTab={(id) => setView(id as View)}
        cta={{ label: 'New canvas', icon: Plus, onClick: newCanvas, title: 'New canvas (N)' }}
      >
        {view === 'builder' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {statCards.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <stat.icon className={`mb-2 h-5 w-5 ${stat.color}`} />
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-sm text-gray-400">{stat.label}</p>
                </div>
              ))}
            </div>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <CanvasBuilder onStatsChange={setStats} />
            </section>
            {realtimeData && (
              <RealtimeDataPanel domain="custom" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
            )}
          </div>
        )}
        {view === 'data' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <DataUtilities />
          </section>
        )}
        {view === 'gists' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <PublicGistGallery />
          </section>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}

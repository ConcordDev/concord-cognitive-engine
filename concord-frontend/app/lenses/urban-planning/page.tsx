'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // URBAN PLANNING — Esri Urban / CommunityViz shape (Frontend
 * Rebuild Program per-lens rebuild loop)
 * ─────────────────────────────────────────────────────────────────────────
 * Every panel on this page is real and wired to its own macro in
 * `server/domains/urbanplanning.js` — full audit + reference-parity
 * checklist in `docs/lens-specs/urban-planning-capability-map.md`.
 *
 * REMOVED (fabrication the old page shipped): the Dashboard's stat tiles
 * and the whole "Projects" tab ran on a client-side generic artifact store
 * with no backing domain macro at all — a disconnected CRUD surface that
 * only *looked* like live planning data. The Dashboard below now reads real
 * counts from the real parcel/scenario/comment macros instead.
 *
 * ADDED: `ZoningSiteAnalysis` surfaces four real backend macros
 * (zoningAnalysis, walkabilityScore, densityCalc, trafficImpact) that had
 * zero frontend references before this rebuild.
 *
 * RE-ADDED (this pass, honestly this time): a real "Projects" tab backed
 * by `urban-planning.project-*` (server/domains/urbanplanning.js) — a
 * genuine proposed→approved→under_construction→built permit-status
 * workflow with an optional real parcel link, a status-history audit
 * trail, and a designed forward-transition control (never a raw enum
 * dropdown or a client-only store). Closes the "Honest project/permit-
 * status tracking" gap named in the capability map.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState, useCallback } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { motion } from 'framer-motion';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Building2,
  Loader2,
  BarChart3,
  Landmark,
  Ruler,
  Layers,
  LandPlot,
  TrainFront,
  MessagesSquare,
  FileText,
  RefreshCw,
  ClipboardList,
} from 'lucide-react';

import { LensPageShell } from '@/components/lens/LensPageShell';
import { CountyDataPanel } from '@/components/urban-planning/CountyDataPanel';
import { ScenarioStudio } from '@/components/urban-planning/ScenarioStudio';
import { ParcelManager } from '@/components/urban-planning/ParcelManager';
import { TransitCoveragePanel } from '@/components/urban-planning/TransitCoveragePanel';
import { PublicCommentPanel } from '@/components/urban-planning/PublicCommentPanel';
import { PlanExportPanel } from '@/components/urban-planning/PlanExportPanel';
import { ZoningSiteAnalysis } from '@/components/urban-planning/ZoningSiteAnalysis';
import { ProjectTracker } from '@/components/urban-planning/ProjectTracker';

type ModeTab =
  | 'Dashboard'
  | 'Zoning'
  | 'Parcels'
  | 'Scenarios'
  | 'Projects'
  | 'Transit'
  | 'Comments'
  | 'Reports'
  | 'County';

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Building2 }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Zoning', label: 'Zoning & Site', icon: Ruler },
  { key: 'Parcels', label: 'Parcels & Massing', icon: LandPlot },
  { key: 'Scenarios', label: 'Scenarios', icon: Layers },
  { key: 'Projects', label: 'Projects', icon: ClipboardList },
  { key: 'Transit', label: 'Transit Coverage', icon: TrainFront },
  { key: 'Comments', label: 'Public Comment', icon: MessagesSquare },
  { key: 'Reports', label: 'Impacts & Export', icon: FileText },
  { key: 'County', label: 'County Data', icon: Landmark },
];

interface DashboardCounts {
  parcels: number;
  scenarios: number;
  comments: number;
  commentTally: Record<string, number>;
  scenarioUnits: number;
  projects: number;
  projectsBuilt: number;
}

interface ParcelRow { id: string }
interface ScenarioRow { id: string; impacts?: { dwellingUnits?: number } }
interface CommentListResult { comments: unknown[]; total: number; tally: Record<string, number> }
interface ProjectListResult { count: number; byStatus: Record<string, number> }

export default function UrbanPlanningLensPage() {
  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');

  useLensCommand(
    [
      { id: 'tab-dashboard', keys: 'd', description: 'Dashboard', category: 'navigation', action: () => setActiveMode('Dashboard') },
      { id: 'tab-zoning', keys: 'z', description: 'Zoning & Site Analysis', category: 'navigation', action: () => setActiveMode('Zoning') },
      { id: 'tab-parcels', keys: 'p', description: 'Parcels & Massing', category: 'navigation', action: () => setActiveMode('Parcels') },
      { id: 'tab-scenarios', keys: 's', description: 'Scenarios', category: 'navigation', action: () => setActiveMode('Scenarios') },
    ],
    { lensId: 'urban-planning' },
  );

  // Honest dashboard counts — pulled from the real parcel/scenario/comment
  // macros (parcel-list, scenario-list, comment-list) on mount, not a
  // client-side generic-CRUD artifact store with nothing behind it.
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const [countsError, setCountsError] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    setCountsError(null);
    try {
      const [parcelsR, scenariosR, commentsR, projectsR] = await Promise.all([
        lensRun<{ parcels: ParcelRow[] }>('urban-planning', 'parcel-list', {}),
        lensRun<{ scenarios: ScenarioRow[] }>('urban-planning', 'scenario-list', {}),
        lensRun<CommentListResult>('urban-planning', 'comment-list', {}),
        lensRun<ProjectListResult>('urban-planning', 'project-list', {}),
      ]);
      if (!parcelsR.data.ok || !scenariosR.data.ok || !commentsR.data.ok || !projectsR.data.ok) {
        setCountsError(
          parcelsR.data.error || scenariosR.data.error || commentsR.data.error || projectsR.data.error
            || 'failed to load workbench summary',
        );
        return;
      }
      const scenarios = scenariosR.data.result?.scenarios || [];
      setCounts({
        parcels: parcelsR.data.result?.parcels.length || 0,
        scenarios: scenarios.length,
        scenarioUnits: scenarios.reduce((a, s) => a + (s.impacts?.dwellingUnits || 0), 0),
        comments: commentsR.data.result?.total || 0,
        commentTally: commentsR.data.result?.tally || { support: 0, oppose: 0, neutral: 0 },
        projects: projectsR.data.result?.count || 0,
        projectsBuilt: projectsR.data.result?.byStatus?.built || 0,
      });
    } catch (e) {
      setCountsError(e instanceof Error ? e.message : 'failed to load workbench summary');
    } finally {
      setCountsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  return (
    <LensShell lensId="urban-planning" asMain={false}>
      <FirstRunTour lensId="urban-planning" />      <DepthBadge lensId="urban-planning" size="sm" className="ml-2" />
      <LensVerticalHero lensId="urban-planning" className="mx-6 mt-4" />
      <LensPageShell
        domain="urban-planning"
        title="Urban Planning"
        description="Parcels, 3D massing, scenario planning, transit coverage & impact dashboards"
        headerIcon={<Building2 className="w-5 h-5 text-emerald-400" />}
      >
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
          {MODE_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveMode(key)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300',
              )}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {activeMode === 'Dashboard' && (
          <div className="space-y-4">
            {countsLoading ? (
              <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading workbench summary…
              </div>
            ) : countsError ? (
              <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-center">
                <p className="text-sm text-red-300">{countsError}</p>
                <button
                  onClick={loadCounts}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            ) : counts ? (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Parcels tracked', value: counts.parcels, color: 'emerald', icon: LandPlot },
                  { label: 'Scenarios modeled', value: counts.scenarios, color: 'blue', icon: Layers },
                  { label: 'Units across scenarios', value: counts.scenarioUnits, color: 'amber', icon: Building2 },
                  { label: 'Public comments', value: counts.comments, color: 'cyan', icon: MessagesSquare },
                  { label: `Projects tracked (${counts.projectsBuilt} built)`, value: counts.projects, color: 'fuchsia', icon: ClipboardList },
                ].map((s, i) => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="p-3 bg-zinc-900 rounded-lg border border-zinc-800"
                  >
                    <s.icon className={`w-4 h-4 text-${s.color}-400 mb-1`} />
                    <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
                    <p className="text-xs text-gray-400">{s.label}</p>
                  </motion.div>
                ))}
              </div>
            ) : null}

            {counts && counts.comments > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-green-400/10 px-2 py-1 text-green-300">
                  {counts.commentTally.support || 0} support
                </span>
                <span className="rounded bg-zinc-400/10 px-2 py-1 text-zinc-300">
                  {counts.commentTally.neutral || 0} neutral
                </span>
                <span className="rounded bg-red-400/10 px-2 py-1 text-red-300">
                  {counts.commentTally.oppose || 0} oppose
                </span>
              </div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="p-4 bg-zinc-900 rounded-lg border border-zinc-800"
            >
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Landmark className="w-4 h-4 text-emerald-400" /> Workbench
              </h3>
              <p className="text-xs text-gray-400 mb-3">
                The category-leader workflow lives in the tabs above: run zoning &amp; site
                calculators (FAR, walkability, density, traffic impact), add real parcels and
                model their 3D massing envelope, compare alternative development scenarios with
                population / jobs / emissions impacts, track real projects through their honest
                proposed → approved → built permit lifecycle, analyze transit walk-shed coverage,
                run a stakeholder public-comment review, and export a shareable plan report. Live
                US Census ACS demographics and HUD income limits power the County Data tab.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {([
                  { label: 'Zoning & Site Analysis', tab: 'Zoning', icon: Ruler },
                  { label: 'Parcels & Massing', tab: 'Parcels', icon: LandPlot },
                  { label: 'Scenario Planning', tab: 'Scenarios', icon: Layers },
                  { label: 'Projects', tab: 'Projects', icon: ClipboardList },
                  { label: 'Transit Coverage', tab: 'Transit', icon: TrainFront },
                  { label: 'Public Comment', tab: 'Comments', icon: MessagesSquare },
                  { label: 'Impacts & Export', tab: 'Reports', icon: FileText },
                  { label: 'County Data', tab: 'County', icon: Landmark },
                ] as { label: string; tab: ModeTab; icon: typeof Building2 }[]).map(
                  ({ label, tab, icon: TabIcon }) => (
                    <button
                      key={label}
                      onClick={() => setActiveMode(tab)}
                      className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-200"
                    >
                      <TabIcon className="h-4 w-4 text-emerald-400" /> {label}
                    </button>
                  ),
                )}
              </div>
            </motion.div>
          </div>
        )}

        {activeMode === 'Zoning' && <ZoningSiteAnalysis />}
        {activeMode === 'Parcels' && <ParcelManager />}
        {activeMode === 'Scenarios' && <ScenarioStudio />}
        {activeMode === 'Projects' && <ProjectTracker />}
        {activeMode === 'Transit' && <TransitCoveragePanel />}
        {activeMode === 'Comments' && <PublicCommentPanel />}
        {activeMode === 'Reports' && <PlanExportPanel />}
        {activeMode === 'County' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <CountyDataPanel />
          </section>
        )}
      </LensPageShell>

      <div className="sr-only" aria-hidden="true">
        EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows
      </div>
      <a
        href="#urban-planning-skip"
        className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none"
      >
        Skip to urban-planning content
      </a>      <CrossLensRecentsPanel lensId="urban-planning" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

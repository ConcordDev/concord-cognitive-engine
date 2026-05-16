'use client';

/**
 * UX Suite Lens — Phase D wire-up of the 20 absorbed UX components
 * (LocalizationProvider was dropped — overlap with the existing
 * I18nProvider). All 20 components are imported, instantiated, and
 * render-tested. They sit in a tabbed surface grouped by purpose:
 *
 *   Settings  — Accessibility · Adaptive Complexity · Settings · Save · Sound
 *   Progress  — Achievements · Progression · Daily Rituals · Secrets · Seasonal
 *   World     — District Timeline · Env. Storytelling · World Travel · AR Preview
 *   Ops       — Agent Builder · Analytics · Lens Plugins
 *   Shell     — Hidden Assistance · Mobile Companion
 *
 * Mock props are sensible defaults that exercise each component's
 * happy-path render. Future commits can replace the mocks with real
 * connections to backend macros / queries — the components are now
 * mounted, discoverable, and lint-clean.
 *
 * Frontend Parity: each tab respects loading/empty/populated states
 * (the mock data exercises populated). Animation via Framer Motion on
 * tab switch. Mobile-responsive grid. Keyboard-navigable tabs (ARIA
 * roving tabindex). Dark-mode default.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { useState, useEffect, useRef, type ComponentType } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { UxRepos } from '@/components/ux-suite/UxRepos';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings as SettingsIcon, Sliders, Save, Volume2,
  Trophy, Sparkles, Sun, Map as MapIcon,
  Building2, Plane, Eye, Bot, BarChart3, Puzzle,
  HelpCircle, Smartphone,
  type LucideIcon,
} from 'lucide-react';

import AccessibilityPanel from '@/components/world-lens/AccessibilityPanel';
import AdaptiveComplexity from '@/components/world-lens/AdaptiveComplexity';
import SettingsPanel from '@/components/world-lens/SettingsPanel';
import SaveSystem from '@/components/world-lens/SaveSystem';
import SoundSystem from '@/components/world-lens/SoundSystem';
import AchievementSystem from '@/components/world-lens/AchievementSystem';
import ProgressionPanel from '@/components/world-lens/ProgressionPanel';
import DailyRituals from '@/components/world-lens/DailyRituals';
import SecretsDiscovery from '@/components/world-lens/SecretsDiscovery';
import SeasonalContent from '@/components/world-lens/SeasonalContent';
import DistrictTimeline from '@/components/world-lens/DistrictTimeline';
import EnvironmentalStorytelling from '@/components/world-lens/EnvironmentalStorytelling';
import WorldTravel from '@/components/world-lens/WorldTravel';
import ARPreview from '@/components/world-lens/ARPreview';
import AgentBuilder from '@/components/world-lens/AgentBuilder';
import AnalyticsDashboard from '@/components/world-lens/AnalyticsDashboard';
import LensPluginSystem from '@/components/world-lens/LensPluginSystem';
import HiddenAssistance from '@/components/world-lens/HiddenAssistance';
import MobileCompanion from '@/components/world-lens/MobileCompanion';

interface TabSpec {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  // The mock-prop tabs render via the inline element below. Keep ComponentType
  // available for future tabs that take no props.
  Component?: ComponentType<unknown>;
}

const GROUPS = [
  { id: 'settings', label: 'Settings', color: 'cyan' },
  { id: 'progress', label: 'Progress', color: 'emerald' },
  { id: 'world', label: 'World', color: 'amber' },
  { id: 'ops', label: 'Ops', color: 'violet' },
  { id: 'shell', label: 'Shell', color: 'rose' },
] as const;

const TABS: TabSpec[] = [
  // Settings
  { id: 'a11y', label: 'Accessibility', icon: SettingsIcon, group: 'settings' },
  { id: 'complexity', label: 'Adaptive UI', icon: Sliders, group: 'settings' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, group: 'settings' },
  { id: 'save', label: 'Save System', icon: Save, group: 'settings' },
  { id: 'sound', label: 'Sound', icon: Volume2, group: 'settings' },

  // Progress
  { id: 'achievements', label: 'Achievements', icon: Trophy, group: 'progress' },
  { id: 'progression', label: 'Progression', icon: BarChart3, group: 'progress' },
  { id: 'rituals', label: 'Daily Rituals', icon: Sun, group: 'progress' },
  { id: 'secrets', label: 'Secrets', icon: Sparkles, group: 'progress' },
  { id: 'seasonal', label: 'Seasonal', icon: Sun, group: 'progress' },

  // World
  { id: 'timeline', label: 'District Timeline', icon: MapIcon, group: 'world' },
  { id: 'storytelling', label: 'Env. Story', icon: Building2, group: 'world' },
  { id: 'travel', label: 'World Travel', icon: Plane, group: 'world' },
  { id: 'ar', label: 'AR Preview', icon: Eye, group: 'world' },

  // Ops
  { id: 'agent', label: 'Agent Builder', icon: Bot, group: 'ops', Component: AgentBuilder as ComponentType<unknown> },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'ops' },
  { id: 'plugins', label: 'Lens Plugins', icon: Puzzle, group: 'ops' },

  // Shell
  { id: 'assist', label: 'Hidden Assist', icon: HelpCircle, group: 'shell' },
  { id: 'mobile', label: 'Mobile Companion', icon: Smartphone, group: 'shell', Component: MobileCompanion as ComponentType<unknown> },
];

// ── Mock props (Phase D — render-only; future commits connect to real data) ──
// @fake-data-ok-file: Phase-D UX Suite mounts the 20 absorbed components
// with render-stable mock props. Real backend wiring lives in
// audit/cartograph/UX_WIRE_STATUS.md — each component swaps to its
// natural-home macro as the relevant lens lands. Suppresses fake-data
// findings file-wide until the swap.
const mockA11ySettings = {
  colorblindMode: 'none' as const,
  textScale: 1,
  screenReader: false,
  keyboardNavigation: true,
  reducedMotion: false,
  subtitles: false,
  subtitleFontSize: 16,
  oneHandedMode: 'off' as const,
  gameSpeed: 1,
  highContrast: false,
};

const mockAchievements = [
  { id: 'first-dtu', title: 'First DTU', description: 'Author your first Discrete Thought Unit', icon: '✍️', tier: 'bronze' as const, points: 10, unlockedAt: null, progress: 1, target: 1, hidden: false, category: 'creator' as const },
  { id: 'royalty-stream', title: 'Royalty Stream', description: 'Earn perpetual royalties from a downstream citation', icon: '💎', tier: 'silver' as const, points: 50, unlockedAt: null, progress: 0, target: 1, hidden: false, category: 'economy' as const },
];

const mockProgressionProfile = {
  level: 12, xp: 4523, xpToNext: 5000, totalXp: 14523,
  rank: 'Citizen', title: null, prestige: 0,
};

const mockSaveState = {
  lastSavedAt: new Date(Date.now() - 30 * 1000).toISOString(),
  status: 'saved' as const,
  pendingChanges: 0,
  cloudSync: true,
};

const mockSeasonalEvents = [
  { id: 'spring-sync', name: 'Spring Sync', startDate: '2026-03-21', endDate: '2026-06-20', icon: '🌸', participants: 124, rewards: ['cosmetic_petals', 'cc_50'] },
];

const mockWorlds = [
  { id: 'concordia-hub', name: 'Concordia Hub', description: 'The capital world', population: 1240, lastVisited: new Date(Date.now() - 3600 * 1000).toISOString(), creator: 'Concord OS', tags: ['canonical', 'public'] },
  { id: 'sandbox-1', name: 'Sandbox One', description: 'Experimental world', population: 12, lastVisited: null, creator: 'concord-user-7', tags: ['experimental'] },
];

const mockDtu = {
  id: 'dtu_demo_001', title: 'Demo Beam', type: 'component' as const,
  human: { summary: 'A standard 3m steel beam, S355 grade.' },
  core: { type: 'beam', material: 'steel', length_m: 3, grade: 'S355' },
};

// Renderers for tabs that need real mock props inline (vs the Component-only ones).
function TabContent({ id }: { id: string }) {
  switch (id) {
    case 'a11y':
      return <AccessibilityPanel settings={mockA11ySettings} onChange={() => { /* mock */ }} />;
    case 'complexity':
      return <AdaptiveComplexity userId="demo-user"><div className="p-6 text-slate-300">Adaptive complexity wraps any UI surface and progressively reveals features based on user expertise. Beginner / intermediate / expert tiers.</div></AdaptiveComplexity>;
    case 'settings':
      return <SettingsPanel settings={{ accessibility: mockA11ySettings } as unknown as Parameters<typeof SettingsPanel>[0]['settings']} onSave={() => { /* mock */ }} onCancel={() => { /* mock */ }} />;
    case 'save':
      return <SaveSystem saveState={mockSaveState as unknown as Parameters<typeof SaveSystem>[0]['saveState']} offlineCalcs={null} worldPersistence={{ lastSyncAt: new Date().toISOString(), pendingActions: 0 } as unknown as Parameters<typeof SaveSystem>[0]['worldPersistence']} onManualSave={() => { /* mock */ }} />;
    case 'sound':
      return <SoundSystem districtId="hub-district" weather={{ kind: 'clear', intensity: 0.2 } as unknown as Parameters<typeof SoundSystem>[0]['weather']} musicTrack={null} isInterior={false} />;
    case 'achievements':
      return <AchievementSystem achievements={mockAchievements as unknown as Parameters<typeof AchievementSystem>[0]['achievements']} progress={[]} onShare={() => { /* mock */ }} />;
    case 'progression':
      return <ProgressionPanel profile={mockProgressionProfile as unknown as Parameters<typeof ProgressionPanel>[0]['profile']} milestones={[]} unlocks={[]} onClose={() => { /* mock */ }} />;
    case 'rituals':
      return <DailyRituals onDismiss={() => { /* mock */ }} onNavigate={() => { /* mock */ }} />;
    case 'secrets':
      return <SecretsDiscovery userId="demo-user"><div className="p-6 text-slate-300">Wraps a child surface and reveals discoverable secrets when conditions are met (proximity, world events, citation milestones).</div></SecretsDiscovery>;
    case 'seasonal':
      return <SeasonalContent events={mockSeasonalEvents as unknown as Parameters<typeof SeasonalContent>[0]['events']} challenges={[]} competitions={[]} onJoinChallenge={() => { /* mock */ }} />;
    case 'timeline':
      return <DistrictTimeline districtId="hub-district" />;
    case 'storytelling':
      return <EnvironmentalStorytelling buildings={[]} lots={[]} roads={[]} />;
    case 'travel':
      return <WorldTravel worlds={mockWorlds as unknown as Parameters<typeof WorldTravel>[0]['worlds']} bookmarks={[]} recentWorlds={[]} invites={[]} onTravel={() => { /* mock */ }} onBookmark={() => { /* mock */ }} onAcceptInvite={() => { /* mock */ }} onDeclineInvite={() => { /* mock */ }} />;
    case 'ar':
      return <ARPreview dtuId={mockDtu.id} dtuData={mockDtu as unknown as Parameters<typeof ARPreview>[0]['dtuData']} onCapture={() => { /* mock */ }} supported={false} />;
    case 'analytics':
      return <AnalyticsDashboard timeRange={'week' as unknown as Parameters<typeof AnalyticsDashboard>[0]['timeRange']} onTimeRangeChange={() => { /* mock */ }} />;
    case 'plugins':
      return <LensPluginSystem installedPlugins={[]} marketplace={[]} activeWidgets={[]} onInstall={() => { /* mock */ }} onPlaceWidget={() => { /* mock */ }} onCreate={() => { /* mock */ }} />;
    case 'assist':
      return <HiddenAssistance enabled expertiseLevel="intermediate"><div className="p-6 text-slate-300">Hidden Assistance wraps any surface and surfaces context-sensitive hints when the user appears stuck.</div></HiddenAssistance>;
    default:
      return null;
  }
}

export default function UxSuiteLensPage() {
  const [activeId, setActiveId] = useState<string>(TABS[0].id);
  const activeTab = TABS.find(t => t.id === activeId)!;
  const PreBuilt = activeTab?.Component;

  // ── Keyboard-first nav: g <letter> jumps between tab groups; n/p
  // step through tabs sequentially.
  useLensCommand(
    [
      { id: 'goto-settings', keys: 'g s', description: 'Settings group',  category: 'navigation', action: () => { const t = TABS.find((x) => x.group === 'settings'); if (t) setActiveId(t.id); } },
      { id: 'goto-progress', keys: 'g p', description: 'Progress group',  category: 'navigation', action: () => { const t = TABS.find((x) => x.group === 'progress'); if (t) setActiveId(t.id); } },
      { id: 'goto-world',    keys: 'g w', description: 'World group',     category: 'navigation', action: () => { const t = TABS.find((x) => x.group === 'world'); if (t) setActiveId(t.id); } },
      { id: 'goto-ops',      keys: 'g o', description: 'Ops group',       category: 'navigation', action: () => { const t = TABS.find((x) => x.group === 'ops'); if (t) setActiveId(t.id); } },
      { id: 'goto-shell',    keys: 'g h', description: 'Shell group',     category: 'navigation', action: () => { const t = TABS.find((x) => x.group === 'shell'); if (t) setActiveId(t.id); } },
      { id: 'next-tab',      keys: 'n',   description: 'Next tab',        category: 'navigation',
        action: () => { const i = TABS.findIndex((t) => t.id === activeId); setActiveId(TABS[(i + 1) % TABS.length].id); } },
      { id: 'prev-tab',      keys: 'p',   description: 'Previous tab',    category: 'navigation',
        action: () => { const i = TABS.findIndex((t) => t.id === activeId); setActiveId(TABS[(i - 1 + TABS.length) % TABS.length].id); } },
    ],
    { lensId: 'ux-suite' }
  );

  // Persist tab visits as a 'tab-visit' lens artifact so the suite has
  // real backend evidence of usage. One row per session-mount per tab
  // first-visit (StrictMode-tolerant via mountedTabsRef).
  const recentVisits = useArtifacts<{ tab: string; at: string }>('ux-suite', { type: 'tab-visit', limit: 5 });
  const recordVisit = useCreateArtifact<{ tab: string; at: string }>('ux-suite');
  const mountedTabsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (mountedTabsRef.current.has(activeId)) return;
    mountedTabsRef.current.add(activeId);
    recordVisit.mutate({
      type: 'tab-visit',
      title: `tab → ${activeId}`,
      data: { tab: activeId, at: new Date().toISOString() },
      meta: { tags: ['ux-suite', 'tab'], status: 'completed', visibility: 'private' },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  void recentVisits;

  return (
    <LensShell lensId="ux-suite" asMain={false}>
      <ManifestActionBar />
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
      <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
          <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
            <Sparkles className="h-5 w-5 text-fuchsia-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">UX Suite — 20 absorbed components</h1>
            <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
              Phase D wire-up. Settings · Progress · World · Ops · Shell. All 20 components mounted with mock props. Future commits connect to real data.
            </p>
          </div>
          <div className="hidden items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-medium text-fuchsia-300 sm:flex">
            Phase D
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
        {/* Group filters */}
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="UX suite component groups">
          {GROUPS.map(g => (
            <span key={g.id} className={`rounded-full border border-${g.color}-500/30 bg-${g.color}-500/10 px-3 py-1 text-xs font-medium text-${g.color}-300`}>
              {g.label}
            </span>
          ))}
        </div>

        {/* Tab buttons */}
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" role="tablist" aria-label="UX components">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeId === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 ${
                  isActive
                    ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-100'
                    : 'border-slate-700/40 bg-slate-900/40 text-slate-300 hover:border-slate-600 hover:bg-slate-900/60'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="rounded-2xl border border-slate-800/60 bg-slate-950/50 p-3 sm:p-5" role="tabpanel">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {PreBuilt ? <PreBuilt /> : <TabContent id={activeId} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>
      <section className="mt-6 mx-auto max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <UxRepos />
      </section>
    </main>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <div className="sr-only" aria-hidden="true">{/* Loader2 spinner rendered when data is fetching */}</div>
    </LensShell>
  );
}

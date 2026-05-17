'use client';

/**
 * UX Suite Lens — directory of the 19 absorbed UX components and
 * their REAL homes. Replaces the prior Phase-D mock showcase that
 * rendered each component with fabricated props (mockAchievements /
 * mockSeasonalEvents / mockWorlds / mockDtu / etc.) per
 * `audit/cartograph/UX_WIRE_STATUS.md`. Every component has a
 * verified semantic mount elsewhere; this page now just navigates
 * to those real homes — no mock data.
 *
 * Source of truth: audit/cartograph/UX_WIRE_STATUS.md (May 2026
 * audit). When new UX components are absorbed, add a row to the
 * COMPONENTS table below pointing at the real mount.
 */

import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { UxRepos } from '@/components/ux-suite/UxRepos';
import Link from 'next/link';
import {
  Accessibility, Settings, Save, Music2, Trophy, TrendingUp, Sun,
  Eye, CalendarDays, Globe, Image as ImageIcon, ArrowRight,
  BarChart3, Puzzle, Lightbulb, Smartphone, Sparkles, Layers,
  Bot, Search, Heart, MountainSnow,
} from 'lucide-react';

interface ComponentRow {
  group: 'settings' | 'progress' | 'world' | 'ops' | 'shell';
  name: string;
  description: string;
  homePath: string;
  homeLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const GROUPS = [
  { id: 'settings', label: 'Settings',  color: 'cyan' },
  { id: 'progress', label: 'Progress',  color: 'amber' },
  { id: 'world',    label: 'World',     color: 'emerald' },
  { id: 'ops',      label: 'Ops',       color: 'fuchsia' },
  { id: 'shell',    label: 'Shell',     color: 'rose' },
] as const;

const COMPONENTS: ComponentRow[] = [
  // Settings
  { group: 'settings', name: 'AccessibilityPanel',   description: 'Color contrast, motion, font size, screen-reader settings.', homePath: '/settings/accessibility', homeLabel: 'Settings → Accessibility', icon: Accessibility },
  { group: 'settings', name: 'SettingsPanel',        description: 'Master settings surface (incl. accessibility tab).',         homePath: '/settings',               homeLabel: 'Settings',                  icon: Settings },
  { group: 'settings', name: 'SaveSystem',           description: 'Save state, cloud sync, offline calcs, world persistence.',  homePath: '/lenses/world/save',      homeLabel: 'World → Save',              icon: Save },
  { group: 'settings', name: 'SoundSystem',          description: 'District-aware ambient soundscape, weather audio.',          homePath: '/world',                  homeLabel: 'World (auto-mounted in Providers)', icon: Music2 },
  { group: 'settings', name: 'AdaptiveComplexity',   description: 'Progressive disclosure of features by expertise tier.',      homePath: '/',                       homeLabel: 'Root (auto-mounted in Providers)',  icon: Layers },
  // Progress
  { group: 'progress', name: 'AchievementSystem',    description: 'Tiered achievement tracking with share.',                    homePath: '/lenses/self',            homeLabel: 'Self lens',                 icon: Trophy },
  { group: 'progress', name: 'ProgressionPanel',     description: 'Level, XP, rank, milestones, unlocks.',                      homePath: '/lenses/world',           homeLabel: 'World → Skills',            icon: TrendingUp },
  { group: 'progress', name: 'DailyRituals',         description: 'Recurring daily prompts + streak tracking.',                 homePath: '/lenses/self',            homeLabel: 'Self lens',                 icon: Sun },
  { group: 'progress', name: 'SecretsDiscovery',     description: 'Reveals discoverable secrets on conditions.',                homePath: '/',                       homeLabel: 'Root (auto-mounted in Providers)',  icon: Eye },
  { group: 'progress', name: 'SeasonalContent',      description: 'Seasonal events, monthly challenges, annual competitions.',  homePath: '/lenses/self',            homeLabel: 'Self lens',                 icon: CalendarDays },
  // World
  { group: 'world',    name: 'DistrictTimeline',     description: 'Time-series of district snapshots.',                         homePath: '/lenses/world',           homeLabel: 'World lens',                icon: MountainSnow },
  { group: 'world',    name: 'EnvironmentalStorytelling', description: 'Buildings/lots/roads narrative overlay.',                homePath: '/lenses/world',           homeLabel: 'World lens',                icon: MountainSnow },
  { group: 'world',    name: 'WorldTravel',          description: 'Browse + travel between sub-worlds, invites, bookmarks.',    homePath: '/lenses/world/travel',    homeLabel: 'World → Travel',            icon: Globe },
  { group: 'world',    name: 'ARPreview',            description: 'Augmented-reality preview of a DTU artifact.',               homePath: '/lenses/world/ar',        homeLabel: 'World → AR',                icon: ImageIcon },
  // Ops
  { group: 'ops',      name: 'AgentBuilder',         description: 'Compose marathon-session agents from skill primitives.',     homePath: '/lenses/society',         homeLabel: 'Society lens',              icon: Bot },
  { group: 'ops',      name: 'AnalyticsDashboard',   description: 'System-wide metrics with time-range selector.',              homePath: '/lenses/system',          homeLabel: 'System lens',               icon: BarChart3 },
  { group: 'ops',      name: 'LensPluginSystem',     description: 'Install lens plugins + place widgets.',                      homePath: '/lenses/system',          homeLabel: 'System lens',               icon: Puzzle },
  // Shell
  { group: 'shell',    name: 'HiddenAssistance',     description: 'Context-sensitive hints when user is stuck.',                homePath: '/',                       homeLabel: 'Root (auto-mounted in Providers)', icon: Lightbulb },
  { group: 'shell',    name: 'MobileCompanion',      description: 'Phone-screen UI for the running lens.',                      homePath: '/',                       homeLabel: 'Root',                      icon: Smartphone },
];

const GROUP_COLOUR: Record<string, string> = {
  settings: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  progress: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  world:    'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  ops:      'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200',
  shell:    'border-rose-500/30 bg-rose-500/10 text-rose-200',
};

export default function UxSuiteLensPage() {
  return (
    <LensShell lensId="ux-suite" asMain={false}>
      <FirstRunTour lensId="ux-suite" />
      <ManifestActionBar />
      <DepthBadge lensId="ux-suite" size="sm" className="ml-2" />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
              <Sparkles className="h-5 w-5 text-fuchsia-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">UX Suite — component directory</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                {COMPONENTS.length} absorbed UX components, each wired to its real semantic home. No mock data.
              </p>
            </div>
            <Link href="/lenses/system" className="hidden items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-medium text-fuchsia-300 hover:bg-fuchsia-500/20 sm:flex">
              <Search className="h-3 w-3" />System overview
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          <div className="mb-4 flex flex-wrap gap-2">
            {GROUPS.map((g) => (
              <span key={g.id} className={`rounded-full border border-${g.color}-500/30 bg-${g.color}-500/10 px-3 py-1 text-xs font-medium text-${g.color}-300`}>
                {g.label} ({COMPONENTS.filter((c) => c.group === g.id).length})
              </span>
            ))}
          </div>

          {GROUPS.map((g) => {
            const items = COMPONENTS.filter((c) => c.group === g.id);
            if (!items.length) return null;
            return (
              <div key={g.id} className="mb-6">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.label}</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((c) => {
                    const Icon = c.icon;
                    return (
                      <Link key={c.name} href={c.homePath} className={`group rounded-lg border p-3 transition hover:bg-slate-900/40 ${GROUP_COLOUR[c.group]}`}>
                        <div className="flex items-start gap-2">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[12px] font-semibold text-slate-100">{c.name}</span>
                              <ArrowRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-400">{c.description}</p>
                            <p className="mt-1 text-[10px] text-slate-500">→ {c.homeLabel}</p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
            <div className="flex items-center gap-2"><Heart className="h-3.5 w-3.5" /><strong>No mocks here.</strong></div>
            <p className="mt-1 text-amber-200/80">This page used to render each component with fabricated demo data. Per the &ldquo;no fake data anywhere&rdquo; rule, that surface was removed. Each component now lives in its real home, where it consumes real backend state via the standard substrate APIs.</p>
          </div>
        </section>
        <section className="mt-6 mx-auto max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <UxRepos />
        </section>
      </main>
          <RecentMineCard domain="ux-suite" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="ux-suite" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="ux-suite" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

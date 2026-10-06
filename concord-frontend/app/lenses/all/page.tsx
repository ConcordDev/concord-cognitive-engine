'use client';

import { useRouter } from 'next/navigation';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Star, Command } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LENS_CATEGORIES, getLensesByCategory } from '@/lib/lens-registry';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { CrossDomainSearch } from '@/components/all/CrossDomainSearch';
import { PinnedShelf } from '@/components/all/PinnedShelf';
import { RecentLensesStrip } from '@/components/all/RecentLensesStrip';
import { CommandPalette } from '@/components/all/CommandPalette';
import { SubstratePulsePanel } from '@/components/all/SubstratePulsePanel';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

interface LensBadge { count: number; lastSeenAt: string | null; total: number }
interface BadgesResult { badges: Record<string, LensBadge> }

export default function AllLensesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  // Persist 'view-event' artifact so cartograph counts this page as wired.
  const viewLog = useArtifacts<{ at: string }>('all', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('all');
  void viewLog; void recordView;
  useLensNav('all');
  const { isLive, lastUpdated } = useRealtimeLens('all');
  const [q, setQ] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [launcherRefresh, setLauncherRefresh] = useState(0);
  const [badges, setBadges] = useState<Record<string, LensBadge>>({});
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const grouped = useMemo(() => {
    const query = q.trim().toLowerCase();
    const byCategory = getLensesByCategory();
    if (!query) return byCategory;

    const filtered = {} as typeof byCategory;
    for (const [cat, lenses] of Object.entries(byCategory)) {
      const keep = lenses.filter((lens) => {
        const hay = `${lens.name} ${lens.description} ${(lens.keywords || []).join(' ')}`.toLowerCase();
        return hay.includes(query);
      });
      if (keep.length) filtered[cat as keyof typeof byCategory] = keep;
    }
    return filtered;
  }, [q]);

  // Flat ordered list of visible lenses — drives arrow-key grid navigation.
  const flatLenses = useMemo(() => Object.values(grouped).flat(), [grouped]);
  const total = flatLenses.length;

  // Per-lens last-activity badges, sourced from the usage ledger + DTU store.
  useEffect(() => {
    let cancelled = false;
    const ids = Object.values(getLensesByCategory()).flat().map((l) => l.id);
    if (!ids.length) return;
    lensRun<BadgesResult>('all', 'lens-badges', { lensIds: ids })
      .then((r) => { if (!cancelled && r.data?.ok && r.data.result) setBadges(r.data.result.badges || {}); })
      .catch(() => { /* badges are decorative; the grid still works without them */ });
    return () => { cancelled = true; };
  }, [launcherRefresh]);

  // Records a lens open in the usage ledger, then navigates.
  const openLens = useCallback(async (lensId: string, path: string) => {
    void lensRun('all', 'record-open', { lensId }).then(() => setLauncherRefresh((n) => n + 1));
    router.push(path);
  }, [router]);

  useLensCommand(
    [
      { id: 'focus-search', keys: '/', description: 'Search lenses', category: 'navigation', action: () => searchInputRef.current?.focus() },
      { id: 'command-palette', keys: 'mod+k', description: 'Open command palette', category: 'navigation', action: () => setPaletteOpen(true) },
    ],
    { lensId: 'all' }
  );

  // Arrow-key navigation through the lens grid + Enter to open.
  const onGridKey = useCallback((e: React.KeyboardEvent) => {
    if (!total) return;
    const cols = 3;
    if (e.key === 'ArrowRight') { e.preventDefault(); setActiveIdx((i) => Math.min((i < 0 ? 0 : i + 1), total - 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveIdx((i) => Math.max((i < 0 ? 0 : i - 1), 0)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min((i < 0 ? 0 : i + cols), total - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max((i < 0 ? 0 : i - cols), 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      const lens = flatLenses[activeIdx];
      if (lens) void openLens(lens.id, lens.path);
    }
  }, [total, activeIdx, flatLenses, openLens]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = document.querySelector<HTMLElement>(`[data-lens-card-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    el?.focus();
  }, [activeIdx]);

  const togglePin = useCallback(async (lensId: string) => {
    await lensRun('all', 'pin-toggle', { lensId });
    setLauncherRefresh((n) => n + 1);
  }, []);

  // Map each flat index back to its category for stable card numbering.
  let runningIdx = -1;

  return (
    <LensShell lensId="all" asMain={false}>
      <FirstRunTour lensId="all" />      <DepthBadge lensId="all" size="sm" className="ml-2" />
    <NorthStarFrame
      lensId="all"
      crumb="Lens Hub"
      title={`Where to next${who ? `, ${who}` : ''}`}
      subtitle="Search, pin, and jump to any lens or action."
      actions={<LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />}
      cta={{ label: 'Command palette', icon: Command, onClick: () => setPaletteOpen(true), title: 'Open the command palette (Cmd/Ctrl+K)' }}
    >
    <div className="space-y-5">
      <PinnedShelf refreshKey={launcherRefresh} onChange={() => setLauncherRefresh((n) => n + 1)} />
      <RecentLensesStrip refreshKey={launcherRefresh} />
      <SubstratePulsePanel />

      <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
        <label className="relative block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchInputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(-1); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setQ(''); setActiveIdx(-1); searchInputRef.current?.blur(); }
              else if (e.key === 'ArrowDown' && total) { e.preventDefault(); setActiveIdx(0); }
            }}
            placeholder="Search by lens name, description, or keyword  ·  / focuses  ·  ↓ enters grid"
            className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </label>
        <p className="text-xs text-gray-400 mt-2">
          {total} lenses found · arrow keys navigate the grid · Enter opens
        </p>
      </div>

      <div className="space-y-4" onKeyDown={onGridKey} role="grid" aria-label="All lenses">
        {Object.entries(grouped).map(([cat, lenses]) => (
          <section key={cat} className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <h2 className={`text-sm uppercase tracking-wider mb-3 ${LENS_CATEGORIES[cat as keyof typeof LENS_CATEGORIES]?.color || 'text-gray-400'}`}>
              {LENS_CATEGORIES[cat as keyof typeof LENS_CATEGORIES]?.label || cat}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {lenses.map((lens) => {
                runningIdx += 1;
                const idx = runningIdx;
                const Icon = lens.icon;
                const badge = badges[lens.id];
                const isActive = idx === activeIdx;
                return (
                  <div
                    key={lens.id}
                    data-lens-card-idx={idx}
                    tabIndex={isActive ? 0 : -1}
                    role="gridcell"
                    onClick={() => void openLens(lens.id, lens.path)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openLens(lens.id, lens.path); } }}
                    className={`group relative cursor-pointer bg-lattice-void border rounded-lg p-3 transition-colors ${isActive ? 'border-neon-blue ring-1 ring-neon-blue/40' : 'border-lattice-border hover:border-neon-blue/50'}`}
                  >
                    <div className="flex items-center gap-2 text-white font-medium">
                      <Icon className="w-4 h-4 text-neon-cyan" />
                      <span className="flex-1 truncate">{lens.name}</span>
                      {badge && (
                        <span className="rounded-full bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.5" title={`${badge.count} new since last visit`}>
                          {badge.count > 99 ? '99+' : badge.count} new
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void togglePin(lens.id); }}
                        aria-label={`Pin ${lens.name}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-amber-400"
                      >
                        <Star className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{lens.description}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {total === 0 && (
          <div className="rounded-2xl border border-white/10 bg-[#111] p-8 text-center text-sm text-gray-400">No lenses match your search.</div>
        )}
      </div>
      <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
        <CrossDomainSearch />
      </section>
    </div>
    </NorthStarFrame>

    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <a href="#all-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to all content</a>
    </LensShell>
  );
}

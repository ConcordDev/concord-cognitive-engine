'use client';

/**
 * FE-007: Global Command Palette — Cmd/Ctrl+K to search across all lenses.
 *
 * - Reads lens list from the canonical lens registry via getCommandPaletteLenses()
 * - Open/close state managed by Zustand UI store (commandPaletteOpen)
 * - Fuzzy matching on name + keywords + description
 * - Arrow key navigation, Enter to select, Escape to close
 * - framer-motion for smooth open/close animation
 * - Tailwind + lattice dark theme styling
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, CornerDownLeft, ArrowUp, ArrowDown, Sparkles, LayoutPanelLeft } from 'lucide-react';
import { useUIStore } from '@/store/ui';
import {
  getCommandPaletteLenses,
  LENS_CATEGORIES,
  type LensEntry,
  type LensCategory,
} from '@/lib/lens-registry';
import { allPanels } from '@/lib/panel-registry';
import { openPanel } from '@/lib/panel-dispatcher';
import { cn } from '@/lib/utils';

// ── Fuzzy matching ──────────────────────────────────────────────

/**
 * Simple fuzzy match: checks whether every character in the query
 * appears in order within the target string (case-insensitive).
 * Returns a score (lower = better) or -1 for no match.
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Bonus for consecutive matches
      score += ti === lastMatchIndex + 1 ? 0 : ti - (lastMatchIndex + 1);
      lastMatchIndex = ti;
      qi++;
    }
  }

  // All query chars must be found
  if (qi < q.length) return -1;

  return score;
}

/**
 * Score a lens entry against a query. Checks name, keywords, and description.
 * Returns the best (lowest) score, or -1 if no match.
 */
function scoreLens(lens: LensEntry, query: string): number {
  if (!query) return 0;

  const nameScore = fuzzyScore(query, lens.name);
  const descScore = fuzzyScore(query, lens.description);

  // Check keywords
  let bestKeywordScore = -1;
  if (lens.keywords) {
    for (const kw of lens.keywords) {
      const s = fuzzyScore(query, kw);
      if (s !== -1 && (bestKeywordScore === -1 || s < bestKeywordScore)) {
        bestKeywordScore = s;
      }
    }
  }

  // Exact prefix match on name gets top priority
  if (lens.name.toLowerCase().startsWith(query.toLowerCase())) {
    return 0;
  }

  // Pick the best score across all fields, with name weighted best
  const scores = [
    nameScore !== -1 ? nameScore : Infinity,
    bestKeywordScore !== -1 ? bestKeywordScore + 5 : Infinity,
    descScore !== -1 ? descScore + 10 : Infinity,
  ];

  const best = Math.min(...scores);
  return best === Infinity ? -1 : best;
}

// ── Component ───────────────────────────────────────────────────

/**
 * Optional controlled-mode props. When omitted, the palette mirrors
 * the UI store's `commandPaletteOpen` flag (default behaviour). When
 * supplied, the consumer owns open/close — useful inside modals,
 * fullscreen world experiences, or tests that want explicit control.
 */
export interface CommandPaletteProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function CommandPalette({ isOpen: isOpenProp, onClose }: CommandPaletteProps = {}) {
  const router = useRouter();
  const storeIsOpen = useUIStore((s) => s.commandPaletteOpen);
  const setStoreOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const isControlled = isOpenProp !== undefined;
  const isOpen = isControlled ? isOpenProp : storeIsOpen;
  const setOpen = useCallback((next: boolean) => {
    if (isControlled) {
      if (!next) onClose?.();
    } else {
      setStoreOpen(next);
    }
  }, [isControlled, onClose, setStoreOpen]);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // All command-palette-eligible lenses (stable between renders). ConKay — Kay,
  // Concord's voice-native AI majordomo — is prepended as a "hidden staple" so it
  // can be summoned from anywhere; selecting it drops into ConKay chat mode.
  const allLenses = useMemo(() => {
    const conkay: LensEntry = {
      id: 'conkay',
      name: 'ConKay — Summon Kay',
      icon: Sparkles,
      description: 'Voice-native AI majordomo · your archives + research + live visualizations',
      category: 'core',
      showInSidebar: false,
      showInCommandPalette: true,
      path: '/lenses/chat?mode=conkay',
      order: 0,
      keywords: ['conkay', 'kay', 'jarvis', 'friday', 'assistant', 'majordomo', 'voice', 'ai', 'brief'],
    };
    // Cross-lens panels — every registered panel is summonable from anywhere as
    // a modal (GlobalPanelHost). Surfaced as `panel:<id>` pseudo-entries so the
    // same fuzzy search finds them; selecting one calls openPanel (see below).
    const panelEntries: LensEntry[] = allPanels().map((p) => ({
      id: `panel:${p.id}`,
      name: `Panel — ${p.label}`,
      icon: LayoutPanelLeft,
      description: p.description || 'Cross-lens panel',
      category: 'system',
      showInSidebar: false,
      showInCommandPalette: true,
      path: '',
      order: 900,
      keywords: ['panel', ...(p.keywords ?? [])],
    }));
    return [conkay, ...getCommandPaletteLenses(), ...panelEntries];
  }, []);

  // Filtered + scored results
  const results = useMemo(() => {
    if (!query.trim()) return allLenses;

    const scored: { lens: LensEntry; score: number }[] = [];
    for (const lens of allLenses) {
      const s = scoreLens(lens, query.trim());
      if (s !== -1) {
        scored.push({ lens, score: s });
      }
    }

    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.lens);
  }, [query, allLenses]);

  // Group results by category for display
  const groupedResults = useMemo(() => {
    const groups: { category: LensCategory; label: string; color: string; lenses: LensEntry[] }[] = [];
    const categoryMap = new Map<LensCategory, LensEntry[]>();

    for (const lens of results) {
      const existing = categoryMap.get(lens.category);
      if (existing) {
        existing.push(lens);
      } else {
        categoryMap.set(lens.category, [lens]);
      }
    }

    for (const [cat, lenses] of categoryMap) {
      const config = LENS_CATEGORIES[cat];
      groups.push({
        category: cat,
        label: config.label,
        color: config.color,
        lenses,
      });
    }

    return groups;
  }, [results]);

  // Flat list for keyboard navigation indexing
  const flatResults = useMemo(() => {
    const flat: LensEntry[] = [];
    for (const group of groupedResults) {
      flat.push(...group.lenses);
    }
    return flat;
  }, [groupedResults]);

  // ── Global Cmd/Ctrl+K listener ──────────────────────────────

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!isOpen);
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, setOpen]);

  // ── Focus input when opened, reset state ────────────────────

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Small delay to let animation start before focusing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // ── Scroll selected item into view ──────────────────────────

  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-palette-item]');
    const activeItem = items[selectedIndex] as HTMLElement | undefined;
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // ── Navigation handler ──────────────────────────────────────

  const navigateToLens = useCallback(
    (lens: LensEntry) => {
      setOpen(false);
      // A `panel:<id>` entry summons that panel as a modal over the current lens
      // (GlobalPanelHost) instead of navigating away.
      if (lens.id.startsWith('panel:') && typeof window !== 'undefined') {
        openPanel(lens.id.slice('panel:'.length));
        return;
      }
      // "Summon Kay" opens the cross-lens ConKay overlay ON the current lens
      // (operates the host lens' real macros) rather than navigating away.
      if (lens.id === 'conkay' && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('conkay:summon'));
        return;
      }
      // Paths carrying a query (e.g. a deep link) use a full navigation so the
      // destination's mount effect reliably picks up the param even when we're
      // already on that pathname.
      if (lens.path.includes('?') && typeof window !== 'undefined') {
        window.location.href = lens.path;
      } else {
        router.push(lens.path);
      }
    },
    [setOpen, router],
  );

  // ── Keyboard navigation within palette ──────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < flatResults.length - 1 ? prev + 1 : 0,
          );
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : flatResults.length - 1,
          );
          break;

        case 'Enter':
          e.preventDefault();
          if (flatResults[selectedIndex]) {
            navigateToLens(flatResults[selectedIndex]);
          }
          break;

        case 'Escape':
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [flatResults, selectedIndex, navigateToLens, setOpen],
  );

  // ── Render ──────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="command-palette-backdrop"
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Palette container */}
          <motion.div
            key="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="fixed inset-0 z-[61] flex items-start justify-center pt-[15vh] px-4 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="w-full max-w-xl bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden pointer-events-auto"
              initial={{ scale: 0.95, y: -10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: -10 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              onKeyDown={handleKeyDown}
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-lattice-border">
                <Search className="w-5 h-5 text-gray-400 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search lenses..."
                  className="flex-1 bg-transparent text-white text-sm placeholder:text-gray-400 outline-none"
                  aria-label="Search lenses"
                  aria-activedescendant={
                    flatResults[selectedIndex]
                      ? `palette-item-${flatResults[selectedIndex].id}`
                      : undefined
                  }
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="command-palette-list"
                  aria-haspopup="listbox"
                />
                <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-gray-400 bg-lattice-elevated border border-lattice-border rounded">
                  ESC
                </kbd>
              </div>

              {/* Results list */}
              <div
                ref={listRef}
                id="command-palette-list"
                role="listbox"
                className="max-h-[50vh] overflow-y-auto overscroll-contain"
              >
                {flatResults.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-400">
                      No lenses matching &ldquo;{query}&rdquo;
                    </p>
                  </div>
                ) : (
                  groupedResults.map((group) => (
                    <div key={group.category}>
                      {/* Category header */}
                      <div className="px-4 pt-3 pb-1">
                        <span
                          className={cn(
                            'text-[11px] font-semibold uppercase tracking-wider',
                            group.color,
                          )}
                        >
                          {group.label}
                        </span>
                      </div>

                      {/* Lens items */}
                      {group.lenses.map((lens) => {
                        const globalIndex = flatResults.indexOf(lens);
                        const isSelected = globalIndex === selectedIndex;
                        const Icon = lens.icon;

                        return (
                          <button
                            key={lens.id}
                            id={`palette-item-${lens.id}`}
                            data-palette-item
                            role="option"
                            aria-selected={isSelected}
                            className={cn(
                              'flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors',
                              isSelected
                                ? 'bg-neon-cyan/10 text-white'
                                : 'text-gray-300 hover:bg-lattice-elevated hover:text-white',
                            )}
                            onClick={() => navigateToLens(lens)}
                            onMouseEnter={() => setSelectedIndex(globalIndex)}
                          >
                            {/* Icon */}
                            <div
                              className={cn(
                                'flex items-center justify-center w-8 h-8 rounded-lg shrink-0',
                                isSelected
                                  ? 'bg-neon-cyan/20 text-neon-cyan'
                                  : 'bg-lattice-elevated text-gray-400',
                              )}
                            >
                              <Icon className="w-4 h-4" />
                            </div>

                            {/* Name + description */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {lens.name}
                              </div>
                              <div className="text-xs text-gray-400 truncate">
                                {lens.description}
                              </div>
                            </div>

                            {/* Navigation hint on selected item */}
                            {isSelected && (
                              <CornerDownLeft className="w-4 h-4 text-neon-cyan shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer hints */}
              <div className="flex items-center gap-4 px-4 py-2 border-t border-lattice-border text-[11px] text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <ArrowUp className="w-3 h-3" />
                  <ArrowDown className="w-3 h-3" />
                  navigate
                </span>
                <span className="inline-flex items-center gap-1">
                  <CornerDownLeft className="w-3 h-3" />
                  open
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-lattice-elevated border border-lattice-border rounded text-[10px]">
                    esc
                  </kbd>
                  close
                </span>
                <span className="ml-auto inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-lattice-elevated border border-lattice-border rounded text-[10px]">
                    {typeof navigator !== 'undefined' &&
                    /Mac|iPhone|iPad/.test(navigator.userAgent)
                      ? '\u2318'
                      : 'Ctrl'}
                  </kbd>
                  <kbd className="px-1 py-0.5 bg-lattice-elevated border border-lattice-border rounded text-[10px]">
                    K
                  </kbd>
                  toggle
                </span>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

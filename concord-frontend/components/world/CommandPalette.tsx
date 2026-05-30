'use client';

// Phase DA3 — Global command palette.
//
// Ctrl+K (or Cmd+K) inside the world lens opens a full-overlay search
// that indexes all 240+ lenses + a curated list of world-action commands.
// Fuzzy-matches by name / keywords / category; Enter navigates or runs.
//
// Production invariant: Ctrl+K is sacred. Don't rebind it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Command as CmdIcon, ArrowRight } from 'lucide-react';

interface PaletteEntry {
  id: string;
  label: string;
  category: string;
  keywords: string[];
  kind: 'lens' | 'action';
  // For lenses: path. For actions: handler.
  path?: string;
  handler?: () => void;
}

// World actions surfaced INSIDE the palette in addition to lens routes.
// These don't have a lens page — they dispatch events the world lens
// already listens for.
const WORLD_ACTIONS: PaletteEntry[] = [
  { id: 'action:photo-mode',    label: 'Open Photo Mode',         category: 'world',   keywords: ['photo', 'screenshot', 'p'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:photo-mode-toggle')) },
  { id: 'action:roguelite',     label: 'Start Roguelite Run',     category: 'mode',    keywords: ['roguelite', 'hades', 'run', 'meta'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'roguelite' } })) },
  { id: 'action:horde',         label: 'Start Horde Wave',        category: 'mode',    keywords: ['horde', 'bullet heaven', 'vampire survivors', 'wave'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'horde' } })) },
  { id: 'action:extraction',    label: 'Start Extraction Run',    category: 'mode',    keywords: ['extraction', 'tarkov', 'loot', 'run'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'extraction' } })) },
  { id: 'action:horror-ghost',  label: 'Host Horror Session (Ghost)', category: 'mode', keywords: ['horror', 'phasmophobia', 'dbd', 'ghost'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'horror-ghost' } })) },
  { id: 'action:horror-invest', label: 'Join Horror as Investigator', category: 'mode', keywords: ['horror', 'investigator', 'evidence'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'horror-investigator' } })) },
  { id: 'action:time-loop',     label: 'Enter Time Loop World',   category: 'mode',    keywords: ['outer wilds', 'loop', 'rewind'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'time-loop' } })) },
  { id: 'action:brawl',         label: 'Find Brawl Opponent',     category: 'mode',    keywords: ['brawl', 'fist', '1v1'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'brawl-matchmaker' } })) },
  { id: 'action:party-combat',  label: 'Start Party Combat',      category: 'mode',    keywords: ['party', 'crpg', 'tactical', 'rtwp'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:start-mode', { detail: { mode: 'party-combat' } })) },
  { id: 'action:training',      label: 'Open Training Room',      category: 'world',   keywords: ['training', 'dojo', 'frame data'], kind: 'action', path: '/lenses/training-room' },
  // Phase E7 — group + matchmaking actions.
  { id: 'action:lfg-board',     label: 'Find a Group (LFG)',      category: 'social',  keywords: ['lfg', 'group', 'party', 'looking', 'tank', 'healer'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:open-lfg-board')) },
  { id: 'action:brawl-queue',   label: 'Brawl Matchmaker',        category: 'mode',    keywords: ['brawl', 'matchmaking', 'queue', '1v1', 'fist'], kind: 'action', handler: () => window.dispatchEvent(new CustomEvent('concordia:open-brawl-queue')) },
];

function fuzzyMatch(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 100;
  // Subsequence match (e.g. "hrd" matches "horde")
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 10 : -1;
}

function scoreEntry(query: string, entry: PaletteEntry): number {
  if (!query) return 0;
  let best = -1;
  best = Math.max(best, fuzzyMatch(query, entry.label));
  best = Math.max(best, fuzzyMatch(query, entry.id));
  for (const k of entry.keywords) best = Math.max(best, fuzzyMatch(query, k));
  return best;
}

interface RegistryShape {
  default?: { id: string; name: string; description?: string; category: string; path: string; keywords?: string[] }[];
  LENS_REGISTRY?: { id: string; name: string; description?: string; category: string; path: string; keywords?: string[] }[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [lensEntries, setLensEntries] = useState<PaletteEntry[]>([]);
  const router = useRouter();

  // Lazy-load lens-registry once.
  useEffect(() => {
    let cancelled = false;
    import('@/lib/lens-registry').then((mod) => {
      if (cancelled) return;
      const reg = mod as unknown as RegistryShape;
      const list = reg.LENS_REGISTRY || reg.default || [];
      const entries: PaletteEntry[] = list.map((l) => ({
        id: l.id,
        label: l.name,
        category: l.category,
        keywords: l.keywords || [],
        kind: 'lens',
        path: l.path,
      }));
      setLensEntries(entries);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Ctrl+K / Cmd+K binding.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        // Phase E8 — tutorial action for the palette-open step.
        window.dispatchEvent(new CustomEvent('concordia:tutorial-action', { detail: { action: 'palette-open' } }));
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const allEntries = useMemo(() => [...WORLD_ACTIONS, ...lensEntries], [lensEntries]);

  const matches = useMemo(() => {
    if (!query) return allEntries.slice(0, 12);
    return allEntries
      .map((e) => ({ entry: e, score: scoreEntry(query, e) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.entry);
  }, [query, allEntries]);

  useEffect(() => { setSelectedIdx(0); }, [query, open]);

  const runEntry = useCallback((entry: PaletteEntry) => {
    setOpen(false);
    if (entry.handler) entry.handler();
    if (entry.path) router.push(entry.path);
  }, [router]);

  // Keyboard nav within the palette.
  useEffect(() => {
    if (!open) return;
    function onNav(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(matches.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && matches[selectedIdx]) {
        e.preventDefault();
        runEntry(matches[selectedIdx]);
      }
    }
    window.addEventListener('keydown', onNav);
    return () => window.removeEventListener('keydown', onNav);
  }, [open, matches, selectedIdx, runEntry]);

  if (!open) return null;

  return (
    <div
      className="concordia-hud-fade fixed inset-0 z-40 flex items-start justify-center bg-black/60 pt-24 backdrop-blur"
      role="button"
      tabIndex={0}
      onClick={(e) => { if (e.currentTarget === e.target) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
    >
      <div className="w-full max-w-xl rounded-xl border border-sky-500/40 bg-zinc-950/95 shadow-2xl">
        <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <Search size={14} className="text-sky-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lenses + world actions… (Ctrl+K to toggle)"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">ESC</kbd>
        </header>

        <ul className="max-h-96 overflow-y-auto">
          {matches.length === 0 ? (
            <li className="py-6 text-center text-[12px] text-zinc-500">No matches.</li>
          ) : (
            matches.map((entry, idx) => (
              <li key={entry.id}>
                <button
                  onClick={() => runEntry(entry)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${idx === selectedIdx ? 'bg-sky-500/15 text-sky-100' : 'text-zinc-300 hover:bg-zinc-800/60'}`}
                >
                  <div className="flex items-center gap-2">
                    {entry.kind === 'action' ? <CmdIcon size={11} className="text-sky-400" /> : <ArrowRight size={11} className="text-zinc-500" />}
                    <span>{entry.label}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500">{entry.category}</span>
                </button>
              </li>
            ))
          )}
        </ul>

        <footer className="flex items-center justify-between border-t border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-500">
          <span>↑↓ navigate · ⏎ select · esc close</span>
          <span>{matches.length} / {allEntries.length}</span>
        </footer>
      </div>
    </div>
  );
}

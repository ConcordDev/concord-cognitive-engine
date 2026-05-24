'use client';

/**
 * CommandPalette — Layer 3 of the dynamic HUD.
 *
 * Cmd+K / C key opens a centred fuzzy-search input. Power-user surface
 * for hitting any of the 12 substrate panels (Bloodline, Schemes,
 * Hooks, Jobs, Crafts, Dynasty, Marriage, Realm, Council, Calendar,
 * Stamina, Underwater) plus quick actions (Open HUD settings, Reset
 * dismissed nudges, etc.) without committing tab-strip chrome.
 *
 * Dispatches `concordia:panel-open` CustomEvent with { panelId } that
 * PanelHost listens for.
 *
 * Mode-aware: hidden in combat / dialogue / vehicle / photo.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useHUDContext } from './HUDContextProvider';

export interface CommandItem {
  id: string;
  label: string;
  keywords?: string;
  shortcut?: string;
  group?: 'panel' | 'action' | 'setting';
  action: () => void;
}

const PANEL_COMMANDS: Array<{ id: string; label: string; keywords: string; shortcut?: string }> = [
  { id: 'bloodline',  label: 'Bloodline',   keywords: 'ancestry blood dilution sanguire medici', shortcut: 'B' },
  { id: 'schemes',    label: 'Schemes',     keywords: 'plot scheme blackmail seduce assassinate', shortcut: 'S' },
  { id: 'hooks',      label: 'Hooks',       keywords: 'evidence satchel artifact' },
  { id: 'jobs',       label: 'Jobs',        keywords: 'work employment shift wage tunyan rations', shortcut: 'J' },
  { id: 'crafts',     label: 'Crafts',      keywords: 'craft chain recipe textile forge alchemy food' },
  { id: 'dynasty',    label: 'Dynasty',     keywords: 'house heir succession renown', shortcut: 'D' },
  { id: 'marriage',   label: 'Marriage',    keywords: 'marry spouse union partner' },
  { id: 'realm',      label: 'Realm',       keywords: 'exile access entry kingdom' },
  { id: 'council',    label: 'Council',     keywords: 'session petition vote lobby' },
  { id: 'calendar',   label: 'Calendar',    keywords: 'tunyan civic month season festival' },
  { id: 'stamina',    label: 'Stamina',     keywords: 'sprint climb swim rest exhausted' },
  { id: 'underwater', label: 'Underwater',  keywords: 'kelp coral wreck trench dive depth' },
  { id: 'hud-settings', label: 'HUD Settings', keywords: 'hide minimal expert opt-out config' },
];

function fuzzyScore(query: string, target: string): number {
  if (!query) return 0.5;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.startsWith(q)) return 1.0;
  if (t.includes(q)) return 0.7;
  // Character-by-character subsequence match.
  let ti = 0, hit = 0;
  for (let qi = 0; qi < q.length; qi++) {
    while (ti < t.length && t[ti] !== q[qi]) ti++;
    if (ti >= t.length) return 0;
    ti++; hit++;
  }
  return hit / q.length * 0.4;
}

function openPanel(panelId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('concordia:panel-open', { detail: { panelId } }));
}

export function CommandPalette() {
  const mode = useHUDContext((s) => s.inputMode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open on C key (matches old ConcordiaHUDPanels toggle) or Cmd+K (power user).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable);
      if (ev.key === 'k' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        setOpen((o) => !o);
      } else if (ev.key === 'c' && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !inField) {
        setOpen((o) => !o);
      } else if (ev.key === 'Escape' && open) {
        setOpen(false);
        setQuery('');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus input when opened.
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
    if (!open) { setQuery(''); setHover(0); }
  }, [open]);

  const commands: CommandItem[] = useMemo(() => PANEL_COMMANDS.map((p) => ({
    ...p,
    group: p.id === 'hud-settings' ? 'setting' : 'panel',
    action: () => { openPanel(p.id); setOpen(false); },
  })), []);

  const ranked: CommandItem[] = useMemo(() => {
    if (!query) return commands;
    return commands
      .map((c) => ({ c, s: Math.max(fuzzyScore(query, c.label), fuzzyScore(query, c.keywords || '')) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [commands, query]);

  if (!open || mode === 'combat' || mode === 'dialogue' || mode === 'vehicle' || mode === 'photo') return null;

  function onKey(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setHover((h) => Math.min(ranked.length - 1, h + 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setHover((h) => Math.max(0, h - 1)); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      const choice = ranked[hover];
      if (choice) choice.action();
    } else if (ev.key === 'Escape') {
      setOpen(false); setQuery('');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      data-testid="hud-command-palette"
      role="dialog"
      aria-label="Concordia command palette"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="w-[28rem] max-h-[60vh] bg-zinc-950 border border-zinc-700/60 rounded-lg shadow-2xl flex flex-col">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHover(0); }}
          onKeyDown={onKey}
          placeholder="Type to find — bloodline, schemes, jobs…"
          aria-label="Search panels"
          className="bg-transparent text-zinc-100 px-4 py-3 border-b border-zinc-800 outline-none placeholder:text-zinc-500"
        />
        <ul className="flex-1 overflow-auto py-1" role="listbox" aria-label="Command results">
          {ranked.length === 0 ? (
            <li className="px-4 py-2 text-xs text-zinc-500 italic">No matches.</li>
          ) : ranked.map((c, idx) => (
            <li
              key={c.id}
              role="option"
              aria-selected={idx === hover}
              data-cmd-id={c.id}
              onMouseEnter={() => setHover(idx)}
              onClick={() => c.action()}
              className={`px-4 py-2 cursor-pointer flex items-center gap-2 text-sm ${idx === hover ? 'bg-amber-900/40 text-amber-100' : 'text-zinc-300 hover:bg-zinc-900'}`}
            >
              <span className="flex-1">{c.label}</span>
              {c.shortcut && <kbd className="font-mono text-[10px] px-1 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400">{c.shortcut}</kbd>}
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{c.group}</span>
            </li>
          ))}
        </ul>
        <div className="px-4 py-1.5 border-t border-zinc-800 text-[10px] text-zinc-500 flex gap-3">
          <span>↑↓ navigate</span><span>↩ open</span><span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

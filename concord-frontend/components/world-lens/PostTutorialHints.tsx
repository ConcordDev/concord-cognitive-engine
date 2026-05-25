'use client';

/**
 * PostTutorialHints
 *
 * After the player finishes the 5-step tutorial, this rotates a series of
 * progressively-deeper hints suggesting what to explore next: marketplace,
 * party, lenses, council, federation, plugins. Dismissable; remembers
 * dismissals in localStorage so it doesn't pester returning players.
 */

import { useEffect, useState, useCallback } from 'react';
import { Lightbulb, X } from 'lucide-react';

interface Hint {
  id: string;
  title: string;
  body: string;
}

const HINTS: Hint[] = [
  { id: 'marketplace',  title: 'Visit the bazaar',          body: 'Top-tier DTUs are listed as vendor stalls in the Exchange district. Click a stall to inspect.' },
  { id: 'party',        title: 'Form a party',              body: 'Press the Players button. Cooperative build sites, shared stash, and cross-world raids unlock when you party up.' },
  { id: 'lens',         title: 'Try a lens',                body: 'Beyond Concordia there are 175 specialized lenses — agriculture, council, music studio. Each runs its own backend macros.' },
  { id: 'council',      title: 'Watch the council',         body: 'Every 30 min the Council Live Theater streams a deliberation. Voices speak one at a time.' },
  { id: 'fork',         title: 'Fork a DTU',                body: 'Cite an existing DTU when authoring your own. Original creators get 95% of any future earnings on your derivative.' },
  { id: 'federation',   title: 'Peer with another node',    body: 'Open the Federation lens and probe a peer URL. Cross-instance search fans your queries across all peers.' },
  { id: 'plugin',       title: 'Build a plugin',            body: 'Server-side plugins extend the platform with new macros + lifecycle hooks. See server/plugins/PROTOCOL.md.' },
];

const DISMISSED_KEY = 'concordia:hints:dismissed';
const PERMANENT_KEY = 'concordia:hints:disabled';

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set();
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set])); }
  catch { /* persistence best-effort */ }
}

export default function PostTutorialHints() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (localStorage.getItem(PERMANENT_KEY)) return false;
    // Only show after the main tutorial is done.
    return !!localStorage.getItem('world_lens_visited');
  });
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [currentIdx, setCurrentIdx] = useState(0);

  const remaining = HINTS.filter((h) => !dismissed.has(h.id));

  useEffect(() => {
    // Cycle to next undismissed hint when current one is dismissed.
    if (remaining.length === 0) return;
    if (currentIdx >= remaining.length) setCurrentIdx(0);
  }, [remaining.length, currentIdx]);

  const dismissCurrent = useCallback(() => {
    if (remaining.length === 0) return;
    const hint = remaining[currentIdx % remaining.length];
    const next = new Set(dismissed);
    next.add(hint.id);
    setDismissed(next);
    saveDismissed(next);
    setCurrentIdx((i) => i + 1);
  }, [dismissed, remaining, currentIdx]);

  const dismissAll = useCallback(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(PERMANENT_KEY, '1'); } catch { /* best-effort */ }
    setEnabled(false);
  }, []);

  if (!enabled || remaining.length === 0) return null;
  const hint = remaining[currentIdx % remaining.length];

  return (
    <div className="fixed bottom-6 right-6 z-40 max-w-xs pointer-events-auto">
      <div className="rounded-lg border border-cyan-500/30 bg-black/85 backdrop-blur-sm p-3 shadow-lg">
        <div className="flex items-start gap-2 mb-2">
          <Lightbulb className="w-4 h-4 text-cyan-300 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-cyan-200 text-sm font-semibold">{hint.title}</div>
            <p className="text-xs text-gray-300 mt-1 leading-relaxed">{hint.body}</p>
          </div>
          <button
            type="button"
            onClick={dismissCurrent}
            className="text-gray-400 hover:text-white"
            aria-label="Dismiss this hint"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400 font-mono">
            {currentIdx + 1} / {remaining.length}
          </span>
          <button
            type="button"
            onClick={dismissAll}
            className="text-[10px] text-gray-400 hover:text-rose-300"
          >
            stop tips
          </button>
        </div>
      </div>
    </div>
  );
}

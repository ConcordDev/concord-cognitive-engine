'use client';

/**
 * PhotoMode — pause the world, free the camera, apply a filter,
 * capture a still.
 *
 * Concordia Phase 15. Listens for `concordia:photo-mode-toggle`
 * CustomEvent (existing dispatcher in CinematicCaptureBootstrap).
 * When active:
 *   - dispatches `concordia:time-dilation` to ~0 (pauses the world tick)
 *   - exposes 6 filter buttons (Velvia / Provia / Astia / B&W / sepia /
 *     infrared) that overlay a CSS filter on the canvas
 *   - on Escape, restores time-dilation to 1.0 and clears the filter
 *
 * No backend integration — purely a presentation layer that the
 * world-lens hosts (ConcordiaScene) reads via the CSS variable
 * `--photo-filter` on the canvas root.
 */

import { useEffect, useState, useCallback } from 'react';

type Filter = 'none' | 'velvia' | 'provia' | 'astia' | 'bw' | 'sepia' | 'infrared';

const FILTER_CSS: Record<Filter, string> = {
  none:     'none',
  velvia:   'saturate(1.55) contrast(1.12) hue-rotate(-3deg)',
  provia:   'saturate(1.18) contrast(1.05)',
  astia:    'saturate(0.92) contrast(1.02) hue-rotate(2deg)',
  bw:       'saturate(0) contrast(1.18)',
  sepia:    'sepia(0.75) saturate(1.1)',
  infrared: 'invert(1) hue-rotate(180deg) saturate(1.4) contrast(1.1)',
};

const FILTER_LABEL: Record<Filter, string> = {
  none:     'None',
  velvia:   'Velvia',
  provia:   'Provia',
  astia:    'Astia',
  bw:       'B&W',
  sepia:    'Sepia',
  infrared: 'Infrared',
};

export function PhotoMode() {
  const [active, setActive] = useState(false);
  const [filter, setFilter] = useState<Filter>('none');

  // Toggle on event from elsewhere (P key, menu button, etc.)
  useEffect(() => {
    function onToggle() { setActive((a) => !a); }
    if (typeof window !== 'undefined') {
      window.addEventListener('concordia:photo-mode-toggle', onToggle);
      return () => window.removeEventListener('concordia:photo-mode-toggle', onToggle);
    }
  }, []);

  // Pause world tick + set CSS filter when active toggles.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (active) {
      window.dispatchEvent(new CustomEvent('concordia:time-dilation', { detail: { scale: 0.0001 } }));
      document.documentElement.style.setProperty('--photo-filter', FILTER_CSS[filter]);
    } else {
      // Exit photo mode: un-pause the world tick + clear the CSS filter. The
      // former `concordia:photo-mode-end` dispatch was dead (no listener) and
      // redundant — these two lines ARE the exit effect, so it was removed.
      window.dispatchEvent(new CustomEvent('concordia:time-dilation', { detail: { scale: 1.0 } }));
      document.documentElement.style.setProperty('--photo-filter', 'none');
      setFilter('none');
    }
  }, [active, filter]);

  // Escape to leave.
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActive(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const setFilterCb = useCallback((f: Filter) => setFilter(f), []);

  if (!active) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center pointer-events-none"
      data-testid="photo-mode-panel"
      role="dialog"
      aria-label="Photo mode"
    >
      <div className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 bg-black/85 border border-zinc-700/60 rounded-lg backdrop-blur-md">
        <span className="text-xs uppercase tracking-wider text-zinc-400 mr-1">Filter</span>
        {(Object.keys(FILTER_CSS) as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilterCb(f)}
            aria-label={`Apply ${FILTER_LABEL[f]} filter`}
            aria-pressed={filter === f}
            data-filter={f}
            className={`text-xs px-2 py-1 rounded ${filter === f ? 'bg-amber-700 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
        <span className="mx-2 text-[10px] text-zinc-400">Esc to exit</span>
      </div>
    </div>
  );
}

export const PHOTO_MODE_CONSTANTS = Object.freeze({
  FILTER_CSS,
  FILTER_LABEL,
});

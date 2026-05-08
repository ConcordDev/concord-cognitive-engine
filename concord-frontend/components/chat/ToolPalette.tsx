'use client';

/**
 * ToolPalette — searchable catalog of every domain.action discoverable
 * across the 200 lens manifests. Open via /tool slash command or
 * Cmd/Ctrl+. Run a tool inline; the result streams back via
 * chat:tool_result socket events and renders as a tool-trace block in
 * the conversation thread.
 *
 * The point: chat is 1:1 with Concord, and Concord has every tool in
 * the system available. Surfacing them via a single palette makes the
 * "every tool" claim concrete instead of buried behind macro names.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Play, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LENS_MANIFEST_INDEX } from '@/lib/lenses/manifest';
import { apiHelpers } from '@/lib/api/client';

export interface ToolEntry {
  domain: string;
  action: string;
  /** Human-readable lens name pulled from manifest.label. */
  lensLabel: string;
  /** Lens category for grouping. */
  category: string;
}

interface ToolPaletteProps {
  open: boolean;
  onClose: () => void;
  onRunStart?: (entry: ToolEntry) => void;
  onRunResult?: (entry: ToolEntry, result: unknown) => void;
}

function buildCatalog(): ToolEntry[] {
  const out: ToolEntry[] = [];
  for (const manifest of Object.values(LENS_MANIFEST_INDEX)) {
    for (const action of manifest.actions || []) {
      out.push({
        domain: manifest.domain,
        action,
        lensLabel: manifest.label,
        category: manifest.category,
      });
    }
  }
  // Stable sort: category, then lens, then action.
  out.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.lensLabel !== b.lensLabel) return a.lensLabel.localeCompare(b.lensLabel);
    return a.action.localeCompare(b.action);
  });
  return out;
}

function humanizeAction(action: string): string {
  return action.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function ToolPalette({ open, onClose, onRunStart, onRunResult }: ToolPaletteProps) {
  const catalog = useMemo(() => buildCatalog(), []);
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return catalog.slice(0, 200);
    const q = query.toLowerCase();
    return catalog
      .filter(
        (t) =>
          t.action.toLowerCase().includes(q) ||
          t.domain.toLowerCase().includes(q) ||
          t.lensLabel.toLowerCase().includes(q)
      )
      .slice(0, 200);
  }, [catalog, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ToolEntry[]>();
    for (const t of filtered) {
      if (!map.has(t.lensLabel)) map.set(t.lensLabel, []);
      map.get(t.lensLabel)!.push(t);
    }
    return [...map.entries()];
  }, [filtered]);

  async function run(entry: ToolEntry) {
    const key = `${entry.domain}.${entry.action}`;
    setRunning(key);
    onRunStart?.(entry);
    try {
      const res = await apiHelpers.lens.runDomain(entry.domain, entry.action, {});
      const body = (res as { data?: unknown }).data;
      onRunResult?.(entry, body);
    } catch (e) {
      onRunResult?.(entry, { ok: false, error: e instanceof Error ? e.message : 'failed' });
    } finally {
      setRunning(null);
      onClose();
    }
  }

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Tool palette"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl border border-lattice-border bg-lattice-bg shadow-2xl overflow-hidden"
      >
        <header className="flex items-center gap-2 border-b border-lattice-border px-4 py-3">
          <Sparkles className="w-4 h-4 text-neon-cyan" />
          <span className="text-sm font-semibold text-white">Tool palette</span>
          <span className="text-[11px] text-gray-500">
            every tool Concord can run · {catalog.length} actions across {Object.keys(LENS_MANIFEST_INDEX).length} lenses
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-white"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="border-b border-lattice-border px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by action, domain, or lens…"
              className="w-full pl-8 pr-3 py-2 bg-lattice-surface/40 border border-lattice-border rounded-md text-sm text-white focus:outline-none focus:border-neon-cyan/40"
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No tool matches.
            </div>
          ) : (
            grouped.map(([lensLabel, entries]) => (
              <div key={lensLabel} className="border-b border-lattice-border/50 last:border-0">
                <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 bg-lattice-surface/20">
                  {lensLabel} · <span className="font-mono text-gray-600">{entries[0]?.domain}</span>
                </div>
                <ul>
                  {entries.map((entry) => {
                    const key = `${entry.domain}.${entry.action}`;
                    const isRunning = running === key;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => run(entry)}
                          disabled={isRunning}
                          className={cn(
                            'w-full text-left px-4 py-2 flex items-center gap-3',
                            'hover:bg-lattice-surface/40 disabled:opacity-50',
                            'focus:outline-none focus:bg-lattice-surface/40',
                          )}
                        >
                          <span className="flex-1">
                            <span className="text-sm font-medium text-white">
                              {humanizeAction(entry.action)}
                            </span>
                            <span className="ml-2 text-xs text-gray-500 font-mono">
                              {entry.domain}.{entry.action}
                            </span>
                          </span>
                          {isRunning ? (
                            <Loader2 className="w-3.5 h-3.5 text-neon-cyan animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5 text-gray-500" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <footer className="border-t border-lattice-border px-4 py-2 flex items-center justify-between text-[11px] text-gray-500">
          <span>↵ run · esc close</span>
          <span>{filtered.length} of {catalog.length} shown</span>
        </footer>
      </div>
    </div>
  );
}

export default ToolPalette;

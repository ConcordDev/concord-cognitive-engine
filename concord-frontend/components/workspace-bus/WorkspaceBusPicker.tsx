'use client';

/**
 * WorkspaceBusPicker — the Cmd/Ctrl+Shift+V overlay. Lists the bus's
 * clipboard history (newest first), previewed with the existing
 * `DTUEmbed` component (compact mode — same convention chat/council/atlas
 * already use for inline DTU references). Loaded lazily by
 * `WorkspaceBusProvider` only while open; never part of the initial shell
 * bundle.
 */

import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { ClipboardPaste, Trash2, X } from 'lucide-react';

import { DTUEmbed, type DTUEmbedRecord } from '@/components/dtu/DTUEmbed';
import { useUIStore } from '@/store/ui';
import { useWorkspaceBus, type WorkspaceBusEntry } from './WorkspaceBusProvider';

function toEmbedRecord(entry: WorkspaceBusEntry): DTUEmbedRecord {
  const { dtu } = entry;
  return {
    id: dtu.id,
    title: dtu.title,
    summary: dtu.summary,
    domain: dtu.domain,
    tier: dtu.kind,
    tags: dtu.tags,
    createdAt: dtu.createdAt,
    creator: dtu.creator,
  };
}

export function WorkspaceBusPicker() {
  const bus = useWorkspaceBus();
  const activeLens = useUIStore((s) => s.activeLens);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useHotkeys('escape', () => bus.close(), { enableOnFormTags: true });

  async function handlePaste(entry: WorkspaceBusEntry) {
    setPendingId(entry.entryId);
    try {
      await bus.ingestDTU(entry.dtu, activeLens);
    } finally {
      setPendingId(null);
      bus.close();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center pt-24 px-4"
      onClick={() => bus.close()}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-lattice-border bg-lattice-bg shadow-2xl shadow-black/50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace Bus — DTU clipboard"
      >
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-lattice-border">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Workspace Bus</h2>
            <p className="text-[11px] text-gray-400 truncate">
              {bus.history.length === 0
                ? 'Your cross-lens DTU clipboard is empty.'
                : `${bus.history.length} DTU${bus.history.length === 1 ? '' : 's'} on the bus — paste into "${activeLens}".`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {bus.history.length > 0 && (
              <button
                type="button"
                onClick={bus.clear}
                className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-lattice-surface"
                title="Clear history"
                aria-label="Clear workspace bus history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={bus.close}
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-lattice-surface"
              title="Close (Esc)"
              aria-label="Close workspace bus"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-3">
          {bus.history.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-8">
              Nothing here yet. Copy a DTU from any lens (its &ldquo;Send to
              Workspace Bus&rdquo; action) and it will show up here, ready to
              paste into whatever lens you land in next.
            </p>
          ) : (
            bus.history.map((entry) => (
              <div key={entry.entryId} className="space-y-1">
                <DTUEmbed dtu={toEmbedRecord(entry)} mode="compact" />
                <div className="flex items-center gap-2 pl-1">
                  <button
                    type="button"
                    disabled={pendingId === entry.entryId}
                    onClick={() => handlePaste(entry)}
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-lattice-border/60 text-gray-300 hover:text-white hover:border-neon-cyan/50 disabled:opacity-50"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    {pendingId === entry.entryId ? 'Pasting…' : `Paste into ${activeLens}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => bus.removeEntry(entry.entryId)}
                    className="text-[10px] text-gray-500 hover:text-red-400"
                  >
                    Remove
                  </button>
                  {entry.sourceLensId && (
                    <span className="text-[10px] text-gray-500 ml-auto">from {entry.sourceLensId}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkspaceBusPicker;

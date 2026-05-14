'use client';

/**
 * Foundry — FoundryPreview.
 *
 * A slide-over panel that renders the world being built, live, in the
 * real 3D engine. ConcordiaScene is hardwired to load a world by id,
 * so the preview IS a real (transient) `worlds` row: foundry.preview
 * compiles the current draft into a status='preview' world and hands
 * back its id; we mount ConcordiaScene against it. foundry.preview_end
 * tears it down on close (and the foundry-preview-cleanup heartbeat
 * sweeps any orphan).
 *
 * The caller saves the draft before opening this, so the preview
 * reflects exactly what's on the canvas.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { previewWorld, endPreview } from '@/lib/foundry/api';
import { Loader2, X, AlertTriangle, Eye } from 'lucide-react';

const ConcordiaScene = dynamic(
  () => import('@/components/world-lens/ConcordiaScene'),
  { ssr: false, loading: () => null },
);

interface FoundryPreviewProps {
  foundryWorldId: string;
  worldName: string;
  onClose: () => void;
}

export function FoundryPreview({ foundryWorldId, worldName, onClose }: FoundryPreviewProps) {
  const [previewWorldId, setPreviewWorldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skippedStubs, setSkippedStubs] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await previewWorld(foundryWorldId);
        if (!alive) return;
        if (!r.ok || !r.previewWorldId) {
          setError(r.reason === 'no_systems'
            ? 'Add at least one system before previewing.'
            : `Preview failed: ${r.reason ?? 'unknown'}`);
          return;
        }
        setPreviewWorldId(r.previewWorldId);
        setSkippedStubs(r.skippedStubs ?? []);
      } catch {
        if (alive) setError('Could not reach the backend to build the preview.');
      }
    })();
    // Tear the transient world down on close. Fire-and-forget — the
    // cleanup heartbeat is the backstop if this never lands.
    return () => {
      alive = false;
      endPreview(foundryWorldId).catch(() => {});
    };
  }, [foundryWorldId]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950"
      role="dialog"
      aria-label={`Live preview of ${worldName}`}
    >
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/90 px-3 py-2">
        <Eye className="h-4 w-4 text-sky-400" />
        <span className="flex-1 truncate text-sm font-medium text-slate-100">
          Live preview — {worldName}
        </span>
        {skippedStubs.length > 0 && (
          <span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
            {skippedStubs.length} system(s) not yet built — not shown
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          <X className="h-3.5 w-3.5" /> Close
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <AlertTriangle className="h-6 w-6 text-amber-400" />
            <p className="text-sm text-slate-300">{error}</p>
          </div>
        ) : !previewWorldId ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Compiling your world…
          </div>
        ) : (
          <ConcordiaScene districtId={previewWorldId} cameraMode="free" quality="medium" />
        )}
      </div>
    </div>
  );
}

export default FoundryPreview;

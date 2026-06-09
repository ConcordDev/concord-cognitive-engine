'use client';

// Phase DB8 — Hidden object scene viewer.
// Modal that listens for `concordia:open-hidden-object` events with
// { sceneId } payload. Renders the scene image; click coords are
// submitted to /api/hidden-object/find/:runId; found targets accumulate.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, X, CheckCircle2, Loader2 } from 'lucide-react';

interface Result {
  ok: boolean;
  found?: boolean;
  foundId?: string;
  label?: string;
  totalFound?: number;
  totalTargets?: number;
  complete?: boolean;
}

export function HiddenObjectScenePanel() {
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [sceneDtuId, setSceneDtuId] = useState<string | null>(null);
  const [title, setTitle] = useState('Hidden objects');
  const [progress, setProgress] = useState<{ found: number; total: number }>({ found: 0, total: 0 });
  const [lastResult, setLastResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const open = useCallback(async (id: string) => {
    setSceneId(id);
    setRunId(null);
    setLastResult(null);
    setProgress({ found: 0, total: 0 });
    try {
      const playRes = await fetch(`/api/hidden-object/play/${id}`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const playJ = await playRes.json();
      if (playJ?.ok) {
        setRunId(playJ.runId);
        if (playJ.scene?.scene_dtu_id) setSceneDtuId(playJ.scene.scene_dtu_id);
        if (playJ.scene?.title) setTitle(playJ.scene.title);
      }
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.sceneId) open(detail.sceneId);
    };
    window.addEventListener('concordia:open-hidden-object', handler);
    return () => window.removeEventListener('concordia:open-hidden-object', handler);
  }, [open]);

  const onClick = useCallback(async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!runId || pending) return;
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    // Normalize to [0,1] over the image's natural extent so target bboxes
    // (also normalized 0..1) match regardless of render size.
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPending(true);
    try {
      const r = await fetch(`/api/hidden-object/find/${runId}`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
      const j = await r.json();
      setLastResult(j);
      if (j?.ok && j.found) {
        setProgress({ found: j.totalFound || 0, total: j.totalTargets || 0 });
      }
    } finally { setPending(false); }
  }, [runId, pending]);

  const close = () => { setSceneId(null); setRunId(null); setSceneDtuId(null); setLastResult(null); };

  if (!sceneId) return null;

  return (
    <div className="concordia-hud-fade fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur" onClick={close}>
      <div className="w-full max-w-3xl rounded-xl border border-violet-500/40 bg-zinc-950/95 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="mb-3 flex items-center justify-between border-b border-violet-500/20 pb-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-violet-200">
              <Eye size={14} /> {title}
            </h2>
            {progress.total > 0 && (
              <div className="text-[10px] text-violet-300/70">
                {progress.found} / {progress.total} found
              </div>
            )}
          </div>
          <button aria-label="Close" onClick={close} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X size={14} /></button>
        </header>

        <div className="relative">
          {sceneId ? (
            // next/image is intentionally not used: this is a ref-driven game
            // scene whose click→object coordinate mapping depends on the raw
            // <img> element + its naturalWidth/Height, with a dynamic server URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={
                /* Phase E3 — authored scenes serve SVG via the dedicated
                   image route; legacy scenes still come through DTU artifact. */
                sceneDtuId?.startsWith('authored:')
                  ? `/api/hidden-object/scene/${sceneId}/image`
                  : sceneDtuId
                    ? `/api/dtus/${sceneDtuId}/artifact`
                    : `/api/hidden-object/scene/${sceneId}/image`
              }
              alt={title}
              className="block w-full cursor-crosshair rounded border border-violet-500/30"
              onClick={onClick}
              draggable={false}
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded border border-violet-500/30 bg-zinc-900">
              <Loader2 className="animate-spin text-violet-400" size={20} />
            </div>
          )}
          {pending && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Loader2 className="animate-spin text-violet-300" size={20} />
            </div>
          )}
        </div>

        {lastResult && (
          <div className="mt-2 text-xs">
            {lastResult.found && lastResult.label && (
              <div className="flex items-center gap-1 text-emerald-300">
                <CheckCircle2 size={12} /> Found: {lastResult.label}
              </div>
            )}
            {lastResult.ok && !lastResult.found && (
              <div className="text-zinc-400">Nothing there. Look more carefully.</div>
            )}
            {lastResult.complete && (
              <div className="mt-1 font-semibold text-amber-200">⭐ All targets found!</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

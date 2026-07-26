'use client';

/**
 * AnimationReferenceImages — real reference-image upload + gallery, with a
 * real rotoscope-style "Import onto frame" action.
 *
 * Replaces the old page's disconnected "Assets" tab, which uploaded to
 * `/api/media/upload` (real) but never listed anything back, rendered no
 * thumbnails, and had zero connection to the frame editor. That combination
 * — a working upload with no way to ever see what you uploaded — read as
 * broken, not honest.
 *
 * This panel: uploads real bytes via `/api/media/upload` (unchanged, tagged
 * `animation`+`reference`), then lists them back via the real
 * `GET /api/media/author/:userId` route and renders each image from
 * `GET /api/media/:id/stream`, which serves the actual stored bytes when an
 * artifactRef exists (verified in `server/routes/media.js` — distinct from
 * `/api/media/:id/thumbnail`, which returns a placeholder path string, not
 * real image bytes; using that endpoint here would have reproduced the same
 * "renders nothing real" defect this panel exists to fix).
 *
 * Import-onto-frame: `animation.frame-layer-import-image` (server/domains/
 * animation.js) attaches an already-uploaded reference image's real
 * `/api/media/:id/stream` URL to a frame as a semi-transparent tracing
 * underlay (a dedicated, non-paintable `type:'reference'` layer). It does
 * NOT vectorize/auto-trace the image into strokes — the animator still
 * draws the real artwork by hand on a separate paintable layer, on top of
 * the reference; that is the honest scope of "rotoscope reference" this
 * panel and the FlipaClip/Pencil2D-parity backlog item ever claimed. The
 * target frame comes from `animReferenceTarget.ts`, which `AnimStudio.tsx`
 * keeps pointed at whichever frame is currently open in the Studio tab
 * (Studio and Reference are separate tabs that unmount each other, so a
 * plain prop/callback can't cross that boundary).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImagePlus, Loader2, ImageOff, Layers, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState } from '@/components/ui';
import { getActiveFrameTarget, type ActiveFrameTarget } from './animReferenceTarget';

interface MediaItem {
  id: string;
  title: string;
  mediaType: string;
  tags: string[];
  createdAt: string;
}

/** Per-image import status, keyed by media id — so one item's failure never
 * gets mistaken for another's, and success is never assumed. */
type ImportStatus = { state: 'idle' } | { state: 'pending' } | { state: 'done' } | { state: 'error'; message: string };

export function AnimationReferenceImages() {
  const { user } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [target, setTarget] = useState<ActiveFrameTarget | null>(null);
  const [importStatus, setImportStatus] = useState<Record<string, ImportStatus>>({});

  // Read the studio's current frame target on mount and whenever it changes
  // (same-tab reactivity — currently unreachable since Studio unmounts
  // before Reference mounts, but a real listener costs nothing and keeps
  // this honest if the tabs are ever composed differently later).
  useEffect(() => {
    setTarget(getActiveFrameTarget());
    const handler = () => setTarget(getActiveFrameTarget());
    // Real dispatcher: animReferenceTarget.ts#setActiveFrameTarget fires this via
    // `new CustomEvent<ActiveFrameTarget>(ACTIVE_FRAME_EVENT, ...)`, a named-constant
    // indirection dead-event-listener-detector.js's literal-string regexes can't
    // trace. Confirmed live via runtime trace (DET-C continuation, 2026-07-24).
    // @dead-event-ok
    window.addEventListener('anim:active-frame', handler);
    window.addEventListener('focus', handler);
    return () => {
      window.removeEventListener('anim:active-frame', handler);
      window.removeEventListener('focus', handler);
    };
  }, []);

  const importOntoFrame = useCallback(async (item: MediaItem) => {
    if (!target) return;
    setImportStatus((prev) => ({ ...prev, [item.id]: { state: 'pending' } }));
    try {
      // lensRun() already unwraps the {ok,result} envelope(s) the HTTP route
      // and the domain handler each produce, so a rejection from
      // server/domains/animation.js's frame-layer-import-image (unknown
      // animId/frameId, invalid imageRef, layer limit reached) surfaces
      // here as a real r.data.ok === false — same contract every other
      // lensRun() caller in this codebase relies on.
      const r = await lensRun('animation', 'frame-layer-import-image', {
        animId: target.animId,
        frameId: target.frameId,
        imageRef: `/api/media/${item.id}/stream`,
        name: item.title,
      });
      if (r.data?.ok === false) {
        setImportStatus((prev) => ({ ...prev, [item.id]: { state: 'error', message: r.data.error || 'Import failed.' } }));
        return;
      }
      setImportStatus((prev) => ({ ...prev, [item.id]: { state: 'done' } }));
    } catch (e) {
      setImportStatus((prev) => ({
        ...prev,
        [item.id]: { state: 'error', message: e instanceof Error ? e.message : 'Import failed.' },
      }));
    }
  }, [target]);

  const refresh = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.get(`/api/media/author/${user.id}`, { params: { limit: 40 } });
      const all = (res.data?.media || []) as MediaItem[];
      setItems(all.filter((m) => m.mediaType === 'image' && (m.tags || []).includes('animation')));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reference images.');
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const arrayBuffer = await file.arrayBuffer();
      const base64Data = btoa(new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), ''));
      return api.post('/api/media/upload', {
        title: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        mediaType: 'image',
        mimeType: file.type || 'image/png',
        fileSize: file.size,
        originalFilename: file.name,
        tags: ['animation', 'reference'],
        data: base64Data,
      });
    },
    onSuccess: () => { void refresh(); },
    onError: (e: Error) => setError(e.message || 'Upload failed.'),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Reference images</h3>
          <p className="text-[11px] text-zinc-400">Upload photos or sketches, then import one onto the frame open in Studio as a tracing underlay — you still draw the real artwork by hand on top of it.</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); if (fileRef.current) fileRef.current.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending || !user?.id}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg shrink-0">
          {uploadMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          Upload reference
        </button>
      </div>

      {/* Honest target strip: shows exactly what "Import onto frame" will act
          on, or explains why the action is unavailable — never implies a
          target exists when it doesn't. */}
      {target ? (
        <p className="flex items-center gap-1.5 text-[11px] text-cyan-300 bg-cyan-950/30 border border-cyan-900/40 rounded-lg px-2.5 py-1.5">
          <Layers className="w-3.5 h-3.5 shrink-0" />
          Import target: <span className="font-medium text-cyan-100 truncate">{target.animTitle}</span>
          <span className="text-cyan-400/70">· frame {target.frameIndex + 1}/{target.frameCount}</span>
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 bg-zinc-900/40 border border-zinc-800 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Open a frame in the Studio tab first — import needs a real target frame.
        </p>
      )}

      {error && <p className="text-xs text-rose-400" role="alert">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ImageOff className="h-5 w-5" />}
          title="No reference images yet"
          description="Upload a photo or sketch to see it here — real stored bytes, not a placeholder."
          compact
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {items.map((m) => {
            const status = importStatus[m.id] || { state: 'idle' as const };
            return (
              <figure key={m.id} className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${m.id}/stream`} alt={m.title} className="w-full aspect-square object-cover" loading="lazy" />
                <figcaption className="px-1.5 py-1 text-[10px] text-zinc-400 truncate">{m.title}</figcaption>
                <button
                  type="button"
                  onClick={() => void importOntoFrame(m)}
                  disabled={!target || status.state === 'pending'}
                  title={target ? `Import onto frame ${target.frameIndex + 1} as a tracing reference` : 'Open a frame in Studio first'}
                  className="flex items-center justify-center gap-1 w-full px-1.5 py-1 text-[10px] border-t border-zinc-800 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-900 text-zinc-300"
                >
                  {status.state === 'pending' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : status.state === 'done' ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Layers className="w-3 h-3" />
                  )}
                  {status.state === 'done' ? 'Imported' : 'Import onto frame'}
                </button>
                {status.state === 'error' && (
                  <p role="alert" className="px-1.5 py-1 text-[9px] text-rose-400 bg-rose-950/40 truncate" title={status.message}>
                    {status.message}
                  </p>
                )}
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * AnimationReferenceImages — real reference-image upload + gallery.
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
 * Honest scope note: these are reference images to look at side-by-side
 * while drawing (the FlipaClip "rotoscope reference" idea) — there is no
 * `animation` macro to import a raster image directly onto a frame/layer as
 * paintable content, so this panel does not claim that capability. See the
 * capability map for the scoped-deferred item.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImagePlus, Loader2, ImageOff } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState } from '@/components/ui';

interface MediaItem {
  id: string;
  title: string;
  mediaType: string;
  tags: string[];
  createdAt: string;
}

export function AnimationReferenceImages() {
  const { user } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
          <p className="text-[11px] text-zinc-400">Upload photos or sketches to keep beside the canvas while you draw — view-only, not importable onto a frame yet.</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); if (fileRef.current) fileRef.current.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending || !user?.id}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg shrink-0">
          {uploadMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          Upload reference
        </button>
      </div>

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
          {items.map((m) => (
            <figure key={m.id} className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/media/${m.id}/stream`} alt={m.title} className="w-full aspect-square object-cover" loading="lazy" />
              <figcaption className="px-1.5 py-1 text-[10px] text-zinc-400 truncate">{m.title}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

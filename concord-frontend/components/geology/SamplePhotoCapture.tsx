'use client';

/**
 * SamplePhotoCapture — attach geotagged photos to a logged field
 * observation. Reads the JPEG EXIF block client-side to pull the real
 * GPS geotag, capture time and camera model, then persists via
 * geology.photo-attach. Wires photo-list / photo-delete. No seed data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, Trash2, Loader2, MapPin, ImageOff } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { readExifGeotag, fileToDataUrl } from './exif';

interface Observation { id: string; name: string; kind: string }
interface Photo {
  id: string; observationId: string; dataUrl: string; caption: string;
  exifLat: number | null; exifLon: number | null; exifAltitude: number | null;
  exifTakenAt: string | null; cameraModel: string | null; attachedAt: string;
}

export function SamplePhotoCapture() {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [target, setTarget] = useState('');
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [obsR, phR] = await Promise.all([
      lensRun('geology', 'observation-list', {}),
      lensRun('geology', 'photo-list', {}),
    ]);
    if (obsR.data?.ok) setObservations((obsR.data.result?.observations as Observation[]) || []);
    if (phR.data?.ok) setPhotos((phR.data.result?.photos as Photo[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!target) { setError('Choose an observation to attach the photo to first'); return; }
    setBusy(true); setError(null);
    try {
      const [exif, dataUrl] = await Promise.all([readExifGeotag(file), fileToDataUrl(file)]);
      const r = await lensRun('geology', 'photo-attach', {
        observationId: target,
        dataUrl,
        caption: caption.trim(),
        exifLat: exif.lat ?? undefined,
        exifLon: exif.lon ?? undefined,
        exifAltitude: exif.altitude ?? undefined,
        exifTakenAt: exif.takenAt ?? undefined,
        cameraModel: exif.cameraModel ?? undefined,
      });
      const inner = r.data?.result as { ok?: boolean; error?: string } | undefined;
      if (r.data?.ok && inner?.ok !== false) { setCaption(''); await refresh(); }
      else setError(inner?.error || r.data?.error || 'Could not attach photo');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo attach failed');
    } finally {
      setBusy(false);
    }
  }, [target, caption, refresh]);

  const del = useCallback(async (id: string) => {
    await lensRun('geology', 'photo-delete', { id });
    await refresh();
  }, [refresh]);

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Camera className="w-4 h-4 text-fuchsia-400" />
        <h3 className="text-sm font-bold text-zinc-100">Sample Photos &amp; Geotags</h3>
        <span className="text-[11px] text-zinc-400">EXIF GPS</span>
      </div>

      {observations.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">Log a field observation first, then attach photos to it.</p>
      ) : (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 space-y-1.5">
          <div className="flex gap-1.5">
            <select value={target} onChange={(e) => setTarget(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
              <option value="">Select observation…</option>
              {observations.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.kind})</option>)}
            </select>
          </div>
          <div className="flex gap-1.5">
            <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Photo caption (optional)"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input ref={fileRef} type="file" accept="image/jpeg,image/jpg" className="hidden"
              onChange={onFile} />
            <button onClick={() => fileRef.current?.click()} disabled={busy || !target}
              className="px-3 py-1 text-xs rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}Capture
            </button>
          </div>
          <p className="text-[10px] text-zinc-400">GPS coordinates are read from the photo&apos;s EXIF data and backfill the observation if it has none.</p>
        </div>
      )}

      {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}

      {photos.length === 0 ? (
        <p className="text-xs text-zinc-400 italic flex items-center gap-1"><ImageOff className="w-3 h-3" />No photos attached yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="group relative bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="relative w-full aspect-video bg-zinc-950">
                <Image src={p.dataUrl} alt={p.caption || 'rock sample photo'} fill unoptimized
                  className="object-cover" sizes="180px" />
              </div>
              <button onClick={() => del(p.id)} aria-label="Delete photo"
                className="absolute top-1 right-1 p-1 rounded bg-black/70 text-rose-400 opacity-0 group-hover:opacity-100">
                <Trash2 className="w-3 h-3" />
              </button>
              <div className="px-2 py-1">
                {p.caption && <p className="text-[11px] text-zinc-200 truncate">{p.caption}</p>}
                {p.exifLat != null && p.exifLon != null ? (
                  <p className="text-[10px] text-emerald-400 inline-flex items-center gap-0.5">
                    <MapPin className="w-2.5 h-2.5" />{p.exifLat.toFixed(4)}, {p.exifLon.toFixed(4)}
                  </p>
                ) : (
                  <p className="text-[10px] text-zinc-400">No EXIF geotag</p>
                )}
                {p.exifTakenAt && <p className="text-[10px] text-zinc-400">{p.exifTakenAt.replace('T', ' ')}</p>}
                {p.cameraModel && <p className="text-[10px] text-zinc-400 truncate">{p.cameraModel}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

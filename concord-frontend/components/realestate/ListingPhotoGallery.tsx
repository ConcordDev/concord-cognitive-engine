'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { Camera, Loader2, Plus, Trash2, Video, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Photo {
  id: string;
  url: string;
  caption: string;
  room: string;
  addedAt: string;
}

export function ListingPhotoGallery({ listingId }: { listingId?: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tourUrl, setTourUrl] = useState('');
  const [tourDraft, setTourDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ url: '', caption: '', room: '' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!listingId) { setPhotos([]); setTourUrl(''); return; }
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'realestate', action: 'listing-photos-list', input: { listingId } });
      if (r.data?.ok) {
        const ps = (r.data.result?.photos as Photo[]) || [];
        setPhotos(ps);
        setTourUrl(String(r.data.result?.virtualTourUrl || ''));
        setTourDraft(String(r.data.result?.virtualTourUrl || ''));
        setActiveIdx(0);
      }
    } catch (e) {
      console.error('[PhotoGallery] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addPhoto = async () => {
    if (!listingId || !form.url.trim()) return;
    setError(null);
    try {
      const r = await lensRun({
        domain: 'realestate', action: 'listing-photos-add',
        input: { listingId, url: form.url.trim(), caption: form.caption.trim(), room: form.room.trim() },
      });
      if (r.data?.ok) {
        setForm({ url: '', caption: '', room: '' });
        setAdding(false);
        await refresh();
      } else {
        setError(r.data?.error || 'Could not add photo.');
      }
    } catch (e) {
      console.error('[PhotoGallery] add failed', e);
      setError('Could not add photo.');
    }
  };

  const deletePhoto = async (photoId: string) => {
    if (!listingId) return;
    try {
      const r = await lensRun({ domain: 'realestate', action: 'listing-photos-delete', input: { listingId, photoId } });
      if (r.data?.ok) await refresh();
    } catch (e) {
      console.error('[PhotoGallery] delete failed', e);
    }
  };

  const saveTour = async () => {
    if (!listingId) return;
    setError(null);
    try {
      const r = await lensRun({ domain: 'realestate', action: 'listing-tour-set', input: { listingId, virtualTourUrl: tourDraft.trim() } });
      if (r.data?.ok) {
        setTourUrl(String(r.data.result?.virtualTourUrl || ''));
      } else {
        setError(r.data?.error || 'Could not save tour link.');
      }
    } catch (e) {
      console.error('[PhotoGallery] tour set failed', e);
      setError('Could not save tour link.');
    }
  };

  if (!listingId) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg p-8 text-center text-xs text-gray-400">
        <Camera className="w-6 h-6 mx-auto mb-2 opacity-30" />
        Select a listing to manage its photo gallery and 3D tour.
      </div>
    );
  }

  const active = photos[activeIdx];

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Camera className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Photos & 3D tour</span>
        <span className="ml-auto text-[10px] text-gray-400">{photos.length} photo{photos.length === 1 ? '' : 's'}</span>
        <button onClick={() => setAdding((v) => !v)} className="p-1 text-gray-400 hover:text-white" title="Add photo"><Plus className="w-4 h-4" /></button>
      </header>

      {adding && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2 text-xs">
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Image URL (https:// or data:image)" className="col-span-3 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="Room" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} placeholder="Caption" className="col-span-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={addPhoto} className="px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="p-3 space-y-3">
          {photos.length === 0 ? (
            <div className="py-8 text-center text-xs text-gray-400">No photos yet. Hit + to add a photo URL.</div>
          ) : (
            <>
              <div className="relative aspect-video bg-black/40 rounded overflow-hidden">
                <Image src={active.url} alt={active.caption || active.room || 'Listing photo'} fill unoptimized className="object-contain" />
                {photos.length > 1 && (
                  <>
                    <button aria-label="Previous" onClick={() => setActiveIdx((i) => (i - 1 + photos.length) % photos.length)} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"><ChevronLeft className="w-4 h-4" /></button>
                    <button aria-label="Next" onClick={() => setActiveIdx((i) => (i + 1) % photos.length)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"><ChevronRight className="w-4 h-4" /></button>
                  </>
                )}
                {(active.caption || active.room) && (
                  <div className="absolute bottom-0 inset-x-0 px-3 py-1.5 bg-gradient-to-t from-black/80 to-transparent text-[11px] text-white">
                    {active.room && <span className="font-semibold uppercase tracking-wider mr-2">{active.room}</span>}
                    {active.caption}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {photos.map((p, i) => (
                  <div key={p.id} className="relative flex-shrink-0 group">
                    <button aria-label={`View photo ${i + 1}`} onClick={() => setActiveIdx(i)} className={cn('w-16 h-12 rounded overflow-hidden border', i === activeIdx ? 'border-cyan-400' : 'border-white/10')}>
                      <Image src={p.url} alt={p.room || 'thumb'} width={64} height={48} unoptimized className="object-cover w-full h-full" />
                    </button>
                    <button onClick={() => deletePhoto(p.id)} className="absolute -top-1 -right-1 p-0.5 rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100" aria-label="Delete photo"><Trash2 className="w-2.5 h-2.5" /></button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-white/10 pt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Video className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-gray-400 uppercase tracking-wider text-[10px]">Virtual / 3D tour</span>
              {tourUrl && (
                <a href={tourUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-cyan-300 hover:underline">
                  Open tour <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="flex gap-2">
              <input value={tourDraft} onChange={(e) => setTourDraft(e.target.value)} placeholder="https://my3dtour.com/..." className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <button onClick={saveTour} className="px-3 py-1.5 text-xs rounded bg-white/5 text-gray-200 border border-white/10 hover:border-cyan-500/40">Save</button>
            </div>
          </div>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default ListingPhotoGallery;

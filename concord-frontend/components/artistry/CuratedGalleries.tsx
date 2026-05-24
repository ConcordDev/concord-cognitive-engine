/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Star, Plus, X, Loader2, ImageIcon, ChevronLeft, Eye, Heart, LayoutGrid,
} from 'lucide-react';

interface Gallery {
  id: string; curatorId: string; title: string; theme: string; description: string;
  projectIds: string[]; projectCount: number; featured: boolean; createdAt: string;
}
interface GalleryProject {
  id: string; userId: string; title: string; discipline: string;
  coverUrl: string; images: { url: string }[]; views: number; appreciations: number;
}
interface OwnProject { id: string; title: string }

export function CuratedGalleries() {
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [galleryDetail, setGalleryDetail] = useState<{ gallery: Gallery; items: GalleryProject[] } | null>(null);
  const [ownProjects, setOwnProjects] = useState<OwnProject[]>([]);

  // Create form
  const [gTitle, setGTitle] = useState('');
  const [gTheme, setGTheme] = useState('');
  const [gDesc, setGDesc] = useState('');
  const [gFeatured, setGFeatured] = useState(false);
  const [gPicked, setGPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [g, p] = await Promise.all([
      lensRun('artistry', 'galleryList', {}),
      lensRun('artistry', 'projectList', {}),
    ]);
    setGalleries((g.data?.result?.galleries as Gallery[]) || []);
    setOwnProjects(((p.data?.result?.projects as OwnProject[]) || []).map((x) => ({ id: x.id, title: x.title })));
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const openGallery = useCallback(async (id: string) => {
    setOpenId(id);
    setGalleryDetail(null);
    const r = await lensRun('artistry', 'galleryItems', { galleryId: id });
    if (r.data?.ok) {
      setGalleryDetail({
        gallery: r.data.result.gallery as Gallery,
        items: (r.data.result.items as GalleryProject[]) || [],
      });
    }
  }, []);

  const togglePick = useCallback((id: string) => {
    setGPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const create = useCallback(async () => {
    if (!gTitle.trim()) return;
    setSaving(true);
    const r = await lensRun('artistry', 'galleryCreate', {
      title: gTitle, theme: gTheme || 'Featured', description: gDesc,
      featured: gFeatured, projectIds: Array.from(gPicked),
    });
    setSaving(false);
    if (r.data?.ok) {
      setShowCreate(false);
      setGTitle(''); setGTheme(''); setGDesc(''); setGFeatured(false); setGPicked(new Set());
      load();
    }
  }, [gTitle, gTheme, gDesc, gFeatured, gPicked, load]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>;
  }

  // Gallery detail
  if (openId && galleryDetail) {
    const { gallery, items } = galleryDetail;
    return (
      <div className="space-y-4">
        <button onClick={() => { setOpenId(null); setGalleryDetail(null); }} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to galleries
        </button>
        <div>
          <div className="flex items-center gap-2">
            {gallery.featured && <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />}
            <h2 className="text-lg font-bold">{gallery.title}</h2>
            <span className="text-[11px] px-2 py-0.5 bg-neon-pink/10 border border-neon-pink/20 rounded-full text-neon-pink">{gallery.theme}</span>
          </div>
          {gallery.description && <p className="text-sm text-gray-400 mt-1">{gallery.description}</p>}
        </div>
        {items.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">This gallery has no published projects yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((p) => (
              <div key={p.id} className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                  {(p.coverUrl || p.images?.[0]?.url)
                    ? <img src={p.coverUrl || p.images[0].url} alt={p.title} className="w-full h-full object-cover" />
                    : <ImageIcon className="w-7 h-7 text-gray-600" />}
                </div>
                <div className="p-3">
                  <h3 className="font-medium text-sm truncate">{p.title}</h3>
                  <div className="text-[11px] text-gray-500">by {p.userId} · {p.discipline}</div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.views}</span>
                    <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{p.appreciations}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Gallery list
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <LayoutGrid className="w-5 h-5 text-neon-pink" /> Curated Galleries
        </h2>
        <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-xs bg-neon-pink/20 border border-neon-pink/30 rounded-lg hover:bg-neon-pink/30 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Curate Gallery
        </button>
      </div>

      {galleries.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">No curated galleries yet. Build a themed showcase.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {galleries.map((g) => (
            <button key={g.id} onClick={() => openGallery(g.id)} className="bg-white/5 border border-white/10 rounded-lg p-4 text-left hover:border-neon-pink/30 transition-colors">
              <div className="flex items-center gap-2">
                {g.featured && <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />}
                <h3 className="font-medium text-sm truncate flex-1">{g.title}</h3>
              </div>
              <div className="text-[11px] text-neon-pink mt-1">{g.theme}</div>
              {g.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{g.description}</p>}
              <div className="text-[11px] text-gray-500 mt-2">{g.projectCount} project{g.projectCount === 1 ? '' : 's'}</div>
            </button>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Curate a Gallery</h3>
              <button onClick={() => setShowCreate(false)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <input value={gTitle} onChange={(e) => setGTitle(e.target.value)} placeholder="Gallery title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <input value={gTheme} onChange={(e) => setGTheme(e.target.value)} placeholder="Theme (e.g. Best of Concept Art)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <textarea value={gDesc} onChange={(e) => setGDesc(e.target.value)} placeholder="Description" rows={2} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={gFeatured} onChange={(e) => setGFeatured(e.target.checked)} /> Feature this gallery
              </label>
              {ownProjects.length > 0 && (
                <div>
                  <h4 className="text-[11px] text-gray-400 mb-1.5">Add your projects to this gallery</h4>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {ownProjects.map((op) => (
                      <button
                        key={op.id}
                        onClick={() => togglePick(op.id)}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                          gPicked.has(op.id)
                            ? 'bg-neon-pink/20 border-neon-pink/30 text-neon-pink'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:border-neon-pink/30'
                        }`}
                      >
                        {op.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={create} disabled={saving || !gTitle.trim()} className="w-full py-2 bg-neon-pink/20 rounded-lg text-sm hover:bg-neon-pink/30 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Gallery'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

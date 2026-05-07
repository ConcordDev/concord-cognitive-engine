'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, Search, Upload, Grid, Image as ImageIcon,
  Heart, Eye, X,
  Aperture, Sliders, BarChart3,
  Layers, ChevronLeft, ChevronRight, Focus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';

type PhotoTab = 'gallery' | 'upload' | 'collections' | 'editing' | 'stats';

interface PhotoItem {
  id: string;
  title: string;
  description: string;
  tags: string[];
  camera?: string;
  lens?: string;
  iso?: number;
  aperture?: string;
  shutter?: string;
  focalLength?: string;
  location?: string;
  mediaId?: string;
  likes: number;
  views: number;
  favorited?: boolean;
  createdAt: string;
}

const PHOTO_CATEGORIES = ['Landscape', 'Portrait', 'Street', 'Architecture', 'Nature', 'Macro', 'Astrophotography', 'Abstract', 'Documentary', 'Fashion'];

/** Masonry-style aspect ratios assigned deterministically by item index */
const MASONRY_RATIOS = ['3/4', '4/3', '1/1', '3/4', '4/5', '16/9', '1/1', '4/3', '3/2', '4/5'] as const;

export default function PhotographyPage() {
  useLensNav('photography');
  const queryClient = useQueryClient();
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('photography');
  const { contextDTUs, isLoading: dtusLoading } = useLensDTUs({ lens: 'photography' });

  const { items: photoItems, isLoading, isError, error, refetch, create: createPhoto, update: updatePhoto } = useLensData<PhotoItem>('photography', 'photo', { seed: [] });
  const photos = useMemo(() => photoItems.map(i => ({ ...(i.data as unknown as PhotoItem), id: i.id, title: i.title })), [photoItems]);

  const [tab, setTab] = useState<PhotoTab>('gallery');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Upload form
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadCamera, setUploadCamera] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Favorite toggle — optimistic local state + persist via update
  const toggleFavorite = useCallback((photoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = new Set(prev);
      const nowFav = !next.has(photoId);
      if (nowFav) next.add(photoId); else next.delete(photoId);
      // Persist to backend
      const item = photoItems.find(i => i.id === photoId);
      if (item) {
        updatePhoto(photoId, { data: { ...(item.data as Partial<PhotoItem>), favorited: nowFav } });
      }
      return next;
    });
  }, [photoItems, updatePhoto]);

  // Seed favorites from persisted data on load
  useEffect(() => {
    const favSet = new Set<string>();
    photoItems.forEach(i => {
      if ((i.data as unknown as PhotoItem)?.favorited) favSet.add(i.id);
    });
    if (favSet.size > 0) setFavorites(favSet);
  }, [photoItems]);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
    if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
  }, [uploadTitle]);

  // Upload via media API
  const uploadMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      let base64Data: string | undefined;
      if (uploadFile) {
        const arrayBuffer = await uploadFile.arrayBuffer();
        base64Data = btoa(new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), ''));
      }
      const mediaResp = await api.post('/api/media/upload', {
        title: data.title,
        mediaType: 'image',
        mimeType: uploadFile?.type || 'image/jpeg',
        fileSize: uploadFile?.size || 0,
        originalFilename: uploadFile?.name,
        tags: data.tags,
        description: data.description,
        ...(base64Data ? { data: base64Data } : {}),
      });
      // Also store as lens artifact
      await createPhoto({
        title: data.title as string,
        data: { ...data, mediaId: mediaResp.data?.mediaDTU?.id || mediaResp.data?.id, createdAt: new Date().toISOString(), likes: 0, views: 0 },
      });
      return mediaResp.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lens', 'photography'] });
      setShowUpload(false);
      setUploadTitle('');
      setUploadDesc('');
      setUploadTags('');
      setUploadFile(null);
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadPreview(null);
      refetch();
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const handleUpload = useCallback(() => {
    uploadMutation.mutate({
      title: uploadTitle || 'Untitled Photo',
      description: uploadDesc,
      tags: uploadTags.split(',').map(t => t.trim()).filter(Boolean),
      camera: uploadCamera,
    });
  }, [uploadTitle, uploadDesc, uploadTags, uploadCamera, uploadMutation]);

  const filteredPhotos = useMemo(() => {
    let result = photos;
    if (categoryFilter) result = result.filter(p => p.tags?.includes(categoryFilter.toLowerCase()));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.title?.toLowerCase().includes(q) || p.tags?.some(t => t.toLowerCase().includes(q)));
    }
    return result;
  }, [photos, categoryFilter, searchQuery]);

  // Lightbox navigation helpers
  const lightboxPhoto = lightboxIndex !== null ? filteredPhotos[lightboxIndex] : null;
  const openLightbox = useCallback((index: number) => setLightboxIndex(index), []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const prevPhoto = useCallback(() => {
    setLightboxIndex(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);
  const nextPhoto = useCallback(() => {
    setLightboxIndex(prev => (prev !== null && prev < filteredPhotos.length - 1 ? prev + 1 : prev));
  }, [filteredPhotos.length]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') prevPhoto();
      else if (e.key === 'ArrowRight') nextPhoto();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIndex, closeLightbox, prevPhoto, nextPhoto]);

  const TABS: { id: PhotoTab; label: string; icon: typeof Camera }[] = [
    { id: 'gallery', label: 'Gallery', icon: Grid },
    { id: 'upload', label: 'Upload', icon: Upload },
    { id: 'collections', label: 'Collections', icon: Layers },
    { id: 'editing', label: 'Editing', icon: Sliders },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
  ];

  return (
    <div data-lens-theme="photography" className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Camera className="w-6 h-6 text-sky-400" />
            <h1 className="text-2xl font-bold">Photography</h1>
            {(isLoading || dtusLoading) && (
              <div className="flex items-center gap-1.5 text-xs text-sky-400">
                <div className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          </div>
          <div className="flex items-center gap-2">
            <DTUExportButton domain="photography" data={{}} compact />
            <button onClick={() => setShowFeatures(!showFeatures)} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Features</button>
            <button onClick={() => setShowUpload(true)} className="px-3 py-1.5 text-xs bg-sky-500/20 border border-sky-500/30 rounded-lg hover:bg-sky-500/30 flex items-center gap-1">
              <Upload className="w-3 h-3" /> Upload
            </button>
          </div>
        </div>

        {showFeatures && <LensFeaturePanel lensId="photography" />}
        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />
      <UniversalActions domain="photography" artifactId={null} compact />

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', tab === t.id ? 'bg-sky-500/20 text-sky-400' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {/* Stat Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Camera, label: 'Photos', value: photos.length, color: 'text-sky-400', bg: 'bg-sky-500/10' },
            { icon: Heart, label: 'Favorites', value: favorites.size, color: 'text-rose-400', bg: 'bg-rose-500/10' },
            { icon: Layers, label: 'Collections', value: new Set(photos.flatMap(p => p.tags || [])).size, color: 'text-violet-400', bg: 'bg-violet-500/10' },
            { icon: Eye, label: 'Total Views', value: photos.reduce((s, p) => s + (p.views || 0), 0).toLocaleString(), color: 'text-amber-400', bg: 'bg-amber-500/10' },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`${s.bg} border border-white/5 rounded-xl p-3 flex items-center gap-3`}
            >
              <s.icon className={`w-5 h-5 ${s.color}`} />
              <div>
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {isError && <ErrorState error={error?.message} onRetry={refetch} />}

        {/* Gallery */}
        {tab === 'gallery' && (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search photos..." className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-sky-500/50" />
              </div>
              <div className="flex gap-1 flex-wrap">
                <button onClick={() => setCategoryFilter(null)} className={cn('text-[10px] px-2 py-1 rounded', !categoryFilter ? 'bg-sky-500/20 text-sky-400' : 'text-gray-400 hover:text-white')}>All</button>
                {PHOTO_CATEGORIES.slice(0, 6).map(cat => (
                  <button key={cat} onClick={() => setCategoryFilter(cat)} className={cn('text-[10px] px-2 py-1 rounded', categoryFilter === cat ? 'bg-sky-500/20 text-sky-400' : 'text-gray-400 hover:text-white')}>{cat}</button>
                ))}
              </div>
            </div>
            {filteredPhotos.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Camera className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No photos yet. Upload your first shot.</p>
                <button onClick={() => setShowUpload(true)} className="mt-3 px-4 py-2 text-xs bg-sky-500/20 rounded-lg hover:bg-sky-500/30">Upload Photo</button>
              </div>
            ) : (
              <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [column-fill:_balance]">
                {filteredPhotos.map((photo, idx) => (
                  <motion.div
                    key={photo.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="mb-3 break-inside-avoid bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-sky-500/30 transition-colors group cursor-pointer relative"
                    onClick={() => openLightbox(idx)}
                  >
                    {/* Masonry image placeholder with varied aspect ratio */}
                    <div
                      className="bg-gradient-to-br from-sky-900/30 to-purple-900/30 flex items-center justify-center relative"
                      style={{ aspectRatio: MASONRY_RATIOS[idx % MASONRY_RATIOS.length] }}
                    >
                      {photo.mediaId ? (
                        <img
                          src={`/api/media/stream/${photo.mediaId}`}
                          alt={photo.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-gray-600" />
                      )}
                      {/* Favorite heart overlay */}
                      <button
                        onClick={(e) => toggleFavorite(photo.id, e)}
                        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                      >
                        <Heart
                          className={cn('w-3.5 h-3.5 transition-colors', favorites.has(photo.id) ? 'fill-rose-500 text-rose-500' : 'text-white/70')}
                        />
                      </button>
                    </div>
                    <div className="p-3">
                      <h3 className="text-xs font-medium truncate">{photo.title}</h3>
                      {/* EXIF-like badges */}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {photo.iso && (
                          <span className="px-1.5 py-0.5 text-[9px] bg-sky-500/10 text-sky-400 rounded border border-sky-500/20 font-mono">ISO {photo.iso}</span>
                        )}
                        {photo.aperture && (
                          <span className="px-1.5 py-0.5 text-[9px] bg-violet-500/10 text-violet-400 rounded border border-violet-500/20 font-mono">f/{photo.aperture}</span>
                        )}
                        {photo.shutter && (
                          <span className="px-1.5 py-0.5 text-[9px] bg-amber-500/10 text-amber-400 rounded border border-amber-500/20 font-mono">{photo.shutter}</span>
                        )}
                        {photo.focalLength && (
                          <span className="px-1.5 py-0.5 text-[9px] bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20 font-mono">{photo.focalLength}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                        {photo.camera && <span className="flex items-center gap-0.5"><Aperture className="w-2.5 h-2.5" />{photo.camera}</span>}
                        <span className="flex items-center gap-0.5"><Eye className="w-2.5 h-2.5" />{photo.views || 0}</span>
                        <span className="flex items-center gap-0.5"><Heart className="w-2.5 h-2.5" />{photo.likes || 0}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upload tab */}
        {tab === 'upload' && (
          <div className="max-w-md mx-auto bg-white/5 border border-white/10 rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Upload className="w-5 h-5 text-sky-400" /> Upload Photo</h2>
            <div
              className="border-2 border-dashed border-white/10 rounded-lg p-8 text-center cursor-pointer hover:border-sky-500/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
            >
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
              {uploadPreview ? (
                <img src={uploadPreview} alt="Preview" className="max-h-48 mx-auto rounded-lg mb-2" />
              ) : (
                <Camera className="w-8 h-8 mx-auto mb-2 text-gray-500" />
              )}
              <p className="text-xs text-gray-500">{uploadFile ? uploadFile.name : 'Drag & drop or click to upload'}</p>
            </div>
            <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="Photo title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
            <textarea value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} placeholder="Description" rows={2} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm resize-none" />
            <input value={uploadCamera} onChange={e => setUploadCamera(e.target.value)} placeholder="Camera / lens info" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
            <input value={uploadTags} onChange={e => setUploadTags(e.target.value)} placeholder="Tags (comma separated)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
            <button onClick={handleUpload} disabled={uploadMutation.isPending} className="w-full py-2 bg-sky-500/20 border border-sky-500/30 rounded-lg text-sm hover:bg-sky-500/30 disabled:opacity-50">
              {uploadMutation.isPending ? 'Uploading...' : 'Upload Photo'}
            </button>
          </div>
        )}

        {/* Collections */}
        {tab === 'collections' && (
          <div className="text-center py-16 text-gray-500">
            <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-2">Photo Collections</p>
            <p className="text-xs text-gray-600">Organize your photos into themed collections and albums.</p>
            <div className="mt-4 text-xs text-gray-600">{photos.length} photos in library</div>
          </div>
        )}

        {/* Editing */}
        {tab === 'editing' && (
          <div className="text-center py-16 text-gray-500">
            <Sliders className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-2">Photo Editing</p>
            <p className="text-xs text-gray-600">Exposure, contrast, color grading, and LUT presets.</p>
            <VisionAnalyzeButton domain="photography" onResult={() => {}} />
          </div>
        )}

        {/* Stats */}
        {tab === 'stats' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Total Photos</div>
              <div className="text-2xl font-bold">{photos.length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Photo DTUs</div>
              <div className="text-2xl font-bold">{contextDTUs.length}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Categories</div>
              <div className="text-2xl font-bold">{new Set(photos.flatMap(p => p.tags || [])).size}</div>
            </div>
          </div>
        )}

        {/* Lightbox modal */}
        <AnimatePresence>
          {lightboxPhoto && lightboxIndex !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md"
              onClick={closeLightbox}
            >
              {/* Close button */}
              <button
                onClick={closeLightbox}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>

              {/* Left arrow */}
              {lightboxIndex > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); prevPhoto(); }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <ChevronLeft className="w-6 h-6 text-white" />
                </button>
              )}

              {/* Right arrow */}
              {lightboxIndex < filteredPhotos.length - 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); nextPhoto(); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <ChevronRight className="w-6 h-6 text-white" />
                </button>
              )}

              {/* Image + EXIF panel */}
              <motion.div
                key={lightboxPhoto.id}
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="flex flex-col lg:flex-row items-center gap-6 max-w-5xl w-full mx-4 max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Photo display */}
                <div className="flex-1 flex items-center justify-center min-h-0 max-h-[70vh] lg:max-h-[80vh]">
                  {lightboxPhoto.mediaId ? (
                    <img
                      src={`/api/media/stream/${lightboxPhoto.mediaId}`}
                      alt={lightboxPhoto.title}
                      className="max-w-full max-h-[70vh] lg:max-h-[80vh] object-contain rounded-lg shadow-2xl"
                    />
                  ) : (
                    <div className="w-full aspect-[4/3] max-w-lg bg-gradient-to-br from-sky-900/40 to-purple-900/40 rounded-lg flex items-center justify-center shadow-2xl">
                      <ImageIcon className="w-16 h-16 text-gray-600" />
                    </div>
                  )}
                </div>

                {/* EXIF / info panel */}
                <div className="lg:w-72 w-full bg-white/5 border border-white/10 rounded-lg p-5 backdrop-blur-sm flex-shrink-0">
                  <h3 className="text-sm font-semibold mb-1 truncate">{lightboxPhoto.title}</h3>
                  {lightboxPhoto.description && (
                    <p className="text-xs text-gray-400 mb-4 line-clamp-3">{lightboxPhoto.description}</p>
                  )}

                  {/* EXIF metadata grid */}
                  {(lightboxPhoto.camera || lightboxPhoto.lens || lightboxPhoto.iso || lightboxPhoto.aperture || lightboxPhoto.shutter || lightboxPhoto.focalLength) && (
                    <div className="mb-4">
                      <h4 className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1">
                        <Focus className="w-3 h-3" /> EXIF Data
                      </h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        {lightboxPhoto.camera && (
                          <>
                            <span className="text-gray-500">Camera</span>
                            <span className="text-gray-300 truncate">{lightboxPhoto.camera}</span>
                          </>
                        )}
                        {lightboxPhoto.lens && (
                          <>
                            <span className="text-gray-500">Lens</span>
                            <span className="text-gray-300 truncate">{lightboxPhoto.lens}</span>
                          </>
                        )}
                        {lightboxPhoto.iso && (
                          <>
                            <span className="text-gray-500">ISO</span>
                            <span className="text-gray-300">{lightboxPhoto.iso}</span>
                          </>
                        )}
                        {lightboxPhoto.aperture && (
                          <>
                            <span className="text-gray-500">Aperture</span>
                            <span className="text-gray-300">f/{lightboxPhoto.aperture}</span>
                          </>
                        )}
                        {lightboxPhoto.shutter && (
                          <>
                            <span className="text-gray-500">Shutter</span>
                            <span className="text-gray-300">{lightboxPhoto.shutter}</span>
                          </>
                        )}
                        {lightboxPhoto.focalLength && (
                          <>
                            <span className="text-gray-500">Focal Length</span>
                            <span className="text-gray-300">{lightboxPhoto.focalLength}</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {lightboxPhoto.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {lightboxPhoto.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 text-[10px] bg-sky-500/10 text-sky-400 rounded-full border border-sky-500/20">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Stats + favorite */}
                  <div className="flex items-center gap-3 text-xs text-gray-500 pt-3 border-t border-white/10">
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{lightboxPhoto.views || 0}</span>
                    <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{lightboxPhoto.likes || 0}</span>
                    <button
                      onClick={(e) => toggleFavorite(lightboxPhoto.id, e)}
                      className="ml-auto flex items-center gap-1 hover:text-rose-400 transition-colors"
                    >
                      <Heart className={cn('w-3.5 h-3.5', favorites.has(lightboxPhoto.id) ? 'fill-rose-500 text-rose-500' : '')} />
                      <span className="text-[10px]">{favorites.has(lightboxPhoto.id) ? 'Favorited' : 'Favorite'}</span>
                    </button>
                  </div>

                  {/* Counter */}
                  <div className="text-center text-[10px] text-gray-600 mt-3">
                    {lightboxIndex + 1} / {filteredPhotos.length}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Upload modal */}
        <AnimatePresence>
          {showUpload && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowUpload(false)}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">Quick Upload</h3>
                  <button onClick={() => setShowUpload(false)}><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="Photo title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <input value={uploadTags} onChange={e => setUploadTags(e.target.value)} placeholder="Tags (comma separated)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <button onClick={handleUpload} disabled={uploadMutation.isPending} className="w-full py-2 bg-sky-500/20 rounded-lg text-sm hover:bg-sky-500/30 disabled:opacity-50">
                    {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

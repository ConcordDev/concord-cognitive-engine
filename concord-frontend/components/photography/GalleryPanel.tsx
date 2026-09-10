'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, Search, Image as ImageIcon, Heart, Eye, X, Download,
  Aperture, Sliders, ChevronLeft, ChevronRight, Focus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { PHOTO_CATEGORIES, MASONRY_RATIOS, type PhotoItem } from './photo-types';

/**
 * Media gallery + lightbox editor — extracted from photography page.tsx.
 * Owns useLensData create/update/favorite for the shared workbench gallery
 * (distinct from the Lightroom catalog macros).
 */
export function GalleryPanel({
  searchInputRef,
  onRequestUpload,
}: {
  searchInputRef?: React.RefObject<HTMLInputElement>;
  onRequestUpload?: () => void;
}) {
  const {
    items: photoItems,
    isLoading,
    isError,
    error,
    refetch,
    update: updatePhoto,
  } = useLensData<PhotoItem>('photography', 'photo', { seed: [] });

  const photos = useMemo(
    () => photoItems.map((i) => ({ ...(i.data as unknown as PhotoItem), id: i.id, title: i.title })),
    [photoItems],
  );

  const localSearchRef = useRef<HTMLInputElement>(null);
  const inputRef = searchInputRef ?? localSearchRef;

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const [editMode, setEditMode] = useState(false);
  const [filterBrightness, setFilterBrightness] = useState(100);
  const [filterContrast, setFilterContrast] = useState(100);
  const [filterSaturate, setFilterSaturate] = useState(100);
  const [filterBlur, setFilterBlur] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editImgRef = useRef<HTMLImageElement | null>(null);

  const resetFilters = useCallback(() => {
    setFilterBrightness(100);
    setFilterContrast(100);
    setFilterSaturate(100);
    setFilterBlur(0);
  }, []);

  const toggleFavorite = useCallback(
    (photoId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setFavorites((prev) => {
        const next = new Set(prev);
        const nowFav = !next.has(photoId);
        if (nowFav) next.add(photoId);
        else next.delete(photoId);
        const item = photoItems.find((i) => i.id === photoId);
        if (item) {
          updatePhoto(photoId, {
            data: { ...(item.data as Partial<PhotoItem>), favorited: nowFav },
          });
        }
        return next;
      });
    },
    [photoItems, updatePhoto],
  );

  useEffect(() => {
    const favSet = new Set<string>();
    photoItems.forEach((i) => {
      if ((i.data as unknown as PhotoItem)?.favorited) favSet.add(i.id);
    });
    if (favSet.size > 0) setFavorites(favSet);
  }, [photoItems]);

  const filteredPhotos = useMemo(() => {
    let result = photos;
    if (categoryFilter)
      result = result.filter((p) => p.tags?.includes(categoryFilter.toLowerCase()));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.title?.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [photos, categoryFilter, searchQuery]);

  const lightboxPhoto = lightboxIndex !== null ? filteredPhotos[lightboxIndex] : null;
  const openLightbox = useCallback((index: number) => setLightboxIndex(index), []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const prevPhoto = useCallback(() => {
    setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);
  const nextPhoto = useCallback(() => {
    setLightboxIndex((prev) =>
      prev !== null && prev < filteredPhotos.length - 1 ? prev + 1 : prev,
    );
  }, [filteredPhotos.length]);

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

  const cssFilterString = useMemo(
    () =>
      `brightness(${filterBrightness}%) contrast(${filterContrast}%) saturate(${filterSaturate}%) blur(${filterBlur}px)`,
    [filterBrightness, filterContrast, filterSaturate, filterBlur],
  );

  useEffect(() => {
    if (!editMode || !lightboxPhoto?.mediaId) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = `/api/media/${lightboxPhoto.mediaId}/stream`;
    img.onload = () => {
      editImgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.filter = cssFilterString;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, lightboxPhoto?.mediaId]);

  useEffect(() => {
    if (!editMode) return;
    const canvas = canvasRef.current;
    const img = editImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.filter = cssFilterString;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  }, [editMode, cssFilterString]);

  const handleDownloadEdited = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${lightboxPhoto?.title ?? 'edited-photo'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [lightboxPhoto?.title]);

  return (
    <div className="space-y-4">
      {/* Stat cards for media gallery */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: Camera, label: 'Photos', value: photos.length, color: 'text-sky-400', bg: 'bg-sky-500/10' },
          { icon: Heart, label: 'Favorites', value: favorites.size, color: 'text-rose-400', bg: 'bg-rose-500/10' },
          {
            icon: Aperture,
            label: 'Collections',
            value: new Set(photos.flatMap((p) => p.tags || [])).size,
            color: 'text-violet-400',
            bg: 'bg-violet-500/10',
          },
          {
            icon: Eye,
            label: 'Total Views',
            value: photos.reduce((s, p) => s + (p.views || 0), 0).toLocaleString(),
            color: 'text-amber-400',
            bg: 'bg-amber-500/10',
          },
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
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">{s.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {isLoading && (
        <div role="status" aria-busy="true" className="flex items-center gap-1.5 text-xs text-sky-400">
          <div className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          Loading photography…
        </div>
      )}

      {isError && (
        <div role="alert">
          <ErrorState error={error?.message} onRetry={refetch} />
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search photos..."
            className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-sky-500/50"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setCategoryFilter(null)}
            className={cn(
              'text-[10px] px-2 py-1 rounded',
              !categoryFilter ? 'bg-sky-500/20 text-sky-400' : 'text-gray-400 hover:text-white',
            )}
          >
            All
          </button>
          {PHOTO_CATEGORIES.slice(0, 6).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'text-[10px] px-2 py-1 rounded',
                categoryFilter === cat ? 'bg-sky-500/20 text-sky-400' : 'text-gray-400 hover:text-white',
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filteredPhotos.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Camera className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No photos yet. Upload your first shot.</p>
          <button
            onClick={onRequestUpload}
            className="mt-3 px-4 py-2 text-xs bg-sky-500/20 rounded-lg hover:bg-sky-500/30"
          >
            Upload Photo
          </button>
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
              <div
                className="bg-gradient-to-br from-sky-900/30 to-purple-900/30 flex items-center justify-center relative"
                style={{ aspectRatio: MASONRY_RATIOS[idx % MASONRY_RATIOS.length] }}
              >
                {photo.mediaId ? (
                  <Image
                    src={`/api/media/${photo.mediaId}/stream`}
                    alt={photo.title}
                    fill
                    className="object-cover"
                    loading="lazy"
                  />
                ) : (
                  <ImageIcon className="w-8 h-8 text-gray-600" />
                )}
                <button
                  onClick={(e) => toggleFavorite(photo.id, e)}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                  aria-label="Like"
                >
                  <Heart
                    className={cn(
                      'w-3.5 h-3.5 transition-colors',
                      favorites.has(photo.id) ? 'fill-rose-500 text-rose-500' : 'text-white/70',
                    )}
                  />
                </button>
              </div>
              <div className="p-3">
                <h3 className="text-xs font-medium truncate">{photo.title}</h3>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {photo.iso && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-sky-500/10 text-sky-400 rounded border border-sky-500/20 font-mono">
                      ISO {photo.iso}
                    </span>
                  )}
                  {photo.aperture && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-violet-500/10 text-violet-400 rounded border border-violet-500/20 font-mono">
                      f/{photo.aperture}
                    </span>
                  )}
                  {photo.shutter && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-amber-500/10 text-amber-400 rounded border border-amber-500/20 font-mono">
                      {photo.shutter}
                    </span>
                  )}
                  {photo.focalLength && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20 font-mono">
                      {photo.focalLength}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                  {photo.camera && (
                    <span className="flex items-center gap-0.5">
                      <Aperture className="w-2.5 h-2.5" />
                      {photo.camera}
                    </span>
                  )}
                  <span className="flex items-center gap-0.5">
                    <Eye className="w-2.5 h-2.5" />
                    {photo.views || 0}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Heart className="w-2.5 h-2.5" />
                    {photo.likes || 0}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {lightboxPhoto && lightboxIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md"
            onClick={closeLightbox}
          >
            <button
              onClick={closeLightbox}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-white" />
            </button>

            {lightboxIndex > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  prevPhoto();
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Previous"
              >
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
            )}

            {lightboxIndex < filteredPhotos.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  nextPhoto();
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Next"
              >
                <ChevronRight className="w-6 h-6 text-white" />
              </button>
            )}

            <motion.div
              key={lightboxPhoto.id}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="flex flex-col lg:flex-row items-center gap-6 max-w-5xl w-full mx-4 max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-1 flex items-center justify-center min-h-0 max-h-[70vh] lg:max-h-[80vh]">
                {editMode ? (
                  <canvas
                    ref={canvasRef}
                    className="max-w-full max-h-[70vh] lg:max-h-[80vh] object-contain rounded-lg shadow-2xl"
                    style={{ width: 'auto', height: 'auto' }}
                  />
                ) : lightboxPhoto.mediaId ? (
                  <Image
                    src={`/api/media/${lightboxPhoto.mediaId}/stream`}
                    alt={lightboxPhoto.title}
                    width={800}
                    height={600}
                    className="max-w-full max-h-[70vh] lg:max-h-[80vh] object-contain rounded-lg shadow-2xl w-auto h-auto"
                  />
                ) : (
                  <div className="w-full aspect-[4/3] max-w-lg bg-gradient-to-br from-sky-900/40 to-purple-900/40 rounded-lg flex items-center justify-center shadow-2xl">
                    <ImageIcon className="w-16 h-16 text-gray-600" />
                  </div>
                )}
              </div>

              <div className="lg:w-72 w-full bg-white/5 border border-white/10 rounded-lg p-5 backdrop-blur-sm flex-shrink-0 overflow-y-auto max-h-[80vh]">
                {lightboxPhoto.mediaId && (
                  <button
                    onClick={() => {
                      setEditMode((prev) => !prev);
                      if (editMode) resetFilters();
                    }}
                    className={cn(
                      'w-full mb-4 py-1.5 text-xs rounded-lg border flex items-center justify-center gap-1.5 transition-colors',
                      editMode
                        ? 'bg-sky-500/20 border-sky-500/30 text-sky-400'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10',
                    )}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    {editMode ? 'Close Editor' : 'Edit Photo'}
                  </button>
                )}

                {editMode && (
                  <div className="mb-4 space-y-3 pb-4 border-b border-white/10">
                    <h4 className="text-[10px] uppercase tracking-wider text-gray-400 flex items-center gap-1">
                      <Sliders className="w-3 h-3" /> Image Filters
                    </h4>
                    {[
                      { label: 'Brightness', value: filterBrightness, set: setFilterBrightness, min: 0, max: 200, unit: '%' },
                      { label: 'Contrast', value: filterContrast, set: setFilterContrast, min: 0, max: 200, unit: '%' },
                      { label: 'Saturation', value: filterSaturate, set: setFilterSaturate, min: 0, max: 200, unit: '%' },
                      { label: 'Blur', value: filterBlur, set: setFilterBlur, min: 0, max: 20, unit: 'px' },
                    ].map((f) => (
                      <div key={f.label}>
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="text-gray-400">{f.label}</span>
                          <span className="text-gray-400">
                            {f.value}
                            {f.unit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={f.min}
                          max={f.max}
                          step={f.label === 'Blur' ? 0.5 : 1}
                          value={f.value}
                          onChange={(e) => f.set(Number(e.target.value))}
                          className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-sky-500"
                        />
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={resetFilters}
                        className="flex-1 py-1.5 text-[10px] bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 text-gray-400"
                      >
                        Reset
                      </button>
                      <button
                        onClick={handleDownloadEdited}
                        className="flex-1 py-1.5 text-[10px] bg-sky-500/20 border border-sky-500/30 rounded-lg hover:bg-sky-500/30 text-sky-400 flex items-center justify-center gap-1"
                      >
                        <Download className="w-3 h-3" /> Download Edited
                      </button>
                    </div>
                  </div>
                )}

                <h3 className="text-sm font-semibold mb-1 truncate">{lightboxPhoto.title}</h3>
                {lightboxPhoto.description && (
                  <p className="text-xs text-gray-400 mb-4 line-clamp-3">{lightboxPhoto.description}</p>
                )}

                {(lightboxPhoto.camera ||
                  lightboxPhoto.lens ||
                  lightboxPhoto.iso ||
                  lightboxPhoto.aperture ||
                  lightboxPhoto.shutter ||
                  lightboxPhoto.focalLength) && (
                  <div className="mb-4">
                    <h4 className="text-[10px] uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
                      <Focus className="w-3 h-3" /> EXIF Data
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {lightboxPhoto.camera && (
                        <>
                          <span className="text-gray-400">Camera</span>
                          <span className="text-gray-300 truncate">{lightboxPhoto.camera}</span>
                        </>
                      )}
                      {lightboxPhoto.lens && (
                        <>
                          <span className="text-gray-400">Lens</span>
                          <span className="text-gray-300 truncate">{lightboxPhoto.lens}</span>
                        </>
                      )}
                      {lightboxPhoto.iso && (
                        <>
                          <span className="text-gray-400">ISO</span>
                          <span className="text-gray-300">{lightboxPhoto.iso}</span>
                        </>
                      )}
                      {lightboxPhoto.aperture && (
                        <>
                          <span className="text-gray-400">Aperture</span>
                          <span className="text-gray-300">f/{lightboxPhoto.aperture}</span>
                        </>
                      )}
                      {lightboxPhoto.shutter && (
                        <>
                          <span className="text-gray-400">Shutter</span>
                          <span className="text-gray-300">{lightboxPhoto.shutter}</span>
                        </>
                      )}
                      {lightboxPhoto.focalLength && (
                        <>
                          <span className="text-gray-400">Focal Length</span>
                          <span className="text-gray-300">{lightboxPhoto.focalLength}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {lightboxPhoto.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {lightboxPhoto.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 text-[10px] bg-sky-500/10 text-sky-400 rounded-full border border-sky-500/20"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-3 text-xs text-gray-400 pt-3 border-t border-white/10">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    {lightboxPhoto.views || 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="w-3 h-3" />
                    {lightboxPhoto.likes || 0}
                  </span>
                  <button
                    onClick={(e) => toggleFavorite(lightboxPhoto.id, e)}
                    className="ml-auto flex items-center gap-1 hover:text-rose-400 transition-colors"
                  >
                    <Heart
                      className={cn(
                        'w-3.5 h-3.5',
                        favorites.has(lightboxPhoto.id) ? 'fill-rose-500 text-rose-500' : '',
                      )}
                    />
                    <span className="text-[10px]">
                      {favorites.has(lightboxPhoto.id) ? 'Favorited' : 'Favorite'}
                    </span>
                  </button>
                </div>

                <div className="text-center text-[10px] text-gray-400 mt-3">
                  {lightboxIndex + 1} / {filteredPhotos.length}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

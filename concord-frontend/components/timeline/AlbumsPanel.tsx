'use client';

/* eslint-disable @next/next/no-img-element */
// AlbumsPanel — media albums view. Wires timeline.album-list, album-create,
// album-add-media. Photo/video URLs are user-supplied (free uploads by design).

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Plus, Film, ImagePlus, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import type { Album, MediaItem, MediaKind } from './types';

interface AlbumListResult {
  albums: Album[];
  totalAlbums: number;
  totalMedia: number;
}

export function AlbumsPanel() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaKind, setMediaKind] = useState<MediaKind>('photo');
  const [mediaCaption, setMediaCaption] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['timeline-albums'],
    queryFn: async () => {
      const r = await lensRun<AlbumListResult>('timeline', 'album-list', {});
      return r.data.result ?? { albums: [], totalAlbums: 0, totalMedia: 0 };
    },
  });

  const createMutation = useMutation({
    mutationFn: () => lensRun('timeline', 'album-create', { name: newName, description: newDesc }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-albums'] });
        setCreating(false);
        setNewName('');
        setNewDesc('');
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Could not create album' });
      }
    },
  });

  const addMediaMutation = useMutation({
    mutationFn: (albumId: string) =>
      lensRun('timeline', 'album-add-media', {
        albumId,
        media: [{ kind: mediaKind, url: mediaUrl, caption: mediaCaption }],
      }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-albums'] });
        setMediaUrl('');
        setMediaCaption('');
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Could not add media' });
      }
    },
  });

  const albums = data?.albums ?? [];
  const active = albums.find((a) => a.id === openAlbum);

  return (
    <div className="space-y-3">
      <div className="bg-[#242526] rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-white">Photo Albums</h3>
          <span className="text-xs text-gray-500">
            {data?.totalAlbums ?? 0} albums · {data?.totalMedia ?? 0} items
          </span>
        </div>
        <button
          onClick={() => setCreating((c) => !c)}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> New album
        </button>
      </div>

      {creating && (
        <div className="bg-[#242526] rounded-lg p-4 space-y-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Album name"
            className="w-full bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="px-3 py-1.5 rounded text-xs text-gray-400 hover:bg-[#3a3b3c]">
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="bg-[#242526] rounded-lg p-6 text-center text-sm text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading albums…
        </div>
      ) : albums.length === 0 ? (
        <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-500">
          <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No albums yet. Create one to organise your photos and videos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {albums.map((album) => (
            <button
              key={album.id}
              onClick={() => setOpenAlbum(album.id)}
              className="bg-[#242526] rounded-lg overflow-hidden text-left hover:ring-1 hover:ring-blue-500 transition-all"
            >
              <div className="aspect-video bg-[#3a3b3c] flex items-center justify-center overflow-hidden">
                {album.coverUrl ? (
                  <img src={album.coverUrl} alt={album.name} className="w-full h-full object-cover" />
                ) : (
                  <LayoutGrid className="w-8 h-8 text-gray-600" />
                )}
              </div>
              <div className="p-2">
                <p className="text-sm font-medium text-white truncate">{album.name}</p>
                <p className="text-[11px] text-gray-500">{album.media.length} items</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Album detail modal */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpenAlbum(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div
            className="bg-[#242526] border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <div>
                <h3 className="font-bold text-white">{active.name}</h3>
                {active.description && <p className="text-xs text-gray-400">{active.description}</p>}
              </div>
              <button onClick={() => setOpenAlbum(null)} className="p-1 rounded hover:bg-[#3a3b3c] text-gray-400" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {active.media.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">No media in this album yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {active.media.map((m: MediaItem) => (
                    <div key={m.id ?? m.url} className="aspect-square bg-[#3a3b3c] rounded overflow-hidden relative group">
                      {m.kind === 'video' ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-8 h-8 text-gray-500" />
                        </div>
                      ) : (
                        <img src={m.url} alt={m.caption || 'photo'} className="w-full h-full object-cover" />
                      )}
                      {m.caption && (
                        <p className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-white px-1 py-0.5 truncate">
                          {m.caption}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 border-t border-gray-700 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setMediaKind('photo')}
                  className={cn(
                    'px-2.5 py-1 rounded text-xs inline-flex items-center gap-1',
                    mediaKind === 'photo' ? 'bg-blue-600 text-white' : 'bg-[#3a3b3c] text-gray-400',
                  )}
                >
                  <ImagePlus className="w-3.5 h-3.5" /> Photo
                </button>
                <button
                  onClick={() => setMediaKind('video')}
                  className={cn(
                    'px-2.5 py-1 rounded text-xs inline-flex items-center gap-1',
                    mediaKind === 'video' ? 'bg-blue-600 text-white' : 'bg-[#3a3b3c] text-gray-400',
                  )}
                >
                  <Film className="w-3.5 h-3.5" /> Video
                </button>
              </div>
              <input
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={`${mediaKind === 'video' ? 'Video' : 'Photo'} URL`}
                className="w-full bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <input
                  value={mediaCaption}
                  onChange={(e) => setMediaCaption(e.target.value)}
                  placeholder="Caption (optional)"
                  className="flex-1 bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => addMediaMutation.mutate(active.id)}
                  disabled={!mediaUrl.trim() || addMediaMutation.isPending}
                  className="px-4 py-2 rounded bg-blue-600 text-white text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {addMediaMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

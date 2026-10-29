'use client';

/* eslint-disable @next/next/no-img-element */
// AlbumsPanel — media albums view. Wires timeline.album-list, album-create,
// album-add-media. Photo/video URLs are user-supplied (free uploads by design).

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Plus, Film, ImagePlus, Loader2, X, Upload, Trash2, Star, Globe, Users, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import type { Album, MediaItem, MediaKind, Privacy } from './types';
import { uploadTimelineFile, mediaUrlError, probeImageUrl, UPLOAD_ACCEPT } from './uploadMedia';

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
  const [newPrivacy, setNewPrivacy] = useState<Privacy>('private');
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
    mutationFn: () => lensRun('timeline', 'album-create', { name: newName, description: newDesc, privacy: newPrivacy }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-albums'] });
        setCreating(false);
        setNewName('');
        setNewDesc('');
        setNewPrivacy('private');
        // D2/M7: album creation was silent.
        useUIStore.getState().addToast({ type: 'success', message: 'Album created' });
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Could not create album' });
      }
    },
  });

  // S-TL-5: album lifecycle (rename / retier / delete / cover / remove).
  const [editName, setEditName] = useState('');
  const [editPrivacy, setEditPrivacy] = useState<Privacy>('private');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const lifecycleError = (fallback: string) => (r: { data: { ok: boolean; error?: string } }) => {
    if (!r.data.ok) useUIStore.getState().addToast({ type: 'error', message: r.data.error || fallback });
  };

  const updateMutation = useMutation({
    mutationFn: (albumId: string) =>
      lensRun('timeline', 'album-update', { albumId, name: editName, privacy: editPrivacy }),
    onSuccess: (r) => {
      if (r.data.ok) qc.invalidateQueries({ queryKey: ['timeline-albums'] });
      else lifecycleError('Could not save album')(r);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (albumId: string) => lensRun('timeline', 'album-delete', { albumId }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-albums'] });
        setConfirmDelete(false);
        setOpenAlbum(null);
      } else lifecycleError('Could not delete album')(r);
    },
  });

  const removeMediaMutation = useMutation({
    mutationFn: (vars: { albumId: string; mediaId: string }) =>
      lensRun('timeline', 'album-remove-media', vars),
    onSuccess: (r) => {
      if (r.data.ok) qc.invalidateQueries({ queryKey: ['timeline-albums'] });
      else lifecycleError('Could not remove media')(r);
    },
  });

  const setCoverMutation = useMutation({
    mutationFn: (vars: { albumId: string; mediaId: string }) =>
      lensRun('timeline', 'album-set-cover', vars),
    onSuccess: (r) => {
      if (r.data.ok) qc.invalidateQueries({ queryKey: ['timeline-albums'] });
      else lifecycleError('Could not set cover')(r);
    },
  });

  const addMediaMutation = useMutation({
    mutationFn: (vars: { albumId: string; kind: MediaKind; url: string }) =>
      lensRun('timeline', 'album-add-media', {
        albumId: vars.albumId,
        media: [{ kind: vars.kind, url: vars.url, caption: mediaCaption }],
      }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-albums'] });
        setMediaUrl('');
        setMediaCaption('');
        setMediaError(null);
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Could not add media' });
      }
    },
  });

  // S-TL-3: uploads + honest URL attach (F14), same rules as the composer.
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addByUrl = async (albumId: string) => {
    const url = mediaUrl.trim();
    if (!url) return;
    const shapeError = mediaUrlError(url);
    if (shapeError) { setMediaError(shapeError); return; }
    if (mediaKind === 'photo') {
      const loads = await probeImageUrl(url);
      if (!loads) {
        setMediaError("That link didn't load as an image — check the URL, or upload the file instead.");
        return;
      }
    }
    setMediaError(null);
    addMediaMutation.mutate({ albumId, kind: mediaKind, url });
  };

  const onFilePicked = async (albumId: string, file: File | null) => {
    if (!file) return;
    setUploading(true);
    setMediaError(null);
    const result = await uploadTimelineFile(file);
    setUploading(false);
    if (result.ok) {
      addMediaMutation.mutate({ albumId, kind: result.item.kind, url: result.item.url });
    } else {
      setMediaError(result.error);
    }
  };

  const albums = data?.albums ?? [];
  const active = albums.find((a) => a.id === openAlbum);

  // Seed the settings fields when a different album opens.
  useEffect(() => {
    if (active) {
      setEditName(active.name);
      setEditPrivacy(active.privacy ?? 'private');
      setConfirmDelete(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAlbum]);

  return (
    <div className="space-y-3">
      <div className="bg-[#242526] rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-white">Photo Albums</h3>
          <span className="text-xs text-gray-400">
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
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-gray-400 mr-1">Who can see it:</span>
            {([
              { id: 'public', icon: Globe, label: 'Public' },
              { id: 'friends', icon: Users, label: 'Friends' },
              { id: 'private', icon: Lock, label: 'Only me' },
            ] as const).map((o) => (
              <button
                key={o.id}
                onClick={() => setNewPrivacy(o.id)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[11px] inline-flex items-center gap-1',
                  newPrivacy === o.id ? 'bg-blue-600 text-white' : 'bg-[#3a3b3c] text-gray-300 hover:bg-[#4a4b4c]',
                )}
              >
                <o.icon className="w-3 h-3" /> {o.label}
              </button>
            ))}
          </div>
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
        <div className="bg-[#242526] rounded-lg p-6 text-center text-sm text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading albums…
        </div>
      ) : albums.length === 0 ? (
        <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-400">
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
                <p className="text-[11px] text-gray-400">
                  {album.media.length} items · {(album.privacy ?? 'private') === 'public' ? 'Public' : (album.privacy ?? 'private') === 'friends' ? 'Friends' : 'Only me'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Album detail modal. F15: this dialog must never intercept
          keystrokes — an earlier Enter/Space click-shim on these divs
          closed the panel mid-typing and sprayed the caption into the
          composer behind it. Escape closes; nothing else is captured. */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpenAlbum(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpenAlbum(null); }}>
          <div
            className="bg-[#242526] border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-700 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label="Album name"
                  className="flex-1 min-w-0 bg-transparent font-bold text-white outline-none border-b border-transparent focus:border-blue-500 px-0.5"
                />
                <button onClick={() => setOpenAlbum(null)} className="p-1 rounded hover:bg-[#3a3b3c] text-gray-400" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {active.description && <p className="text-xs text-gray-400">{active.description}</p>}
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  { id: 'public', icon: Globe, label: 'Public' },
                  { id: 'friends', icon: Users, label: 'Friends' },
                  { id: 'private', icon: Lock, label: 'Only me' },
                ] as const).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setEditPrivacy(o.id)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-[11px] inline-flex items-center gap-1',
                      editPrivacy === o.id ? 'bg-blue-600 text-white' : 'bg-[#3a3b3c] text-gray-300 hover:bg-[#4a4b4c]',
                    )}
                  >
                    <o.icon className="w-3 h-3" /> {o.label}
                  </button>
                ))}
                <button
                  onClick={() => updateMutation.mutate(active.id)}
                  disabled={!editName.trim() || updateMutation.isPending || (editName === active.name && editPrivacy === (active.privacy ?? 'private'))}
                  className="px-3 py-1 rounded-full bg-[#3a3b3c] text-[11px] text-white disabled:opacity-40 hover:bg-[#4a4b4c]"
                >
                  Save name & audience
                </button>
                {confirmDelete ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-200">
                    Delete “{active.name}” and its {active.media.length} item{active.media.length === 1 ? '' : 's'}?
                    <button
                      onClick={() => deleteMutation.mutate(active.id)}
                      disabled={deleteMutation.isPending}
                      className="px-2.5 py-1 rounded-full bg-rose-600 text-white disabled:opacity-40"
                    >
                      Delete
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="px-2.5 py-1 rounded-full bg-[#3a3b3c] text-gray-200">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="px-2.5 py-1 rounded-full text-[11px] text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Delete album
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {active.media.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No media in this album yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {active.media.map((m: MediaItem) => (
                    <div key={m.id ?? m.url} className="aspect-square bg-[#3a3b3c] rounded overflow-hidden relative group">
                      {m.kind === 'video' ? (
                        <video src={m.url} controls preload="metadata" className="w-full h-full object-cover" />
                      ) : (
                        <img src={m.url} alt={m.caption || 'photo'} className="w-full h-full object-cover" />
                      )}
                      {m.caption && (
                        <p className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-white px-1 py-0.5 truncate">
                          {m.caption}
                        </p>
                      )}
                      {/* S-TL-5: per-item lifecycle — cover choice + remove. */}
                      {active.coverUrl === m.url && (
                        <span className="absolute top-1 left-1 bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded-full">Cover</span>
                      )}
                      {m.id && (
                        <div className="absolute top-1 right-1 hidden group-hover:flex gap-1">
                          {active.coverUrl !== m.url && (
                            <button
                              onClick={() => setCoverMutation.mutate({ albumId: active.id, mediaId: m.id! })}
                              disabled={setCoverMutation.isPending}
                              title="Make cover"
                              aria-label="Make cover"
                              className="p-1 rounded bg-black/70 text-white hover:bg-black/90 disabled:opacity-40"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => removeMediaMutation.mutate({ albumId: active.id, mediaId: m.id! })}
                            disabled={removeMediaMutation.isPending}
                            title="Remove from album"
                            aria-label="Remove from album"
                            className="p-1 rounded bg-black/70 text-rose-300 hover:bg-black/90 disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
                  onClick={() => void addByUrl(active.id)}
                  disabled={!mediaUrl.trim() || addMediaMutation.isPending}
                  className="px-4 py-2 rounded bg-blue-600 text-white text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {addMediaMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || addMediaMutation.isPending}
                  className="px-4 py-2 rounded bg-[#3a3b3c] text-white text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1.5 hover:bg-[#4a4b4c]"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Upload file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    void onFilePicked(active.id, e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </div>
              <p className="text-[11px] text-gray-500">Uploads: images or MP4/WebM video, up to 10 MB. Links are checked before they attach.</p>
              {mediaError && <p className="text-[11px] text-rose-300">{mediaError}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

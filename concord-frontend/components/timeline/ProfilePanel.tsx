'use client';

/* eslint-disable @next/next/no-img-element */
// ProfilePanel — cover photo, bio and "About" section.
// Wires timeline.profile-get and profile-update.

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, GraduationCap, MapPin, Heart, Link2, Pencil, Loader2, Camera, Check, Upload, Eye, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import type { Profile, FeedPost } from './types';
import { uploadTimelineFile, mediaUrlError, UPLOAD_ACCEPT } from './uploadMedia';
import { timeAgo, exactTime } from './timeFormat';

interface ProfileResult {
  profile: Profile;
  stats: { posts: number; albums: number };
}

const EMPTY_ABOUT = { work: '', education: '', location: '', relationship: '', website: '' };

export function ProfilePanel({ viewerId }: { viewerId: string }) {
  const qc = useQueryClient();
  // S-TL-7: View As — preview your own wall as Public or as a specific
  // person. The server computes access for the stand-in; the preview
  // below is read-only by construction (no action controls render).
  const [viewAs, setViewAs] = useState<string | null>(null);
  const [personId, setPersonId] = useState('');
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['timeline-viewas', viewAs],
    queryFn: async () => {
      const r = await lensRun<{ posts: FeedPost[]; total: number; viewAs: { as: string; label: string } | null }>(
        'timeline', 'feed-list', { viewAs, limit: 50 },
      );
      return r.data.result ?? { posts: [], total: 0, viewAs: null };
    },
    enabled: viewAs !== null,
  });
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [about, setAbout] = useState<Profile['about']>(EMPTY_ABOUT);
  // S-TL-3: cover/avatar file uploads on the shared artifact path.
  const [uploadingFor, setUploadingFor] = useState<'cover' | 'avatar' | null>(null);
  const uploadTarget = useRef<'cover' | 'avatar'>('cover');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickFor = (target: 'cover' | 'avatar') => {
    uploadTarget.current = target;
    fileInputRef.current?.click();
  };

  const onFilePicked = async (file: File | null) => {
    if (!file) return;
    const target = uploadTarget.current;
    setUploadingFor(target);
    const result = await uploadTimelineFile(file);
    setUploadingFor(null);
    if (result.ok) {
      if (target === 'cover') setCoverUrl(result.item.url);
      else setAvatarUrl(result.item.url);
    } else {
      useUIStore.getState().addToast({ type: 'error', message: result.error });
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['timeline-profile'],
    queryFn: async () => {
      const r = await lensRun<ProfileResult>('timeline', 'profile-get', {});
      return r.data.result;
    },
  });

  useEffect(() => {
    if (data?.profile) {
      setDisplayName(data.profile.displayName || '');
      setBio(data.profile.bio || '');
      setCoverUrl(data.profile.coverUrl || '');
      setAvatarUrl(data.profile.avatarUrl || '');
      setAbout({ ...EMPTY_ABOUT, ...data.profile.about });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => lensRun('timeline', 'profile-update', { displayName, bio, coverUrl, avatarUrl, about }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-profile'] });
        setEditing(false);
        useUIStore.getState().addToast({ type: 'success', message: 'Profile updated' });
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Update failed' });
      }
    },
  });

  if (isLoading) {
    return (
      <div className="bg-[#242526] rounded-lg p-6 text-center text-sm text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
      </div>
    );
  }

  const profile = data?.profile;
  const aboutRows: { icon: typeof Briefcase; key: keyof Profile['about']; label: string }[] = [
    { icon: Briefcase, key: 'work', label: 'Works at' },
    { icon: GraduationCap, key: 'education', label: 'Studied at' },
    { icon: MapPin, key: 'location', label: 'Lives in' },
    { icon: Heart, key: 'relationship', label: 'Relationship' },
    { icon: Link2, key: 'website', label: 'Website' },
  ];

  return (
    <>
    <div className="bg-[#242526] rounded-lg overflow-hidden">
      {/* Cover */}
      <div className="h-40 bg-gradient-to-br from-blue-600 to-purple-700 relative">
        {profile?.coverUrl && (
          <img src={profile.coverUrl} alt="cover" className="w-full h-full object-cover" />
        )}
        <div className="absolute -bottom-8 left-4 w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 border-4 border-[#242526] overflow-hidden">
          {profile?.avatarUrl && (
            <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
          )}
        </div>
      </div>

      <div className="pt-10 px-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              {profile?.displayName || profile?.username || 'Your profile'}
              {profile?.displayName && profile?.username && (
                <span className="ml-2 text-sm font-normal text-gray-400">@{profile.username}</span>
              )}
            </h2>
            <p className="text-xs text-gray-400">
              {data?.stats.posts ?? 0} posts · {data?.stats.albums ?? 0} albums
            </p>
          </div>
          <button
            onClick={() => setEditing((e) => !e)}
            className="px-3 py-1.5 rounded-lg bg-[#3a3b3c] text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-[#4a4b4c]"
          >
            <Pencil className="w-3.5 h-3.5" /> {editing ? 'Cancel' : 'Edit profile'}
          </button>
        </div>

        {/* S-TL-7: View As controls */}
        <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
          <span className="inline-flex items-center gap-1 text-gray-400">
            <Eye className="w-3.5 h-3.5" /> View your wall as:
          </span>
          {viewAs === null ? (
            <>
              <button
                onClick={() => setViewAs('public')}
                className="px-2.5 py-1 rounded-full bg-[#3a3b3c] text-gray-200 hover:bg-[#4a4b4c]"
              >
                Public
              </button>
              <input
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                placeholder="A person's user ID…"
                className="bg-[#3a3b3c] rounded-full px-3 py-1 text-xs text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500 w-44"
              />
              <button
                onClick={() => { if (personId.trim() && personId.trim() !== viewerId) setViewAs(personId.trim()); }}
                disabled={!personId.trim()}
                className="px-2.5 py-1 rounded-full bg-[#3a3b3c] text-gray-200 hover:bg-[#4a4b4c] disabled:opacity-40"
              >
                That person
              </button>
            </>
          ) : (
            <button
              onClick={() => setViewAs(null)}
              className="px-2.5 py-1 rounded-full bg-blue-600 text-white inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Back to your view
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-3 space-y-2">
            <label className="text-[11px] text-gray-400">Display name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How your name appears on the wall"
              className="w-full bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
            />
            <label className="text-[11px] text-gray-400 flex items-center gap-1">
              <Camera className="w-3 h-3" /> Cover photo URL
            </label>
            <div className="flex gap-2">
              <input
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={() => pickFor('cover')}
                disabled={uploadingFor !== null}
                className="px-3 py-2 rounded bg-[#3a3b3c] text-white text-xs inline-flex items-center gap-1.5 hover:bg-[#4a4b4c] disabled:opacity-50"
              >
                {uploadingFor === 'cover' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Upload
              </button>
            </div>
            <label className="text-[11px] text-gray-400 flex items-center gap-1">
              <Camera className="w-3 h-3" /> Avatar photo URL
            </label>
            <div className="flex gap-2">
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={() => pickFor('avatar')}
                disabled={uploadingFor !== null}
                className="px-3 py-2 rounded bg-[#3a3b3c] text-white text-xs inline-flex items-center gap-1.5 hover:bg-[#4a4b4c] disabled:opacity-50"
              >
                {uploadingFor === 'avatar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Upload
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => {
                void onFilePicked(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <label className="text-[11px] text-gray-400">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              placeholder="Tell people about yourself"
              className="w-full bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none resize-none focus:ring-1 focus:ring-blue-500"
            />
            {aboutRows.map((row) => (
              <input
                key={row.key}
                value={about[row.key]}
                onChange={(e) => setAbout((a) => ({ ...a, [row.key]: e.target.value }))}
                placeholder={row.label}
                className="w-full bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
              />
            ))}
            <button
              onClick={() => {
                // F14 honesty on the profile too: a cover/avatar link
                // that can never load is refused here, in words.
                for (const [label, url] of [['Cover', coverUrl], ['Avatar', avatarUrl]] as const) {
                  if (url.trim()) {
                    const err = mediaUrlError(url);
                    if (err) {
                      useUIStore.getState().addToast({ type: 'error', message: `${label}: ${err}` });
                      return;
                    }
                  }
                }
                saveMutation.mutate();
              }}
              disabled={saveMutation.isPending}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {profile?.bio ? (
              <p className="text-sm text-gray-300">{profile.bio}</p>
            ) : (
              <p className="text-sm text-gray-600 italic">No bio yet.</p>
            )}
            <div className="space-y-1 pt-1">
              {aboutRows
                .filter((row) => profile?.about?.[row.key])
                .map((row) => {
                  const Icon = row.icon;
                  return (
                    <div key={row.key} className="flex items-center gap-2 text-sm text-gray-400">
                      <Icon className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-400">{row.label}</span>
                      <span className="text-gray-200">{profile?.about?.[row.key]}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* S-TL-7: the View As preview — read-only by construction. */}
    {viewAs !== null && (
      <div className="bg-[#242526] rounded-lg overflow-hidden mt-3">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <p className="text-sm text-white inline-flex items-center gap-2">
            <Eye className="w-4 h-4 text-blue-400" />
            Viewing as <span className="font-semibold">{preview?.viewAs?.label || (viewAs === 'public' ? 'Public' : 'Member')}</span>
          </p>
          <span className="text-[11px] text-gray-400">Read-only preview</span>
        </div>
        <div className="p-4 space-y-3">
          {previewLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading their view…
            </div>
          ) : (
            <>
              {((data?.stats.posts ?? 0) - (preview?.total ?? 0)) > 0 && (
                <p className="text-xs text-amber-300">
                  {(data?.stats.posts ?? 0) - (preview?.total ?? 0)} of your posts are hidden from this view.
                </p>
              )}
              {(preview?.posts ?? []).length === 0 ? (
                <p className="text-sm text-gray-400">This viewer sees none of your posts.</p>
              ) : (
                (preview?.posts ?? []).map((p) => (
                  <article key={p.id} className="border border-gray-700 rounded-lg p-3 bg-[#18191a]">
                    <p className="text-[11px] text-gray-400" title={exactTime(p.createdAt)}>
                      {timeAgo(p.createdAt)} · {p.privacy === 'public' ? 'Public' : p.privacy === 'friends' ? 'Friends' : 'Only me'}
                    </p>
                    {p.content && <p className="text-sm text-gray-200 whitespace-pre-wrap mt-1">{p.content}</p>}
                    {p.media?.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {p.media.slice(0, 4).map((m, i) => (
                          m.kind === 'video'
                            ? <video key={m.id ?? i} src={m.url} controls preload="metadata" className="w-20 h-20 object-cover rounded" />
                            : <img key={m.id ?? i} src={m.url} alt={m.caption || 'post media'} className="w-20 h-20 object-cover rounded" />
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-500 mt-2">
                      {p.reactionTotal} reactions · {p.commentCount} comments · {p.shareCount ?? 0} shares
                    </p>
                  </article>
                ))
              )}
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}

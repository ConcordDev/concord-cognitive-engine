'use client';

/* eslint-disable @next/next/no-img-element */
// ProfilePanel — cover photo, bio and "About" section.
// Wires timeline.profile-get and profile-update.

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, GraduationCap, MapPin, Heart, Link2, Pencil, Loader2, Camera, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import type { Profile } from './types';

interface ProfileResult {
  profile: Profile;
  stats: { posts: number; albums: number };
}

const EMPTY_ABOUT = { work: '', education: '', location: '', relationship: '', website: '' };

export function ProfilePanel({ viewerId }: { viewerId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [about, setAbout] = useState<Profile['about']>(EMPTY_ABOUT);

  const { data, isLoading } = useQuery({
    queryKey: ['timeline-profile'],
    queryFn: async () => {
      const r = await lensRun<ProfileResult>('timeline', 'profile-get', {});
      return r.data.result;
    },
  });

  useEffect(() => {
    if (data?.profile) {
      setBio(data.profile.bio || '');
      setCoverUrl(data.profile.coverUrl || '');
      setAbout({ ...EMPTY_ABOUT, ...data.profile.about });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => lensRun('timeline', 'profile-update', { bio, coverUrl, about }),
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
      <div className="bg-[#242526] rounded-lg p-6 text-center text-sm text-gray-500">
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
    <div className="bg-[#242526] rounded-lg overflow-hidden">
      {/* Cover */}
      <div className="h-40 bg-gradient-to-br from-blue-600 to-purple-700 relative">
        {profile?.coverUrl && (
          <img src={profile.coverUrl} alt="cover" className="w-full h-full object-cover" />
        )}
        <div className="absolute -bottom-8 left-4 w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 border-4 border-[#242526]" />
      </div>

      <div className="pt-10 px-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{viewerId}</h2>
            <p className="text-xs text-gray-500">
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

        {editing ? (
          <div className="mt-3 space-y-2">
            <label className="text-[11px] text-gray-400 flex items-center gap-1">
              <Camera className="w-3 h-3" /> Cover photo URL
            </label>
            <input
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://…"
              className="w-full bg-[#3a3b3c] rounded px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
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
              onClick={() => saveMutation.mutate()}
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
                      <Icon className="w-4 h-4 text-gray-500" />
                      <span className="text-gray-500">{row.label}</span>
                      <span className="text-gray-200">{profile?.about?.[row.key]}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

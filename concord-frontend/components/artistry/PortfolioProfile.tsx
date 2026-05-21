/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  User, Edit3, X, Loader2, Eye, Heart, FolderOpen, Users, Briefcase, Save, Link2,
} from 'lucide-react';

interface ProfileLink { label: string; url: string }
interface Profile {
  userId: string; displayName: string; headline: string; bio: string;
  location: string; avatarUrl: string; bannerUrl: string;
  disciplines: string[]; availableForHire: boolean; links: ProfileLink[]; layout: string;
}
interface ProfileProject {
  id: string; title: string; coverUrl: string; discipline: string;
  views: number; appreciations: number;
}
interface ProfileStats {
  projectCount: number; totalViews: number; totalAppreciations: number;
  followerCount: number; followingCount: number;
}
interface ProfilePayload {
  profile: Profile; projects: ProfileProject[]; stats: ProfileStats; isOwner: boolean;
}

const LAYOUTS = ['grid', 'masonry', 'list'];

export function PortfolioProfile() {
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [fName, setFName] = useState('');
  const [fHeadline, setFHeadline] = useState('');
  const [fBio, setFBio] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fAvatar, setFAvatar] = useState('');
  const [fBanner, setFBanner] = useState('');
  const [fDisciplines, setFDisciplines] = useState('');
  const [fLinks, setFLinks] = useState('');
  const [fHire, setFHire] = useState(false);
  const [fLayout, setFLayout] = useState('grid');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('artistry', 'profileGet', {});
    if (r.data?.ok) setData(r.data.result as ProfilePayload);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const openEdit = useCallback(() => {
    if (!data) return;
    const p = data.profile;
    setFName(p.displayName || '');
    setFHeadline(p.headline || '');
    setFBio(p.bio || '');
    setFLocation(p.location || '');
    setFAvatar(p.avatarUrl || '');
    setFBanner(p.bannerUrl || '');
    setFDisciplines((p.disciplines || []).join(', '));
    setFLinks((p.links || []).map((l) => `${l.label}|${l.url}`).join('\n'));
    setFHire(!!p.availableForHire);
    setFLayout(p.layout || 'grid');
    setEditing(true);
  }, [data]);

  const save = useCallback(async () => {
    setSaving(true);
    const links = fLinks.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [label, ...url] = line.split('|');
      return { label: label.trim(), url: url.join('|').trim() };
    });
    const r = await lensRun('artistry', 'profileUpdate', {
      displayName: fName, headline: fHeadline, bio: fBio, location: fLocation,
      avatarUrl: fAvatar, bannerUrl: fBanner,
      disciplines: fDisciplines.split(',').map((d) => d.trim()).filter(Boolean),
      links, availableForHire: fHire, layout: fLayout,
    });
    setSaving(false);
    if (r.data?.ok) { setEditing(false); load(); }
  }, [fName, fHeadline, fBio, fLocation, fAvatar, fBanner, fDisciplines, fLinks, fHire, fLayout, load]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>;
  }
  if (!data) {
    return <div className="text-center py-12 text-gray-500 text-sm">Profile unavailable.</div>;
  }

  const { profile, projects, stats, isOwner } = data;
  const gridClass = profile.layout === 'list'
    ? 'grid grid-cols-1 gap-3'
    : profile.layout === 'masonry'
      ? 'columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4'
      : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';

  return (
    <div className="space-y-4">
      {/* Banner + header */}
      <div className="rounded-lg overflow-hidden border border-white/10">
        <div className="h-32 sm:h-44 bg-gradient-to-br from-neon-pink/20 to-purple-500/10 relative">
          {profile.bannerUrl && <img src={profile.bannerUrl} alt="banner" className="w-full h-full object-cover" />}
        </div>
        <div className="bg-white/5 p-4 sm:p-5 relative">
          <div className="flex items-end gap-4 -mt-12 sm:-mt-14">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-gray-900 bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
              {profile.avatarUrl
                ? <img src={profile.avatarUrl} alt={profile.displayName} className="w-full h-full object-cover" />
                : <User className="w-9 h-9 text-gray-500" />}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <h2 className="text-xl font-bold truncate">{profile.displayName}</h2>
              {profile.headline && <p className="text-sm text-gray-400 truncate">{profile.headline}</p>}
            </div>
            {isOwner && (
              <button onClick={openEdit} className="px-3 py-1.5 text-xs bg-neon-pink/20 border border-neon-pink/30 rounded-lg hover:bg-neon-pink/30 flex items-center gap-1 shrink-0">
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            )}
          </div>

          {profile.bio && <p className="text-sm text-gray-300 mt-3 whitespace-pre-wrap">{profile.bio}</p>}

          <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-gray-500">
            {profile.location && <span>{profile.location}</span>}
            {profile.availableForHire && (
              <span className="flex items-center gap-1 text-neon-green"><Briefcase className="w-3 h-3" /> Available for hire</span>
            )}
          </div>

          {profile.disciplines.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {profile.disciplines.map((d) => (
                <span key={d} className="text-[11px] px-2 py-0.5 bg-neon-pink/10 border border-neon-pink/20 rounded-full text-neon-pink">{d}</span>
              ))}
            </div>
          )}

          {profile.links.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-3">
              {profile.links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noreferrer" className="text-xs text-neon-cyan hover:underline flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> {l.label || l.url}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {[
          { label: 'Projects', value: stats.projectCount, icon: FolderOpen },
          { label: 'Views', value: stats.totalViews, icon: Eye },
          { label: 'Appreciations', value: stats.totalAppreciations, icon: Heart },
          { label: 'Followers', value: stats.followerCount, icon: Users },
          { label: 'Following', value: stats.followingCount, icon: Users },
        ].map((s) => (
          <div key={s.label} className="bg-white/5 border border-white/10 rounded-lg p-2.5 text-center">
            <s.icon className="w-3.5 h-3.5 mx-auto mb-1 text-neon-pink" />
            <div className="text-lg font-bold">{s.value}</div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Project grid in chosen layout */}
      {projects.length === 0 ? (
        <div className="text-center py-10 text-gray-500 text-sm">No published projects yet.</div>
      ) : (
        <div className={gridClass}>
          {projects.map((p) => (
            <div key={p.id} className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-neon-pink/30 transition-colors break-inside-avoid">
              <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                {p.coverUrl
                  ? <img src={p.coverUrl} alt={p.title} className="w-full h-full object-cover" />
                  : <FolderOpen className="w-7 h-7 text-gray-600" />}
              </div>
              <div className="p-3">
                <h3 className="font-medium text-sm truncate">{p.title}</h3>
                <div className="text-[11px] text-gray-500 capitalize">{p.discipline}</div>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.views}</span>
                  <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{p.appreciations}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditing(false)}>
          <div className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Edit Portfolio Profile</h3>
              <button onClick={() => setEditing(false)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Display name" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <input value={fHeadline} onChange={(e) => setFHeadline(e.target.value)} placeholder="Headline (e.g. Concept Artist & Illustrator)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <textarea value={fBio} onChange={(e) => setFBio(e.target.value)} placeholder="Bio" rows={3} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <input value={fLocation} onChange={(e) => setFLocation(e.target.value)} placeholder="Location" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <input value={fAvatar} onChange={(e) => setFAvatar(e.target.value)} placeholder="Avatar image URL" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <input value={fBanner} onChange={(e) => setFBanner(e.target.value)} placeholder="Banner image URL" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <input value={fDisciplines} onChange={(e) => setFDisciplines(e.target.value)} placeholder="Disciplines (comma separated)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <textarea value={fLinks} onChange={(e) => setFLinks(e.target.value)} placeholder="Links — one per line: label|url" rows={2} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={fHire} onChange={(e) => setFHire(e.target.checked)} /> Available for hire
                </label>
                <select value={fLayout} onChange={(e) => setFLayout(e.target.value)} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm">
                  {LAYOUTS.map((l) => <option key={l} value={l}>{l} layout</option>)}
                </select>
              </div>
              <button onClick={save} disabled={saving} className="w-full py-2 bg-neon-pink/20 rounded-lg text-sm hover:bg-neon-pink/30 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

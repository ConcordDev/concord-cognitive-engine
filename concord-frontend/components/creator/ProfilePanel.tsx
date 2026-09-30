'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessageSquare, Save, Settings, Sparkles } from 'lucide-react';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { api } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useCreator } from './CreatorProvider';
import type { SocialProfile } from './types';

const PANEL = ds.panel;

function ProfileTab({
  profile, onSaved,
}: { profile: SocialProfile | null; onSaved: () => void }) {
  const [displayName, setDisplayName]   = useState(profile?.displayName ?? '');
  const [bio,         setBio]           = useState(profile?.bio ?? '');
  const [avatar,      setAvatar]        = useState(profile?.avatar ?? '');
  const [website,     setWebsite]       = useState(profile?.website ?? '');
  const [specs,       setSpecs]         = useState((profile?.specialization ?? []).join(', '));
  const [isPublic,    setIsPublic]      = useState(profile?.isPublic ?? true);
  const [saving,      setSaving]        = useState(false);
  const [savedAt,     setSavedAt]       = useState<string | null>(null);
  const [err,         setErr]           = useState<string | null>(null);

  // Resync when profile updates from outside this component.
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setAvatar(profile.avatar);
      setWebsite(profile.website);
      setSpecs(profile.specialization.join(', '));
      setIsPublic(profile.isPublic);
    }
  }, [profile?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist a "broadcast" lens artifact each time the creator publishes
  // an update — gives the lens persistence credit and feeds cross-lens
  // discovery (followers' feeds can pick it up).
  const broadcasts = useArtifacts<{ kind: string; message: string; at: string }>('creator', {
    type: 'broadcast', limit: 5,
  });
  const createBroadcast = useCreateArtifact<{ kind: string; message: string; at: string }>('creator');

  async function save() {
    setSaving(true); setErr(null); setSavedAt(null);
    try {
      const r = await api.post('/api/social/profile', {
        displayName, bio, avatar, website, isPublic,
        specialization: specs.split(',').map((s) => s.trim()).filter(Boolean),
      });
      const body = r.data;
      if (body?.ok === false) {
        setErr(body?.error ?? 'Save failed.');
        return;
      }
      // Best-effort broadcast announcement.
      createBroadcast.mutate({
        type: 'broadcast',
        title: `Profile update: ${displayName || 'creator'}`,
        data: { kind: 'profile_update', message: bio.slice(0, 120), at: new Date().toISOString() },
        meta: { tags: ['creator', 'profile'], status: 'completed', visibility: 'public' },
      });
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={PANEL}>
      <h2 className="text-amber-200 font-semibold mb-4 inline-flex items-center gap-1.5">
        <Settings className="w-4 h-4" /> Public profile
      </h2>

      {!profile && (
        <div className="text-xs text-gray-400 italic mb-3">
          You don&apos;t have a profile yet. Save below to create one — it&apos;s how
          followers see you across lenses.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Display name">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What followers should see"
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Avatar URL">
          <input value={avatar} onChange={(e) => setAvatar(e.target.value)}
            placeholder="https://…"
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Website">
          <input value={website} onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://…"
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Specialization (comma-separated)">
          <input value={specs} onChange={(e) => setSpecs(e.target.value)}
            placeholder="ml, music, governance"
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Bio" className="md:col-span-2">
          <DraftedTextarea lensId="creator" draftKey="bio" initial={bio} onValueChange={setBio}
            rows={3} placeholder="One paragraph followers will see."
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        Public — discoverable in /api/social/profiles
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-gray-400 rounded text-white inline-flex items-center gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save profile
        </button>
        {savedAt && <span className="text-xs text-emerald-300 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> Saved {savedAt}</span>}
        {err && <span className="text-xs text-rose-300">{err}</span>}
      </div>

      {broadcasts.data?.artifacts && broadcasts.data.artifacts.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5 inline-flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> Recent broadcasts
          </div>
          <ul className="space-y-1 text-xs">
            {broadcasts.data.artifacts.slice(0, 5).map((a) => (
              <li key={a.id} className="text-gray-400">
                <span className="text-gray-200">{a.title}</span>
                <span className="text-gray-600 ml-2">
                  {new Date((a.data as { at?: string })?.at ?? a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  );
}


export function ProfilePanel() {
  const { profile, refreshDashboard } = useCreator();
  return <ProfileTab profile={profile} onSaved={refreshDashboard} />;
}

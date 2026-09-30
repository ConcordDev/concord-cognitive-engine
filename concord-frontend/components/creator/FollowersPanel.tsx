'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Users, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { useCreator } from './CreatorProvider';
import type { FollowerRow, SocialProfile } from './types';

const PANEL = ds.panel;
const GRID = 'grid grid-cols-1 md:grid-cols-2 gap-4';

function FollowersTab({ profile }: { profile: SocialProfile | null }) {
  const [followers, setFollowers] = useState<FollowerRow[]>([]);
  const [following, setFollowing] = useState<FollowerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile?.userId) return;
    setLoading(true); setError(null);
    try {
      const [fRes, gRes] = await Promise.all([
        fetch(`/api/social/followers/${encodeURIComponent(profile.userId)}`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`/api/social/following/${encodeURIComponent(profile.userId)}`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      const fArr = Array.isArray(fRes?.followers) ? fRes.followers : [];
      const gArr = Array.isArray(gRes?.following) ? gRes.following : [];
      setFollowers(
        fArr.map((id: string | { userId?: string; displayName?: string }) =>
          typeof id === 'string' ? { userId: id } : { userId: id.userId ?? '', displayName: id.displayName }
        )
      );
      setFollowing(
        gArr.map((id: string | { userId?: string; displayName?: string }) =>
          typeof id === 'string' ? { userId: id } : { userId: id.userId ?? '', displayName: id.displayName }
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [profile?.userId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function unfollow(targetId: string) {
    try {
      await api.post('/api/social/unfollow', { followedId: targetId });
      refresh();
    } catch (e) {
      console.error('[creator] unfollow failed:', e);
    }
  }

  if (!profile) {
    return (
      <section className={`${PANEL} text-gray-400 italic`}>
        Set up a profile first to see your followers.
      </section>
    );
  }

  return (
    <div className={GRID}>
      <section className={PANEL}>
        <h2 className="text-emerald-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <UserPlus className="w-4 h-4" /> Followers <span className="text-gray-400 text-xs">({followers.length})</span>
        </h2>
        {loading ? (
          <div className="text-gray-400 italic text-sm">Loading…</div>
        ) : error ? (
          <p className="text-xs text-rose-300">{error}</p>
        ) : followers.length === 0 ? (
          <div className="text-gray-400 italic text-sm">No followers yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {followers.map((f) => (
              <li key={f.userId} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 text-xs">
                  {(f.displayName || f.userId).slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 truncate text-gray-200">{f.displayName || f.userId}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={PANEL}>
        <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <Users className="w-4 h-4" /> Following <span className="text-gray-400 text-xs">({following.length})</span>
        </h2>
        {loading ? (
          <div className="text-gray-400 italic text-sm">Loading…</div>
        ) : following.length === 0 ? (
          <div className="text-gray-400 italic text-sm">Not following anyone yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {following.map((f) => (
              <li key={f.userId} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5">
                <div className="w-6 h-6 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-violet-300 text-xs">
                  {(f.displayName || f.userId).slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 truncate text-gray-200">{f.displayName || f.userId}</span>
                <button
                  onClick={() => unfollow(f.userId)}
                  className="text-[11px] text-rose-300 hover:text-rose-200 inline-flex items-center gap-0.5"
                  title="Unfollow"
                >
                  <X className="w-3 h-3" /> unfollow
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}


export function FollowersPanel() {
  const { profile } = useCreator();
  return <FollowersTab profile={profile} />;
}

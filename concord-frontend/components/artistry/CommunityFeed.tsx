 
/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Users, UserPlus, UserMinus, Heart, Eye, MessageSquare, Loader2, Compass, ImageIcon,
} from 'lucide-react';

interface FeedItem {
  id: string; title: string; discipline: string; userId: string;
  coverUrl: string; images: { url: string }[]; views: number;
  appreciations: number; commentCount: number; createdAt: string;
}
interface Graph {
  following: string[]; followers: string[]; mutuals: string[];
  followingCount: number; followerCount: number; mutualCount: number;
}

export function CommunityFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [mode, setMode] = useState<string>('follows');
  const [fromFollows, setFromFollows] = useState(0);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(true);
  const [followInput, setFollowInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [feedR, graphR] = await Promise.all([
      lensRun('artistry', 'personalizedFeed', { limit: 24 }),
      lensRun('artistry', 'followGraph', {}),
    ]);
    if (feedR.data?.ok) {
      setFeed((feedR.data.result.items as FeedItem[]) || []);
      setMode(feedR.data.result.mode || 'follows');
      setFromFollows(feedR.data.result.fromFollowsCount || 0);
    }
    if (graphR.data?.ok) setGraph(graphR.data.result as Graph);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const doFollow = useCallback(async () => {
    if (!followInput.trim()) return;
    const r = await lensRun('artistry', 'follow', { targetUserId: followInput.trim() });
    if (r.data?.ok) { setFollowInput(''); load(); }
  }, [followInput, load]);

  const doUnfollow = useCallback(async (uid: string) => {
    await lensRun('artistry', 'unfollow', { targetUserId: uid });
    load();
  }, [load]);

  const appreciate = useCallback(async (id: string) => {
    const r = await lensRun('artistry', 'appreciate', { projectId: id });
    if (r.data?.ok) {
      setFeed((prev) => prev.map((f) => f.id === id ? { ...f, appreciations: r.data!.result.count } : f));
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Follow graph summary */}
      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-neon-pink" /> Follow Graph
        </h3>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="p-2 bg-white/5 rounded text-center">
            <div className="text-lg font-bold text-neon-pink">{graph?.followerCount ?? 0}</div>
            <div className="text-[10px] text-gray-500">Followers</div>
          </div>
          <div className="p-2 bg-white/5 rounded text-center">
            <div className="text-lg font-bold text-neon-cyan">{graph?.followingCount ?? 0}</div>
            <div className="text-[10px] text-gray-500">Following</div>
          </div>
          <div className="p-2 bg-white/5 rounded text-center">
            <div className="text-lg font-bold text-purple-400">{graph?.mutualCount ?? 0}</div>
            <div className="text-[10px] text-gray-500">Mutuals</div>
          </div>
        </div>
        <div className="flex gap-2 mb-2">
          <input value={followInput} onChange={(e) => setFollowInput(e.target.value)} placeholder="Follow artist by user ID..." className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm" />
          <button onClick={doFollow} disabled={!followInput.trim()} className="px-3 py-1.5 bg-neon-pink/20 rounded-lg text-xs hover:bg-neon-pink/30 disabled:opacity-50 flex items-center gap-1">
            <UserPlus className="w-3 h-3" /> Follow
          </button>
        </div>
        {graph && graph.following.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {graph.following.map((u) => (
              <span key={u} className="text-[11px] px-2 py-1 bg-white/5 border border-white/10 rounded-full flex items-center gap-1">
                {u}
                <button onClick={() => doUnfollow(u)} aria-label={`Unfollow ${u}`} className="text-gray-500 hover:text-red-400">
                  <UserMinus className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Personalized feed */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        {mode === 'discovery'
          ? <span className="flex items-center gap-1"><Compass className="w-3.5 h-3.5" /> Discovery — most appreciated (follow artists for a personalized feed)</span>
          : <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {fromFollows} project{fromFollows === 1 ? '' : 's'} from artists you follow</span>}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>
      ) : feed.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">No projects in your feed yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {feed.map((f) => (
            <div key={f.id} className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-neon-pink/30 transition-colors">
              <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                {(f.coverUrl || f.images[0]?.url)
                  ? <img src={f.coverUrl || f.images[0].url} alt={f.title} className="w-full h-full object-cover" />
                  : <ImageIcon className="w-8 h-8 text-gray-600" />}
              </div>
              <div className="p-3">
                <h3 className="font-medium text-sm truncate">{f.title}</h3>
                <div className="text-[11px] text-gray-500">by {f.userId} · {f.discipline}</div>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{f.views}</span>
                  <button onClick={() => appreciate(f.id)} className="flex items-center gap-1 hover:text-neon-pink">
                    <Heart className="w-3 h-3" />{f.appreciations}
                  </button>
                  <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{f.commentCount}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

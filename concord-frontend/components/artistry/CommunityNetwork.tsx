/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Users, UserPlus, UserMinus, Eye, Heart, MessageSquare, Loader2, Rss, ImageIcon, Sparkles, Send,
} from 'lucide-react';
import { ArtistryDmPanel, type DmMessage, type DmThread } from './ArtistryDmPanel';

interface FeedProject {
  id: string; userId: string; title: string; description: string; discipline: string;
  coverUrl: string; images: { url: string }[]; views: number;
  appreciations: number; commentCount: number; createdAt: string;
}
interface FeedPayload { mode: string; fromFollowsCount: number; items: FeedProject[]; count: number }
interface GraphPayload {
  userId: string; following: string[]; followers: string[]; mutuals: string[];
  followingCount: number; followerCount: number; mutualCount: number;
}
interface DmInboxPayload { threads: DmThread[]; count: number }
interface DmListPayload { messages: DmMessage[]; count: number; threadKey: string }

export function CommunityNetwork() {
  const [feed, setFeed] = useState<FeedPayload | null>(null);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [followInput, setFollowInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();

  // ── Direct messages between creators ──────────────────────────────
  const [dmThreads, setDmThreads] = useState<DmThread[]>([]);
  const [selDmPartner, setSelDmPartner] = useState<string | null>(null);
  const [dmMessages, setDmMessages] = useState<DmMessage[]>([]);
  const [dmDraft, setDmDraft] = useState('');
  const [dmBusy, setDmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, g, i] = await Promise.all([
      lensRun('artistry', 'personalizedFeed', { limit: 24 }),
      lensRun('artistry', 'followGraph', {}),
      lensRun('artistry', 'dm-inbox', {}),
    ]);
    if (f.data?.ok) setFeed(f.data.result as FeedPayload);
    if (g.data?.ok) setGraph(g.data.result as GraphPayload);
    if (i.data?.ok) setDmThreads((i.data.result as DmInboxPayload)?.threads || []);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const follow = useCallback(async () => {
    const target = followInput.trim();
    if (!target) return;
    setBusy(true);
    const r = await lensRun('artistry', 'follow', { targetUserId: target });
    setBusy(false);
    if (r.data?.ok) { setFollowInput(''); load(); }
  }, [followInput, load]);

  const unfollow = useCallback(async (target: string) => {
    setBusy(true);
    await lensRun('artistry', 'unfollow', { targetUserId: target });
    setBusy(false);
    load();
  }, [load]);

  const appreciate = useCallback(async (projectId: string) => {
    await lensRun('artistry', 'appreciate', { projectId });
    load();
  }, [load]);

  const loadDmThread = useCallback(async (partnerId: string) => {
    const r = await lensRun('artistry', 'dm-list', { partnerId });
    if (r.data?.ok) setDmMessages((r.data.result as DmListPayload)?.messages || []);
  }, []);

  // Opens (or resumes) a conversation with a specific creator — the ONLY
  // entry point into the DM panel is the "Message" action on a real
  // follow/follower row (or an existing inbox thread); there is no
  // free-text recipient box.
  const openDm = useCallback((partnerId: string | null) => {
    setSelDmPartner(partnerId);
    setDmMessages([]);
    if (partnerId) loadDmThread(partnerId);
  }, [loadDmThread]);

  const sendDm = useCallback(async () => {
    if (!selDmPartner || !dmDraft.trim()) return;
    setDmBusy(true);
    const r = await lensRun('artistry', 'dm-send', { toId: selDmPartner, body: dmDraft.trim() });
    setDmBusy(false);
    if (r.data?.ok) {
      setDmDraft('');
      const [, i] = await Promise.all([
        loadDmThread(selDmPartner),
        lensRun('artistry', 'dm-inbox', {}),
      ]);
      if (i.data?.ok) setDmThreads((i.data.result as DmInboxPayload)?.threads || []);
    }
  }, [selDmPartner, dmDraft, loadDmThread]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Follow graph */}
      <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-neon-pink" /> Your Network</h3>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Following', value: graph?.followingCount ?? 0 },
            { label: 'Followers', value: graph?.followerCount ?? 0 },
            { label: 'Mutuals', value: graph?.mutualCount ?? 0 },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 rounded-lg p-2.5 text-center">
              <div className="text-lg font-bold text-neon-pink">{s.value}</div>
              <div className="text-[9px] text-gray-400 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={followInput} onChange={(e) => setFollowInput(e.target.value)} placeholder="Follow an artist by user ID..." className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm" />
          <button onClick={follow} disabled={busy || !followInput.trim()} className="px-3 py-1.5 bg-neon-pink/20 rounded-lg text-xs hover:bg-neon-pink/30 disabled:opacity-50 flex items-center gap-1">
            <UserPlus className="w-3 h-3" /> Follow
          </button>
        </div>
        {graph && graph.following.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider pt-1">Following</div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {graph.following.map((u) => (
                <span key={u} className="flex items-center gap-1 text-[11px] px-2 py-1 bg-white/5 border border-white/10 rounded-full">
                  {graph.mutuals.includes(u) && <Heart className="w-2.5 h-2.5 fill-neon-pink text-neon-pink" />}
                  {u}
                  <button onClick={() => openDm(u)} className="text-gray-400 hover:text-neon-cyan" aria-label={`Message ${u}`}>
                    <Send className="w-2.5 h-2.5" />
                  </button>
                  <button onClick={() => unfollow(u)} className="text-gray-400 hover:text-red-400" aria-label={`Unfollow ${u}`}>
                    <UserMinus className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {graph && graph.followers.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider pt-1">Followers</div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {graph.followers.map((u) => (
                <span key={u} className="flex items-center gap-1 text-[11px] px-2 py-1 bg-white/5 border border-white/10 rounded-full">
                  {graph.mutuals.includes(u) && <Heart className="w-2.5 h-2.5 fill-neon-pink text-neon-pink" />}
                  {u}
                  <button onClick={() => openDm(u)} className="text-gray-400 hover:text-neon-cyan" aria-label={`Message ${u}`}>
                    <Send className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Direct messages */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4 text-neon-pink" /> Messages</h3>
        <ArtistryDmPanel
          threads={dmThreads}
          selPartner={selDmPartner}
          onSelectPartner={openDm}
          messages={dmMessages}
          draft={dmDraft}
          setDraft={setDmDraft}
          onSend={sendDm}
          busy={dmBusy}
          currentUserId={user?.id || null}
        />
      </div>

      {/* Personalized feed */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {feed?.mode === 'discovery'
              ? <><Sparkles className="w-4 h-4 text-purple-400" /> Discover</>
              : <><Rss className="w-4 h-4 text-neon-cyan" /> Following Feed</>}
          </h3>
          {feed?.mode === 'discovery' && (
            <span className="text-[10px] text-gray-400">Follow artists to personalize this feed</span>
          )}
        </div>
        {!feed || feed.items.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No projects in your feed yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {feed.items.map((p) => (
              <div key={p.id} className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-neon-pink/30 transition-colors">
                <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                  {(p.coverUrl || p.images[0]?.url)
                    ? <img src={p.coverUrl || p.images[0].url} alt={p.title} className="w-full h-full object-cover" />
                    : <ImageIcon className="w-7 h-7 text-gray-600" />}
                </div>
                <div className="p-3">
                  <h4 className="font-medium text-sm truncate">{p.title}</h4>
                  <div className="text-[11px] text-gray-400">by {p.userId} · {p.discipline}</div>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.views}</span>
                    <button onClick={() => appreciate(p.id)} className="flex items-center gap-1 hover:text-neon-pink">
                      <Heart className="w-3 h-3" />{p.appreciations}
                    </button>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{p.commentCount}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

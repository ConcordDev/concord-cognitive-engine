'use client';

/* eslint-disable @next/next/no-img-element */

/**
 * PhilosophyCuration — wires the full Are.na + IEP feature surface of
 * the philosophy lens: visual image-block grid, public channel
 * discovery, channel collaborators, Wikipedia rich-link embeds,
 * concept/thinker reference pages, the channel↔block connections
 * graph, and collaborative argument-debate threads.
 *
 * Every macro called here is a real backend handler in
 * server/domains/philosophy.js — no placeholders, no mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Grid3x3, Globe, Users, Sparkles, BookMarked, Network,
  MessagesSquare, Loader2, Plus, Trash2, ImageIcon, Link2,
  Search, X, ChevronRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, type TreeNode } from '@/components/viz';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Shared types                                                       */
/* ------------------------------------------------------------------ */

interface ChannelMeta { id: string; title: string; description: string; blockCount: number; public?: boolean }
interface GridBlock {
  id: string; kind: string; content: string; imageUrl: string | null;
  source: string | null; channelCount: number; createdAt: string;
}
interface PublicChannel {
  id: string; title: string; description: string; ownerId: string;
  blockCount: number; collaboratorCount: number; publishedAt: string;
}
interface PublicDetailBlock {
  id: string; kind: string; content: string; imageUrl: string | null; source: string | null;
}
interface RefPage {
  id: string; kind: string; topic: string; title: string; description: string;
  extract: string; thumbnail: string | null; url: string | null;
  related: { title: string; extract: string; thumbnail: string | null }[];
}
interface GraphResult {
  nodes: { id: string; label: string; type: string; kind?: string; public?: boolean }[];
  edges: { from: string; to: string }[];
  bridges: { a: string; b: string; via: string }[];
  channelCount: number; blockCount: number; crossConnectedBlocks: number;
}
interface DebatePost {
  id: string; stance: string; body: string; targetPremise: string | null;
  author: string; createdAt: string;
}
interface DebateThread {
  id: string; title: string; claim: string; branch: string; author: string;
  status: string; posts: DebatePost[]; resolution?: string | null; postCount?: number; createdAt: string;
}

const SUBTAByS = [
  { id: 'grid', label: 'Image Grid', icon: Grid3x3 },
  { id: 'discover', label: 'Discover', icon: Globe },
  { id: 'collab', label: 'Collaborators', icon: Users },
  { id: 'embed', label: 'Embeds', icon: Sparkles },
  { id: 'reference', label: 'Reference Pages', icon: BookMarked },
  { id: 'graph', label: 'Connections', icon: Network },
  { id: 'debate', label: 'Debate Threads', icon: MessagesSquare },
] as const;
type SubTab = typeof SUBTAByS[number]['id'];

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

export function PhilosophyCuration() {
  const [tab, setTab] = useState<SubTab>('grid');
  const [channels, setChannels] = useState<ChannelMeta[]>([]);

  const loadChannels = useCallback(async () => {
    const r = await lensRun('philosophy', 'channel-list', {});
    if (r.data.ok) setChannels((r.data.result as { channels: ChannelMeta[] })?.channels || []);
  }, []);
  useEffect(() => { void loadChannels(); }, [loadChannels]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Network className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Curation Studio</h3>
        <span className="text-[11px] text-zinc-400">Are.na + IEP feature surface</span>
      </div>

      <div className="flex flex-wrap gap-1 mb-4">
        {SUBTAByS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors',
              tab === t.id
                ? 'bg-amber-600/20 text-amber-300'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'grid' && <ImageGridTab channels={channels} onMutate={loadChannels} />}
      {tab === 'discover' && <DiscoverTab />}
      {tab === 'collab' && <CollaboratorsTab channels={channels} />}
      {tab === 'embed' && <EmbedTab channels={channels} onMutate={loadChannels} />}
      {tab === 'reference' && <ReferenceTab />}
      {tab === 'graph' && <GraphTab />}
      {tab === 'debate' && <DebateTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 1 — Visual image-block grid (masonry)                          */
/* ------------------------------------------------------------------ */

function ImageGridTab({ channels, onMutate }: { channels: ChannelMeta[]; onMutate: () => void }) {
  const [channelId, setChannelId] = useState('');
  const [blocks, setBlocks] = useState<GridBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [imgUrl, setImgUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) { setBlocks([]); return; }
    setLoading(true);
    const r = await lensRun('philosophy', 'block-grid', { channelId: id });
    if (r.data.ok) setBlocks((r.data.result as { blocks: GridBlock[] })?.blocks || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!channelId && channels.length > 0) setChannelId(channels[0].id);
  }, [channels, channelId]);
  useEffect(() => { void load(channelId); }, [channelId, load]);

  async function addImage() {
    if (!channelId || !imgUrl.trim() || !caption.trim()) return;
    setBusy(true);
    const r = await lensRun('philosophy', 'block-add', {
      channelId, kind: 'image', content: caption.trim(), imageUrl: imgUrl.trim(),
    });
    setBusy(false);
    if (r.data.ok) {
      setImgUrl(''); setCaption('');
      await load(channelId);
      onMutate();
    }
  }
  async function del(id: string) {
    await lensRun('philosophy', 'block-delete', { id });
    await load(channelId);
    onMutate();
  }

  if (channels.length === 0) {
    return <p className="text-xs text-zinc-400 italic">Create a channel first to add image blocks.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <select
          value={channelId} onChange={(e) => setChannelId(e.target.value)}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200"
        >
          {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 flex flex-wrap gap-1.5">
        <input
          value={imgUrl} onChange={(e) => setImgUrl(e.target.value)}
          placeholder="Image URL (https://…)"
          className="flex-1 min-w-[180px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
        />
        <input
          value={caption} onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void addImage(); }}
          placeholder="Caption"
          className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
        />
        <button
          onClick={addImage} disabled={busy || !imgUrl.trim() || !caption.trim()}
          className="px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Add image
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : blocks.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No blocks in this channel yet.</p>
      ) : (
        <div className="columns-2 sm:columns-3 gap-2 [&>*]:mb-2">
          {blocks.map((b) => (
            <div key={b.id} className="group break-inside-avoid bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
              {b.imageUrl ? (
                <img src={b.imageUrl} alt={b.content} className="w-full object-cover" loading="lazy" />
              ) : (
                <div className="aspect-video flex items-center justify-center text-zinc-700">
                  <ImageIcon className="w-6 h-6" />
                </div>
              )}
              <div className="p-2">
                <div className="flex items-start gap-1">
                  <p className="flex-1 text-[11px] text-zinc-300 line-clamp-2">{b.content}</p>
                  <button aria-label="Delete" onClick={() => del(b.id)} className="opacity-0 group-hover:opacity-100 text-rose-400 shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {b.channelCount > 1 && (
                  <p className="text-[9px] text-amber-400 mt-1">in {b.channelCount} channels</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 2 — Public channel discovery                                   */
/* ------------------------------------------------------------------ */

function DiscoverTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<{ channel: ChannelMeta; ownerId: string; blocks: PublicDetailBlock[] } | null>(null);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    const r = await lensRun('philosophy', 'public-channels', q ? { query: q } : {});
    if (r.data.ok) setResults((r.data.result as { channels: PublicChannel[] })?.channels || []);
    setLoading(false);
  }, []);
  useEffect(() => { void search(''); }, [search]);

  async function openChannel(id: string) {
    const r = await lensRun('philosophy', 'public-channel-detail', { id });
    if (r.data.ok) {
      const res = r.data.result as { channel: ChannelMeta; ownerId: string; blocks: PublicDetailBlock[] };
      setOpen({ channel: res.channel, ownerId: res.ownerId, blocks: res.blocks });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(query); }}
            placeholder="Search public channels…"
            className="w-full pl-7 pr-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200"
          />
        </div>
        <button onClick={() => search(query)} className="px-3 py-1.5 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold">
          Search
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : results.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No public channels yet. Publish a channel from the Collaborators tab.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {results.map((c) => (
            <button
              key={c.id} onClick={() => openChannel(c.id)}
              className="text-left bg-zinc-900/60 border border-zinc-800 hover:border-amber-700/50 rounded-lg p-3"
            >
              <p className="text-xs font-bold text-zinc-100">{c.title}</p>
              {c.description && <p className="text-[10px] text-zinc-400 mt-0.5 line-clamp-2">{c.description}</p>}
              <div className="flex items-center gap-2 mt-2 text-[10px] text-zinc-400">
                <span>{c.blockCount} blocks</span>
                <span>·</span>
                <span>{c.collaboratorCount} collaborators</span>
                <span className="ml-auto text-zinc-600">by {c.ownerId}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="bg-zinc-950 border border-amber-800/40 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-3.5 h-3.5 text-amber-400" />
            <h4 className="text-sm font-bold text-zinc-100">{open.channel.title}</h4>
            <span className="text-[10px] text-zinc-400">by {open.ownerId}</span>
            <button aria-label="Open" onClick={() => setOpen(null)} className="ml-auto text-zinc-400 hover:text-zinc-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {open.blocks.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">This channel has no blocks.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {open.blocks.map((b) => (
                <div key={b.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2">
                  {b.imageUrl && (
                    <img src={b.imageUrl} alt={b.content} className="w-full rounded mb-1 object-cover" loading="lazy" />
                  )}
                  <p className={cn('text-[11px] text-zinc-300', b.kind === 'quote' && 'italic')}>{b.content}</p>
                  {b.source && <p className="text-[9px] text-zinc-400 mt-1">— {b.source}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 3 — Channel collaborators + publish toggle                     */
/* ------------------------------------------------------------------ */

function CollaboratorsTab({ channels }: { channels: ChannelMeta[] }) {
  const [channelId, setChannelId] = useState('');
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!channelId && channels.length > 0) setChannelId(channels[0].id);
  }, [channels, channelId]);

  const load = useCallback(async (id: string) => {
    if (!id) { setCollaborators([]); return; }
    const r = await lensRun('philosophy', 'channel-collaborator-list', { id });
    if (r.data.ok) setCollaborators((r.data.result as { collaborators: string[] })?.collaborators || []);
    const ch = channels.find((c) => c.id === id);
    setIsPublic(Boolean(ch?.public));
  }, [channels]);
  useEffect(() => { void load(channelId); }, [channelId, load]);

  async function add() {
    if (!channelId || !newUser.trim()) return;
    setBusy(true);
    const r = await lensRun('philosophy', 'channel-collaborator-add', { id: channelId, userId: newUser.trim() });
    setBusy(false);
    if (r.data.ok) { setNewUser(''); await load(channelId); }
  }
  async function remove(userId: string) {
    await lensRun('philosophy', 'channel-collaborator-remove', { id: channelId, userId });
    await load(channelId);
  }
  async function togglePublish() {
    const next = !isPublic;
    const r = await lensRun('philosophy', 'channel-publish', { id: channelId, public: next });
    if (r.data.ok) setIsPublic((r.data.result as { public: boolean })?.public ?? next);
  }

  if (channels.length === 0) {
    return <p className="text-xs text-zinc-400 italic">Create a channel first to manage collaborators.</p>;
  }

  return (
    <div className="space-y-3">
      <select
        value={channelId} onChange={(e) => setChannelId(e.target.value)}
        className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200"
      >
        {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>

      <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-zinc-200">Visibility</p>
          <p className="text-[10px] text-zinc-400">{isPublic ? 'Public — listed in Discover' : 'Private — only you and collaborators'}</p>
        </div>
        <button
          onClick={togglePublish}
          className={cn(
            'px-3 py-1 text-xs rounded font-semibold',
            isPublic ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200',
          )}
        >
          {isPublic ? 'Public' : 'Make public'}
        </button>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-200">Collaborators</p>
        <div className="flex gap-1.5">
          <input
            value={newUser} onChange={(e) => setNewUser(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            placeholder="Collaborator user id"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
          />
          <button
            onClick={add} disabled={busy || !newUser.trim()}
            className="px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {collaborators.length === 0 ? (
          <p className="text-[10px] text-zinc-400 italic">No collaborators yet.</p>
        ) : (
          <ul className="space-y-1">
            {collaborators.map((u) => (
              <li key={u} className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded px-2 py-1">
                <Users className="w-3 h-3 text-amber-400" />
                <span className="flex-1 text-[11px] text-zinc-200">{u}</span>
                <button aria-label="Delete" onClick={() => remove(u)} className="text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 4 — Rich Wikipedia embeds as blocks                            */
/* ------------------------------------------------------------------ */

function EmbedTab({ channels, onMutate }: { channels: ChannelMeta[]; onMutate: () => void }) {
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [last, setLast] = useState<GridBlock | null>(null);

  useEffect(() => {
    if (!channelId && channels.length > 0) setChannelId(channels[0].id);
  }, [channels, channelId]);

  async function embed() {
    if (!channelId || !title.trim()) return;
    setBusy(true); setError('');
    const r = await lensRun('philosophy', 'block-embed', { channelId, title: title.trim() });
    setBusy(false);
    if (r.data.ok) {
      setLast((r.data.result as { block: GridBlock })?.block || null);
      setTitle('');
      onMutate();
    } else {
      setError(r.data.error || 'Embed failed');
    }
  }

  if (channels.length === 0) {
    return <p className="text-xs text-zinc-400 italic">Create a channel first to add embed blocks.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Pull a rich Wikipedia preview (thumbnail + extract) into a channel as an embed block.
      </p>
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 flex flex-wrap gap-1.5">
        <select
          value={channelId} onChange={(e) => setChannelId(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
        >
          {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <input
          value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void embed(); }}
          placeholder="Wikipedia article title (e.g. Stoicism)"
          className="flex-1 min-w-[180px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
        />
        <button
          onClick={embed} disabled={busy || !title.trim()}
          className="px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}Embed
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      {last && (
        <div className="flex gap-3 bg-zinc-900/60 border border-emerald-800/40 rounded-lg p-3">
          {last.imageUrl && (
            <img src={last.imageUrl} alt={last.content} className="w-20 h-20 object-cover rounded shrink-0" loading="lazy" />
          )}
          <div>
            <p className="text-xs font-bold text-zinc-100">{last.content}</p>
            <p className="text-[10px] text-emerald-400 mt-0.5">Embed added to channel</p>
            {last.source && (
              <a href={last.source} target="_blank" rel="noreferrer" className="text-[10px] text-amber-400 hover:underline">
                {last.source}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 5 — Concept / thinker reference pages (IEP-style)              */
/* ------------------------------------------------------------------ */

function ReferenceTab() {
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'concept' | 'thinker'>('concept');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState<RefPage | null>(null);
  const [saved, setSaved] = useState<RefPage[]>([]);

  const loadSaved = useCallback(async () => {
    const r = await lensRun('philosophy', 'reference-list', {});
    if (r.data.ok) setSaved((r.data.result as { references: RefPage[] })?.references || []);
  }, []);
  useEffect(() => { void loadSaved(); }, [loadSaved]);

  async function lookup(save: boolean) {
    if (!topic.trim()) return;
    setBusy(true); setError('');
    const r = await lensRun('philosophy', 'reference-page', { topic: topic.trim(), kind, save });
    setBusy(false);
    if (r.data.ok) {
      setPage((r.data.result as { page: RefPage })?.page || null);
      if (save) await loadSaved();
    } else {
      setError(r.data.error || 'Lookup failed');
    }
  }
  async function del(id: string) {
    await lensRun('philosophy', 'reference-delete', { id });
    await loadSaved();
  }

  return (
    <div className="space-y-3">
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 flex flex-wrap gap-1.5">
        <select
          value={kind} onChange={(e) => setKind(e.target.value as 'concept' | 'thinker')}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
        >
          <option value="concept">Concept</option>
          <option value="thinker">Thinker</option>
        </select>
        <input
          value={topic} onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void lookup(false); }}
          placeholder={kind === 'thinker' ? 'Thinker (e.g. Immanuel Kant)' : 'Concept (e.g. Free will)'}
          className="flex-1 min-w-[180px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
        />
        <button
          onClick={() => lookup(false)} disabled={busy || !topic.trim()}
          className="px-3 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Look up'}
        </button>
        <button
          onClick={() => lookup(true)} disabled={busy || !topic.trim()}
          className="px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40"
        >
          Save page
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      {page && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
          <div className="flex gap-3">
            {page.thumbnail && (
              <img src={page.thumbnail} alt={page.title} className="w-24 h-24 object-cover rounded shrink-0" loading="lazy" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold text-zinc-100">{page.title}</p>
              <p className="text-[10px] uppercase tracking-wide text-amber-400">{page.kind}</p>
              {page.description && <p className="text-[11px] text-zinc-400 italic">{page.description}</p>}
            </div>
          </div>
          <p className="text-[11px] text-zinc-300 mt-2 whitespace-pre-wrap">{page.extract}</p>
          {page.url && (
            <a href={page.url} target="_blank" rel="noreferrer" className="text-[10px] text-amber-400 hover:underline">
              Read full article →
            </a>
          )}
          {page.related.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase text-zinc-400 mb-1">Related entries</p>
              <div className="flex flex-wrap gap-1">
                {page.related.map((r) => (
                  <button
                    key={r.title}
                    onClick={() => { setTopic(r.title); }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {saved.length > 0 && (
        <div>
          <p className="text-[10px] uppercase text-zinc-400 mb-1">Saved reference pages</p>
          <ul className="space-y-1">
            {saved.map((p) => (
              <li key={p.id} className="group flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5">
                {p.thumbnail
                  ? <img src={p.thumbnail} alt="" className="w-7 h-7 object-cover rounded shrink-0" loading="lazy" />
                  : <BookMarked className="w-4 h-4 text-amber-400 shrink-0" />}
                <button onClick={() => setPage(p)} className="flex-1 text-left min-w-0">
                  <p className="text-[11px] font-semibold text-zinc-200 truncate">{p.title}</p>
                  <p className="text-[9px] text-zinc-400">{p.kind}</p>
                </button>
                <button aria-label="Delete" onClick={() => del(p.id)} className="opacity-0 group-hover:opacity-100 text-rose-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 6 — Connections graph (channels ↔ blocks tree)                 */
/* ------------------------------------------------------------------ */

function GraphTab() {
  const [graph, setGraph] = useState<GraphResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('philosophy', 'connections-graph', {});
    if (r.data.ok) setGraph(r.data.result as GraphResult);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }
  if (!graph || graph.nodes.length === 0) {
    return <p className="text-xs text-zinc-400 italic">No channels or blocks to graph yet.</p>;
  }

  // Build a channel-rooted tree: each channel node → its block children.
  const blockNodes = new Map(graph.nodes.filter((n) => n.type === 'block').map((n) => [n.id, n]));
  const childrenByChannel = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!childrenByChannel.has(e.from)) childrenByChannel.set(e.from, []);
    childrenByChannel.get(e.from)!.push(e.to);
  }
  const tree: TreeNode[] = graph.nodes
    .filter((n) => n.type === 'channel')
    .map((c) => ({
      id: c.id,
      label: c.label,
      detail: `${(childrenByChannel.get(c.id) || []).length} blocks${c.public ? ' · public' : ''}`,
      tone: c.public ? 'good' : 'info',
      children: (childrenByChannel.get(c.id) || []).map((bid) => {
        const b = blockNodes.get(bid);
        return {
          id: `${c.id}:${bid}`,
          label: b?.label || bid,
          detail: b?.kind,
          tone: 'default' as const,
        };
      }),
    }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Channels', value: graph.channelCount },
          { label: 'Blocks', value: graph.blockCount },
          { label: 'Cross-linked', value: graph.crossConnectedBlocks },
        ].map((s) => (
          <div key={s.label} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-amber-400">{s.value}</p>
            <p className="text-[10px] text-zinc-400">{s.label}</p>
          </div>
        ))}
      </div>

      <TreeDiagram root={tree} />

      {graph.bridges.length > 0 && (
        <div>
          <p className="text-[10px] uppercase text-zinc-400 mb-1">Channel bridges (shared blocks)</p>
          <ul className="space-y-1">
            {graph.bridges.map((br, i) => {
              const a = graph.nodes.find((n) => n.id === br.a);
              const b = graph.nodes.find((n) => n.id === br.b);
              return (
                <li key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-300 bg-zinc-950 border border-zinc-800 rounded px-2 py-1">
                  <span className="text-amber-300">{a?.label || br.a}</span>
                  <ChevronRight className="w-3 h-3 text-zinc-600" />
                  <span className="text-amber-300">{b?.label || br.b}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 7 — Argument debate threads                                    */
/* ------------------------------------------------------------------ */

const STANCE_TONE: Record<string, string> = {
  support: 'text-emerald-400 border-emerald-800/50 bg-emerald-950/30',
  object: 'text-rose-400 border-rose-800/50 bg-rose-950/30',
  rebut: 'text-amber-400 border-amber-800/50 bg-amber-950/30',
  clarify: 'text-sky-400 border-sky-800/50 bg-sky-950/30',
};
const BRANCHES = ['ethics', 'epistemology', 'metaphysics', 'logic', 'aesthetics', 'political', 'other'];

function DebateTab() {
  const [threads, setThreads] = useState<DebateThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<{ thread: DebateThread; tally: Record<string, number> } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title: '', claim: '', branch: 'ethics' });
  const [post, setPost] = useState({ stance: 'support', body: '', targetPremise: '' });
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('philosophy', 'debate-list', {});
    if (r.data.ok) setThreads((r.data.result as { threads: DebateThread[] })?.threads || []);
    setLoading(false);
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);

  const openThread = useCallback(async (id: string) => {
    const r = await lensRun('philosophy', 'debate-detail', { id });
    if (r.data.ok) {
      const res = r.data.result as { thread: DebateThread; tally: Record<string, number> };
      setOpen({ thread: res.thread, tally: res.tally });
    }
  }, []);

  async function createThread() {
    if (!draft.title.trim() || !draft.claim.trim()) return;
    setBusy(true);
    const r = await lensRun('philosophy', 'debate-create', {
      title: draft.title.trim(), claim: draft.claim.trim(), branch: draft.branch,
    });
    setBusy(false);
    if (r.data.ok) {
      setDraft({ title: '', claim: '', branch: 'ethics' });
      setShowNew(false);
      await loadList();
      const t = (r.data.result as { thread: DebateThread })?.thread;
      if (t) await openThread(t.id);
    }
  }
  async function submitPost() {
    if (!open || !post.body.trim()) return;
    setBusy(true);
    const r = await lensRun('philosophy', 'debate-post', {
      threadId: open.thread.id, stance: post.stance, body: post.body.trim(),
      targetPremise: post.targetPremise.trim(),
    });
    setBusy(false);
    if (r.data.ok) {
      setPost({ stance: 'support', body: '', targetPremise: '' });
      await openThread(open.thread.id);
      await loadList();
    }
  }
  async function resolve(status: 'open' | 'resolved') {
    if (!open) return;
    const r = await lensRun('philosophy', 'debate-resolve', { id: open.thread.id, status });
    if (r.data.ok) { await openThread(open.thread.id); await loadList(); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-zinc-400">Collaborative premise critique — anyone can post support / object / rebut / clarify.</p>
        <button
          onClick={() => setShowNew((s) => !s)}
          className="ml-auto px-2.5 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />New debate
        </button>
      </div>

      {showNew && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5">
          <input
            value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Debate title"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
          />
          <textarea
            value={draft.claim} onChange={(e) => setDraft({ ...draft, claim: e.target.value })}
            placeholder="Central claim under debate"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 h-16 resize-none"
          />
          <div className="flex gap-1.5">
            <select
              value={draft.branch} onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
            >
              {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <button
              onClick={createThread} disabled={busy || !draft.title.trim() || !draft.claim.trim()}
              className="px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-[220px_1fr] gap-3">
        <ul className="space-y-1">
          {loading && <li className="text-[11px] text-zinc-400"><Loader2 className="w-3 h-3 animate-spin inline" /></li>}
          {!loading && threads.length === 0 && <li className="text-[11px] text-zinc-400 italic">No debates yet.</li>}
          {threads.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => openThread(t.id)}
                className={cn(
                  'w-full text-left rounded-lg px-2.5 py-2 border',
                  open?.thread.id === t.id ? 'bg-amber-600/15 border-amber-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700',
                )}
              >
                <p className="text-xs font-semibold text-zinc-100 truncate">{t.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-zinc-400">
                  <span>{t.branch}</span>
                  <span>·</span>
                  <span>{t.postCount ?? t.posts?.length ?? 0} posts</span>
                  {t.status === 'resolved' && <span className="text-emerald-400">· resolved</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>

        {open ? (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
            <h4 className="text-sm font-bold text-zinc-100">{open.thread.title}</h4>
            <p className="text-[11px] text-zinc-400 italic mt-0.5">{open.thread.claim}</p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {(['support', 'object', 'rebut', 'clarify'] as const).map((s) => (
                <span key={s} className={cn('text-[9px] px-1.5 py-0.5 rounded border', STANCE_TONE[s])}>
                  {s} {open.tally[s] || 0}
                </span>
              ))}
              {open.thread.status === 'resolved' ? (
                <button onClick={() => resolve('open')} className="ml-auto text-[10px] text-zinc-400 hover:text-zinc-200">
                  Reopen
                </button>
              ) : (
                <button onClick={() => resolve('resolved')} className="ml-auto text-[10px] text-emerald-400 hover:text-emerald-300">
                  Mark resolved
                </button>
              )}
            </div>

            <div className="space-y-1.5 mt-2 max-h-72 overflow-y-auto">
              {open.thread.posts.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic">No posts yet — be the first to critique.</p>
              ) : (
                open.thread.posts.map((p) => (
                  <div key={p.id} className={cn('rounded-lg border p-2', STANCE_TONE[p.stance] || STANCE_TONE.clarify)}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[9px] uppercase font-bold">{p.stance}</span>
                      <span className="text-[9px] text-zinc-400">{p.author}</span>
                    </div>
                    {p.targetPremise && (
                      <p className="text-[10px] text-zinc-400 mb-0.5">re: {p.targetPremise}</p>
                    )}
                    <p className="text-[11px] text-zinc-200">{p.body}</p>
                  </div>
                ))
              )}
            </div>

            {open.thread.status !== 'resolved' && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 mt-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <select
                    value={post.stance} onChange={(e) => setPost({ ...post, stance: e.target.value })}
                    className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200"
                  >
                    <option value="support">Support</option>
                    <option value="object">Object</option>
                    <option value="rebut">Rebut</option>
                    <option value="clarify">Clarify</option>
                  </select>
                  <input
                    value={post.targetPremise} onChange={(e) => setPost({ ...post, targetPremise: e.target.value })}
                    placeholder="Target premise (optional)"
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
                  />
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submitPost(); }}
                    placeholder="Your argument…"
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
                  />
                  <button
                    onClick={submitPost} disabled={busy || !post.body.trim()}
                    className="px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40"
                  >
                    Post
                  </button>
                </div>
              </div>
            )}
            {open.thread.resolution && (
              <p className="text-[10px] text-emerald-400 mt-2">Resolution: {open.thread.resolution}</p>
            )}
          </div>
        ) : (
          <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[140px]">
            Select or create a debate thread.
          </div>
        )}
      </div>
    </div>
  );
}

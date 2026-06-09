'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Bookmark, Search, Mic, Smile, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface SavedEntry {
  id: string;
  messageId: string;
  threadId: string;
  sender: string;
  body: string;
  note: string;
  savedAt: string;
}

export interface SearchHit {
  messageId: string;
  threadId: string;
  body: string;
  sender: string;
  ts: string;
  score: number;
}

export interface VoiceMeta {
  messageId: string;
  durationMs: number;
  transcript: string;
  registeredAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'saved' | 'search' | 'voice' | 'reactions';

export function MessageWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('saved');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[460px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-sky-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-sky-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold text-gray-200">Message Workbench</span>
        </div>
        <button type="button" onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1">
        {([
          { id: 'saved',     label: 'Saved',     icon: Bookmark },
          { id: 'search',    label: 'Search',    icon: Search },
          { id: 'voice',     label: 'Voice',     icon: Mic },
          { id: 'reactions', label: 'Reactions', icon: Smile },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-sky-500/15 text-sky-200 border border-sky-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'saved' && <SavedTab />}
        {tab === 'search' && <SearchTab />}
        {tab === 'voice' && <VoiceTab />}
        {tab === 'reactions' && <ReactionsTab />}
      </div>
    </div>
  );
}

function SavedTab() {
  const [saved, setSaved] = useState<SavedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'message', action: 'saved-list', input: {} });
      setSaved(((r.data as { result?: { saved?: SavedEntry[] } }).result?.saved) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const unsave = async (messageId: string) => {
    try {
      await lensRun({ domain: 'message', action: 'unsave-message', input: { messageId } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] text-gray-400">Starred messages. Star any message via /api/lens/run domain=message action=save-message.</p>
      {loading ? <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div> :
        saved.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No saved messages.</p> :
        saved.map((s) => (
          <div key={s.id} className="rounded border border-white/10 bg-black/20 p-3 group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-gray-400">{s.sender} · {new Date(s.savedAt).toLocaleDateString()}</p>
                <p className="text-xs text-gray-200 mt-1">{s.body}</p>
                {s.note && <p className="text-[10px] text-gray-400 mt-1 italic">Note: {s.note}</p>}
              </div>
              <button aria-label="Delete" type="button" onClick={() => unsave(s.messageId)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))
      }
    </div>
  );
}

function SearchTab() {
  const [query, setQuery] = useState('');
  const [sender, setSender] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalIndexed, setTotalIndexed] = useState(0);

  const search = async () => {
    if (query.trim().length < 2) return;
    setLoading(true);
    try {
      const r = await lensRun({
        domain: 'message', action: 'search-messages',
        input: { query, sender: sender || undefined, limit: 30 },
      });
      const data = (r.data as { result?: { hits?: SearchHit[]; totalIndexed?: number } }).result;
      setHits(data?.hits || []);
      setTotalIndexed(data?.totalIndexed || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="space-y-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          placeholder="Search across messages"
          className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100" />
        <div className="flex gap-2">
          <input type="text" value={sender} onChange={(e) => setSender(e.target.value)}
            placeholder="from: (optional)"
            className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          <button type="button" onClick={search} disabled={loading || query.trim().length < 2}
            className="px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
          </button>
        </div>
        <p className="text-[10px] text-gray-400">{totalIndexed} messages indexed in your local search corpus.</p>
      </div>

      {hits.length > 0 && (
        <div className="space-y-1">
          {hits.map((h, i) => (
            <div key={i} className="rounded border border-white/10 bg-black/20 p-2">
              <p className="text-[10px] text-gray-400">{h.sender} · {new Date(h.ts).toLocaleString()} · score ×{h.score}</p>
              <p className="text-xs text-gray-200 mt-0.5">{h.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VoiceTab() {
  const [voices, setVoices] = useState<VoiceMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun({ domain: 'message', action: 'voice-list', input: {} });
        setVoices(((r.data as { result?: { voices?: VoiceMeta[] } }).result?.voices) || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>;

  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] text-gray-400">Voice message metadata + transcripts. Audio files persisted separately via DM substrate.</p>
      {voices.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No voice messages yet.</p> :
        voices.map((v) => (
          <div key={v.messageId} className="rounded border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2 text-xs">
              <Mic className="w-3 h-3 text-sky-400" />
              <span className="text-gray-400">{(v.durationMs / 1000).toFixed(1)}s</span>
              <span className="text-[10px] text-gray-400 ml-auto">{new Date(v.registeredAt).toLocaleDateString()}</span>
            </div>
            {v.transcript && <p className="text-xs text-gray-300 mt-2 italic">"{v.transcript}"</p>}
          </div>
        ))
      }
    </div>
  );
}

function ReactionsTab() {
  const [messageId, setMessageId] = useState('');
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const COMMON = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '🙏'];

  const load = async () => {
    if (!messageId.trim()) return;
    try {
      const r = await lensRun({
        domain: 'message', action: 'reactions-for', input: { messageId },
      });
      setReactions(((r.data as { result?: { reactions?: Record<string, number> } }).result?.reactions) || {});
    } catch (e) { console.error(e); }
  };

  const react = async (emoji: string) => {
    if (!messageId.trim()) return;
    try {
      await lensRun({ domain: 'message', action: 'react', input: { messageId, emoji } });
      await load();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[10px] text-gray-400">Add reactions to any message by messageId.</p>
      <div className="flex gap-2">
        <input type="text" value={messageId} onChange={(e) => setMessageId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          placeholder="messageId" className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <button type="button" onClick={load}
          className="px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100">Load</button>
      </div>

      <div className="flex flex-wrap gap-1">
        {COMMON.map((e) => (
          <button key={e} type="button" onClick={() => react(e)}
            className="px-2 py-1 rounded border border-white/10 hover:border-sky-500/30 text-base">{e}</button>
        ))}
      </div>

      {Object.keys(reactions).length > 0 && (
        <div className="rounded border border-white/10 bg-black/20 p-3 space-y-1">
          {Object.entries(reactions).map(([emoji, count]) => (
            <div key={emoji} className="flex justify-between text-sm">
              <span>{emoji}</span>
              <span className="font-mono text-gray-300">×{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageWorkbench;

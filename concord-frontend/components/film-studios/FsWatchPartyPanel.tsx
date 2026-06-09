'use client';

/**
 * FsWatchPartyPanel — synced-playback watch parties with a shared
 * transport (play/pause/seek) and timecoded chat. Backed by the
 * party-* macros; playback position is server-projected so every
 * guest viewing the same party stays in sync.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2, Monitor, Play, Pause, Send, MessageSquare } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Party {
  id: string; title: string; code: string; versionId: string | null;
  playing: boolean; positionSec: number; participants: string[];
}
interface PartyState {
  id: string; title: string; code: string; versionId: string | null;
  playing: boolean; positionSec: number; participantCount: number;
}
interface ChatMsg { id: string; author: string; text: string; atSec: number; createdAt: string }
interface Version { id: string; label: string; stage: string }

function fmtTc(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

export function FsWatchPartyPanel({ projectId }: { projectId: string }) {
  const [parties, setParties] = useState<Party[]>([]);
  const [activeParty, setActiveParty] = useState<string>('');
  const [state, setState] = useState<PartyState | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', versionId: '' });
  const [chatText, setChatText] = useState('');
  const [author, setAuthor] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadParties = useCallback(async () => {
    const [pr, vr] = await Promise.all([
      lensRun('film-studios', 'party-list', { projectId }),
      lensRun('film-studios', 'version-list', { projectId }),
    ]);
    const list: Party[] = pr.data?.result?.parties || [];
    setParties(list);
    setVersions(vr.data?.result?.versions || []);
    setActiveParty((prev) => (list.some((p) => p.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, [projectId]);

  const loadState = useCallback(async () => {
    if (!activeParty) { setState(null); setChat([]); return; }
    const [sr, cr] = await Promise.all([
      lensRun('film-studios', 'party-state', { id: activeParty }),
      lensRun('film-studios', 'party-chat-list', { id: activeParty }),
    ]);
    setState((sr.data?.result?.party as PartyState | null) || null);
    setChat(cr.data?.result?.messages || []);
  }, [activeParty]);

  useEffect(() => { void loadParties(); }, [loadParties]);
  useEffect(() => { void loadState(); }, [loadState]);

  // Live sync poll — keeps the projected position fresh while a party plays.
  useEffect(() => {
    if (!activeParty) return;
    const t = setInterval(() => { void loadState(); }, 3000);
    return () => clearInterval(t);
  }, [activeParty, loadState]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.length]);

  const addParty = async () => {
    if (!form.title.trim()) return;
    await lensRun('film-studios', 'party-create', {
      projectId, title: form.title.trim(), versionId: form.versionId || undefined,
    });
    setForm({ title: '', versionId: '' });
    await loadParties();
  };

  const delParty = async (id: string) => {
    await lensRun('film-studios', 'party-delete', { id });
    await loadParties();
  };

  const togglePlay = async () => {
    if (!state) return;
    await lensRun('film-studios', 'party-sync', {
      id: state.id, playing: !state.playing, positionSec: state.positionSec,
    });
    await loadState();
  };

  const seekTo = async (sec: number) => {
    if (!state) return;
    await lensRun('film-studios', 'party-sync', { id: state.id, positionSec: Math.max(0, sec) });
    await loadState();
  };

  const postChat = async () => {
    if (!state || !chatText.trim()) return;
    await lensRun('film-studios', 'party-chat-post', {
      id: state.id, text: chatText.trim(),
      author: author.trim() || undefined, atSec: Math.round(state.positionSec),
    });
    setChatText('');
    await loadState();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* New party */}
      <section className="flex flex-wrap items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Watch party title" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.versionId} onChange={(e) => setForm({ ...form, versionId: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">No cut linked</option>
          {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <button type="button" onClick={addParty}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Party
        </button>
      </section>

      {parties.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No watch parties yet. Start one to screen a cut with collaborators.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {parties.map((p) => (
              <span key={p.id} className={cn('flex items-center gap-1.5 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
                activeParty === p.id ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
                <button type="button" onClick={() => setActiveParty(p.id)}>{p.title}</button>
                <button aria-label="Delete" type="button" onClick={() => delParty(p.id)} className="text-zinc-300/70 hover:text-rose-200">
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

          {state && (
            <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
              {/* Transport */}
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-fuchsia-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-100 truncate">{state.title}</span>
                <span className="text-[10px] font-mono bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">{state.code}</span>
                <span className="text-[10px] text-zinc-400 ml-auto">{state.participantCount} watching</span>
                <span className={cn('flex items-center gap-1 text-[10px]', state.playing ? 'text-emerald-400' : 'text-zinc-400')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', state.playing ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600')} />
                  {state.playing ? 'Live' : 'Paused'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={togglePlay}
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-fuchsia-600 hover:bg-fuchsia-500 text-white">
                  {state.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <span className="text-xs font-mono text-fuchsia-300 w-14 text-center">{fmtTc(state.positionSec)}</span>
                <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-fuchsia-500" style={{ width: `${Math.min(100, (state.positionSec % 600) / 6)}%` }} />
                </div>
                <button type="button" onClick={() => seekTo(state.positionSec - 10)}
                  className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">-10s</button>
                <button type="button" onClick={() => seekTo(state.positionSec + 10)}
                  className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">+10s</button>
                <button type="button" onClick={() => seekTo(0)}
                  className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">Restart</button>
              </div>

              {/* Chat */}
              <div className="border-t border-zinc-800 pt-2">
                <p className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 mb-1.5">
                  <MessageSquare className="w-3 h-3" /> Watch chat
                </p>
                <div className="max-h-48 overflow-y-auto space-y-1 mb-2">
                  {chat.length === 0 ? (
                    <p className="text-[11px] text-zinc-400 italic py-2 text-center">No messages yet.</p>
                  ) : chat.map((m) => (
                    <div key={m.id} className="flex items-start gap-2 text-[11px]">
                      <span className="font-mono text-fuchsia-400 shrink-0">{fmtTc(m.atSec)}</span>
                      <span className="font-semibold text-zinc-300 shrink-0">{m.author}</span>
                      <span className="text-zinc-400 break-words">{m.text}</span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex items-center gap-2">
                  <input placeholder="Name" value={author} onChange={(e) => setAuthor(e.target.value)}
                    className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                  <input placeholder="Message at current timecode" value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void postChat(); }}
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                  <button aria-label="Send" type="button" onClick={postChat}
                    className="flex items-center justify-center w-7 h-7 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

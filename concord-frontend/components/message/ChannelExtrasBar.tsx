'use client';

/**
 * ChannelExtrasBar — Slack-shape channel chrome under the header:
 * a horizontal bookmarks strip and a pinned-messages popover. Wires
 * the message.bookmark-* and message.pin-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pin, Bookmark, Plus, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface BookmarkItem { id: string; title: string; url: string; emoji: string }
interface PinItem { messageId: string; body: string; senderName: string; pinnedAt: string }

export function ChannelExtrasBar({ channelId, pinNonce }: { channelId: string; pinNonce: number }) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [pins, setPins] = useState<PinItem[]>([]);
  const [showPins, setShowPins] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftUrl, setDraftUrl] = useState('');

  const loadBookmarks = useCallback(async () => {
    const r = await lensRun({ domain: 'message', action: 'bookmark-list', input: { channelId } });
    setBookmarks((r.data?.result?.bookmarks as BookmarkItem[]) || []);
  }, [channelId]);

  const loadPins = useCallback(async () => {
    const r = await lensRun({ domain: 'message', action: 'pins-list', input: { channelId } });
    setPins((r.data?.result?.pins as PinItem[]) || []);
  }, [channelId]);

  useEffect(() => { void loadBookmarks(); void loadPins(); setShowPins(false); setAdding(false); }, [channelId, loadBookmarks, loadPins]);
  useEffect(() => { void loadPins(); }, [pinNonce, loadPins]);

  async function addBookmark() {
    if (!draftTitle.trim()) return;
    await lensRun({ domain: 'message', action: 'bookmark-add', input: { channelId, title: draftTitle.trim(), url: draftUrl.trim() } });
    setDraftTitle(''); setDraftUrl(''); setAdding(false);
    await loadBookmarks();
  }
  async function removeBookmark(id: string) {
    await lensRun({ domain: 'message', action: 'bookmark-remove', input: { channelId, id } });
    await loadBookmarks();
  }
  async function unpin(messageId: string) {
    await lensRun({ domain: 'message', action: 'unpin-message', input: { channelId, messageId } });
    await loadPins();
  }

  return (
    <div className="relative px-4 py-1.5 border-b border-white/10 flex items-center gap-2 flex-wrap bg-black/20">
      <button onClick={() => setShowPins(v => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-amber-300 hover:bg-amber-500/10">
        <Pin className="w-3 h-3" />{pins.length} pinned
      </button>
      <span className="w-px h-3 bg-white/10" />
      {bookmarks.map(b => (
        <span key={b.id} className="group inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-white/[0.04] border border-white/10 text-gray-300">
          <span>{b.emoji}</span>
          {b.url ? (
            <a href={b.url} target="_blank" rel="noreferrer" className="hover:text-violet-300 truncate max-w-[140px]">{b.title}</a>
          ) : (
            <span className="truncate max-w-[140px]">{b.title}</span>
          )}
          <button aria-label="Remove" onClick={() => removeBookmark(b.id)} className="opacity-0 group-hover:opacity-100 text-rose-300"><X className="w-2.5 h-2.5" /></button>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input autoFocus value={draftTitle} onChange={e => setDraftTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void addBookmark(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Title" className="w-24 px-1.5 py-0.5 text-[11px] bg-black/40 border border-white/15 rounded text-white" />
          <input value={draftUrl} onChange={e => setDraftUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void addBookmark(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="URL (optional)" className="w-32 px-1.5 py-0.5 text-[11px] bg-black/40 border border-white/15 rounded text-white" />
          <button onClick={addBookmark} disabled={!draftTitle.trim()} className="px-1.5 py-0.5 text-[10px] rounded bg-violet-500 text-white font-bold disabled:opacity-40">add</button>
        </span>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-gray-400 hover:text-violet-300 hover:bg-white/[0.04]">
          <Bookmark className="w-3 h-3" /><Plus className="w-2.5 h-2.5" />Bookmark
        </button>
      )}

      {showPins && (
        <div className="absolute left-4 top-full mt-1 z-20 w-80 bg-[#0a0c10] border border-white/10 rounded shadow-lg p-2 max-h-72 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-amber-300 mb-1 flex items-center gap-1"><Pin className="w-3 h-3" />Pinned messages</div>
          {pins.length === 0 ? (
            <div className="text-[11px] text-gray-400 italic py-2">No pinned messages. Hover a message and pick Pin.</div>
          ) : pins.map(p => (
            <div key={p.messageId} className="group rounded p-1.5 text-[11px] bg-amber-500/[0.05] mb-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-amber-100">{p.senderName}</span>
                <span className="text-[9px] text-gray-400 font-mono">{p.pinnedAt.slice(0, 16).replace('T', ' ')}</span>
                <button onClick={() => unpin(p.messageId)} className="ml-auto opacity-0 group-hover:opacity-100 text-rose-300 hover:text-rose-200">unpin</button>
              </div>
              <div className="text-gray-200">{p.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

// Phase AG — district ambient chat panel.
//
// Collapsed-by-default panel pinned bottom-left of /lenses/world.
// Shows the last 15 messages in the player's current district.
// Posts go to /api/ambient-chat/post and fan out to the per-district
// Socket.IO room so other players in the same district see them.

import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, ChevronUp, ChevronDown, Send } from 'lucide-react';

interface AmbientMessage {
  id: string;
  user_id: string;
  body: string;
  posted_at: number;
}

interface AmbientChatPanelProps {
  worldId: string;
  districtId: string;
  currentUserId?: string;
}

function timeAgo(ts: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  return `${Math.floor(delta / 3600)}h`;
}

export function AmbientChatPanel({ worldId, districtId, currentUserId }: AmbientChatPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<AmbientMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    if (!worldId || !districtId) return;
    fetch(`/api/ambient-chat/list?worldId=${encodeURIComponent(worldId)}&districtId=${encodeURIComponent(districtId)}&limit=15`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok) setMessages(d.messages || []); })
      .catch(() => {});
  }, [worldId, districtId]);

  useEffect(() => {
    if (!expanded) return;
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [expanded, refresh]);

  const handlePost = useCallback(async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const r = await fetch('/api/ambient-chat/post', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId, districtId, body: draft.trim() }),
      });
      const j = await r.json();
      if (j.ok) {
        setDraft('');
        refresh();
      } else {
        setFlash(j.error || 'post failed');
        setTimeout(() => setFlash(null), 3000);
      }
    } finally { setPosting(false); }
  }, [draft, worldId, districtId, refresh]);

  return (
    <div className="fixed bottom-4 left-4 z-30 w-72 rounded-lg border border-sky-500/30 bg-zinc-950/95 text-zinc-100 shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-t-lg px-3 py-2 hover:bg-zinc-900/60"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare size={14} className="text-sky-400" />
          District chat
          {!expanded && messages.length > 0 && (
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs text-sky-300">{messages.length}</span>
          )}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/80 px-3 py-2">
          <div className="mb-2 max-h-60 space-y-1.5 overflow-y-auto text-xs">
            {messages.length === 0 && (
              <div className="py-3 text-center text-zinc-500">Quiet around here.</div>
            )}
            {messages.slice().reverse().map((m) => {
              const isSelf = m.user_id === currentUserId;
              return (
                <div key={m.id} className={`rounded px-1.5 py-1 ${isSelf ? 'bg-sky-500/10' : 'bg-zinc-900/60'}`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className={`truncate text-[10px] ${isSelf ? 'text-sky-300' : 'text-zinc-400'}`}>
                      {isSelf ? 'you' : m.user_id.slice(0, 8)}
                    </span>
                    <span className="text-[10px] text-zinc-500">{timeAgo(m.posted_at)}</span>
                  </div>
                  <div className="text-zinc-200">{m.body}</div>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); handlePost(); }}
            className="flex items-center gap-1"
          >
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="say something to the district…"
              maxLength={280}
              className="flex-1 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:border-sky-500/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || posting}
              aria-label="Send"
              className="rounded border border-sky-500/30 bg-sky-500/20 p-1 text-sky-200 hover:bg-sky-500/30 disabled:opacity-40"
            >
              <Send size={12} />
            </button>
          </form>
          {flash && (
            <div className="mt-1 text-[10px] text-rose-300">{flash}</div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * NotificationsBell — tag-watch / question-subscription notification
 * inbox. Surfaces a badge with the unread count and a dropdown of
 * notifications. Wires answers.notifications + answers.notifications-mark.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Loader2, Check, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Notification {
  id: string;
  kind: string;
  questionId?: string;
  title?: string;
  message: string;
  read: boolean;
  createdAt: string;
}

interface NotificationsBellProps {
  onOpenQuestion?: (questionId: string) => void;
  refreshKey?: number;
}

export function NotificationsBell({ onOpenQuestion, refreshKey }: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('answers', 'notifications', {});
    if (r.data?.ok) {
      setItems((r.data.result?.notifications as Notification[]) || []);
      setUnread((r.data.result?.unread as number) || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function markAllRead() {
    const r = await lensRun('answers', 'notifications-mark', {});
    if (r.data?.ok) {
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }
  async function clearAll() {
    const r = await lensRun('answers', 'notifications-mark', { clear: true });
    if (r.data?.ok) { setItems([]); setUnread(0); }
  }
  async function markOne(id: string) {
    const r = await lensRun('answers', 'notifications-mark', { id });
    if (r.data?.ok) {
      setUnread((r.data.result?.unread as number) || 0);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` — ${unread} unread` : ''}`}
        className="relative p-1.5 rounded-lg text-zinc-400 hover:text-orange-300 hover:bg-zinc-800"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl z-20">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 sticky top-0 bg-zinc-950">
            <span className="text-xs font-semibold text-zinc-200">Notifications</span>
            <button onClick={markAllRead} className="ml-auto text-[10px] text-zinc-400 hover:text-orange-300 inline-flex items-center gap-0.5">
              <Check className="w-3 h-3" />Mark read
            </button>
            <button onClick={clearAll} className="text-[10px] text-zinc-400 hover:text-rose-300 inline-flex items-center gap-0.5">
              <Trash2 className="w-3 h-3" />Clear
            </button>
          </div>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-zinc-400" /></div>
          ) : items.length === 0 ? (
            <p className="text-xs text-zinc-400 italic text-center py-8">No notifications yet.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      void markOne(n.id);
                      if (n.questionId && onOpenQuestion) { onOpenQuestion(n.questionId); setOpen(false); }
                    }}
                    className={`w-full text-left px-3 py-2 border-b border-zinc-900 hover:bg-zinc-900/60 ${
                      n.read ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />}
                      <span className="text-[10px] uppercase tracking-wide text-orange-400">{n.kind}</span>
                      <span className="ml-auto text-[10px] text-zinc-400">
                        {new Date(n.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-[12px] text-zinc-300 mt-0.5">{n.message}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

interface QueueItem {
  id?: string;
  reportId?: string;
  category?: string;
  severity?: string;
  status?: string;
  contentId?: string;
}

/** Admin queue from GET /api/moderation/queue. A 403 stays on screen; it is not an empty queue. */
export function AdminModerationQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    queueMicrotask(() => {
      void api.get<{ ok?: boolean; queue?: QueueItem[]; error?: string }>('/api/moderation/queue').then((res) => {
        if (cancel) return;
        const status = (res as { status?: number }).status;
        if (status === 403) {
          setItems([]);
          setMessage('The queue is limited to admins.');
          return;
        }
        if (res.data?.ok === false) {
          setItems([]);
          setMessage(res.data.error || 'Could not load the queue.');
          return;
        }
        setItems(Array.isArray(res.data?.queue) ? res.data.queue : []);
      }).catch((err: { response?: { status?: number } }) => {
        if (cancel) return;
        setItems([]);
        setMessage(err?.response?.status === 403 ? 'The queue is limited to admins.' : 'Could not load the queue.');
      });
    });
    return () => { cancel = true; };
  }, []);

  async function approve(reportId: string) {
    setMessage(null);
    try {
      const res = await api.post<{ ok?: boolean; error?: string }>(`/api/moderation/resolve/${reportId}`, { action: 'approve' });
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not resolve that report.');
        return;
      }
      setItems((current) => (current || []).filter((item) => item.reportId !== reportId));
    } catch {
      setMessage('Could not resolve that report.');
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-3 text-sm">
      <h2 className="mb-2 text-xs text-zinc-400">Moderation queue</h2>
      {items === null && <p className="text-xs text-zinc-500">Loading the queue.</p>}
      {items?.length === 0 && !message && <p className="text-xs text-zinc-500">The queue is empty.</p>}
      <ul className="space-y-2">
        {items?.map((item) => (
          <li key={item.id || item.reportId} className="flex items-center gap-2 text-xs text-zinc-300">
            <span>{item.category || 'report'}</span>
            <span className="text-zinc-500">{item.severity}</span>
            <span className="text-zinc-500">{item.status}</span>
            {item.reportId && (
              <button type="button" onClick={() => void approve(item.reportId!)} className="ml-auto rounded bg-white/10 px-2 py-1">
                Approve
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && <p className="mt-2 text-[11px] text-zinc-400">{message}</p>}
    </section>
  );
}

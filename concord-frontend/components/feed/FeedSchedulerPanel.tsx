'use client';

/**
 * FeedSchedulerPanel — Feed's working post scheduler, on the instance's
 * real schedule store (POST /api/social/schedule · GET /api/social/scheduled
 * · DELETE /api/social/scheduled/:id — the SQL-backed social schedule).
 * It replaces the shared PostScheduler mount, which could never work in
 * Feed: its Schedule button fired an onSchedulePost prop no parent ever
 * passed, it read no content from anywhere, it read its queue as
 * `res.data.posts` where the route returns `{ scheduled }`, and Feed
 * mounted it with userId="current-user" (R4 Feed F2 — "Schedule Post" a
 * silent no-op three times). The shared component file is untouched
 * (GB-1320); this panel carries its own copy: content + date/time in,
 * the refusal said in words when the time is past, the queue rendered
 * from the endpoint's rows, and a cancel that deletes. (D2: schedules,
 * or says why not; the scheduled post afterwards visible in a
 * manageable queue.)
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Clock, Loader2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { truncate } from '@/lib/utils';

export interface FeedScheduledRow {
  id: string;
  content: string;
  scheduled_at: string;
  status: string;
}

export function parseScheduledRows(data: unknown): FeedScheduledRow[] {
  if (!data || typeof data !== 'object') return [];
  const rows = (data as { scheduled?: unknown }).scheduled;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      id: String(r.id ?? ''),
      content: typeof r.content === 'string' ? r.content : '',
      scheduled_at: typeof r.scheduled_at === 'string' ? r.scheduled_at : '',
      status: typeof r.status === 'string' ? r.status : 'pending',
    }))
    .filter((r) => r.id !== '');
}

export function FeedSchedulerPanel({ onScheduled }: { onScheduled?: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['feed-scheduled-posts'],
    queryFn: async (): Promise<FeedScheduledRow[]> => {
      const res = await api.get('/api/social/scheduled').catch(() => null);
      return parseScheduledRows(res?.data);
    },
  });
  const rows = queue.data || [];
  // "Upcoming" = still pending; the server's own publisher promotes due
  // rows to posted, so a pending row whose time has passed is simply
  // due-any-moment, not history. (Status, not the wall clock, splits
  // the two lists.)
  const upcoming = rows.filter((r) => r.status === 'pending');
  const past = rows.filter((r) => r.status !== 'pending');

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const scheduledAt = new Date(`${date}T${time || '09:00'}`).toISOString();
      const res = await api.post('/api/social/schedule', { content: draft.trim(), scheduledAt });
      return res.data as { ok?: boolean; error?: string };
    },
    onSuccess: (data) => {
      if (data && data.ok === false) {
        setError(data.error || 'That schedule could not be saved.');
        return;
      }
      setDraft('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['feed-scheduled-posts'] });
      onScheduled?.();
    },
    onError: (e) => {
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'That schedule could not be saved. If the time is already past, pick a future one.',
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/api/social/scheduled/${id}`);
      return res.data as { ok?: boolean };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed-scheduled-posts'] });
    },
    onError: () => {
      setError('That scheduled post could not be cancelled — try again.');
    },
  });

  const handleSchedule = () => {
    setError(null);
    if (!draft.trim()) {
      setError('Write the post first — there is nothing to schedule yet.');
      return;
    }
    if (!date) {
      setError('Pick a date for the scheduled post.');
      return;
    }
    const when = new Date(`${date}T${time || '09:00'}`);
    if (Number.isNaN(when.getTime())) {
      setError('That date and time do not read as a valid moment.');
      return;
    }
    if (when.getTime() <= Date.now()) {
      setError('That time has already passed — pick a future time.');
      return;
    }
    scheduleMutation.mutate();
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-neon-cyan" />
        <h2 className="text-base font-bold text-white">
          Schedule Post
          {upcoming.length > 0 && (
            <span className="ml-2 text-xs text-gray-400 font-normal">({upcoming.length} upcoming)</span>
          )}
        </h2>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Write the post to schedule..."
        rows={3}
        className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan resize-none"
      />
      <div className="flex gap-2 mt-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Schedule date"
          className="flex-1 min-w-0 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded-lg text-xs text-white focus:outline-none focus:border-neon-cyan"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Schedule time"
          className="flex-1 min-w-0 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded-lg text-xs text-white focus:outline-none focus:border-neon-cyan"
        />
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <button
        onClick={handleSchedule}
        disabled={scheduleMutation.isPending}
        className="w-full mt-2 px-4 py-2 bg-neon-cyan text-black text-sm font-bold rounded-lg hover:bg-neon-cyan/90 disabled:opacity-40 transition-colors"
      >
        {scheduleMutation.isPending ? 'Scheduling...' : 'Schedule Post'}
      </button>

      <div className="mt-4 space-y-2">
        {queue.isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
          </div>
        ) : upcoming.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No scheduled posts</p>
          </div>
        ) : (
          upcoming.map((post) => {
            const scheduledDate = new Date(post.scheduled_at);
            return (
              <div key={post.id} className="p-3 rounded-xl bg-lattice-deep border border-lattice-border">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{truncate(post.content, 120)}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                      <Calendar className="w-3 h-3" />
                      <span>{scheduledDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      <Clock className="w-3 h-3 ml-1" />
                      <span>{scheduledDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => cancelMutation.mutate(post.id)}
                    disabled={cancelMutation.isPending}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                    title="Cancel scheduled post"
                    aria-label="Cancel scheduled post"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
        {past.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-400 mb-1.5">Recently posted</p>
            {past.slice(0, 3).map((post) => (
              <div key={post.id} className="p-2 rounded-lg bg-lattice-surface/50 border border-lattice-border/50 mb-1.5 opacity-60">
                <p className="text-xs text-gray-400 truncate">{post.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

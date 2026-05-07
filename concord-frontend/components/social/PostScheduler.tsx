'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Clock, Trash2, Loader2, FileText, AlertCircle } from 'lucide-react';
import { cn, formatRelativeTime, truncate } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface ScheduledPost {
  postId: string;
  content: string;
  scheduledAt: string;
  mediaType?: string;
  tags?: string[];
}

interface PostSchedulerProps {
  userId: string;
  onSchedulePost?: (date: string) => void;
  className?: string;
}

// ── Main Component ───────────────────────────────────────────────────────────

function PostScheduler({ userId, onSchedulePost, className }: PostSchedulerProps) {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('12:00');

  const { data: scheduled, isLoading } = useQuery({
    queryKey: ['scheduled-posts', userId],
    queryFn: async () => {
      const res = await api.get('/api/social/scheduled', {
        params: { userId },
      });
      return (res.data.posts || []) as ScheduledPost[];
    },
    enabled: !!userId,
  });

  const cancelMutation = useMutation({
    mutationFn: async (postId: string) => {
      await api.delete(`/api/social/scheduled/${postId}`);
      return postId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts', userId] });
    },
  });

  const handleSchedule = () => {
    if (!selectedDate || !selectedTime) return;
    const iso = new Date(`${selectedDate}T${selectedTime}:00`).toISOString();
    onSchedulePost?.(iso);
  };

  const now = new Date();
  const minDate = now.toISOString().split('T')[0];

  const upcoming = (scheduled || [])
    .filter((p) => new Date(p.scheduledAt) > now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const past = (scheduled || [])
    .filter((p) => new Date(p.scheduledAt) <= now)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  return (
    <div className={cn('space-y-4', className)}>
      {/* Schedule picker */}
      <div className="p-4 rounded-xl bg-lattice-deep border border-lattice-border">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-semibold text-white">Schedule a Post</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Date</label>
            <input
              type="date"
              value={selectedDate}
              min={minDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-neon-cyan/50 [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Time</label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-neon-cyan/50 [color-scheme:dark]"
            />
          </div>
        </div>

        <button
          onClick={handleSchedule}
          disabled={!selectedDate || !selectedTime}
          className="mt-3 w-full px-4 py-2 rounded-lg bg-neon-cyan/15 text-neon-cyan text-sm font-medium border border-neon-cyan/30 hover:bg-neon-cyan/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          Schedule Post
        </button>
      </div>

      {/* Scheduled queue */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-neon-purple" />
          <h3 className="text-sm font-semibold text-white">
            Scheduled Queue
            {upcoming.length > 0 && (
              <span className="ml-2 text-xs text-gray-500 font-normal">
                ({upcoming.length} upcoming)
              </span>
            )}
          </h3>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
          </div>
        ) : upcoming.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No scheduled posts</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {upcoming.map((post) => {
              const scheduledDate = new Date(post.scheduledAt);
              const dateStr = scheduledDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });
              const timeStr = scheduledDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <motion.div
                  key={post.postId}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, height: 0 }}
                  className="p-3 rounded-xl bg-lattice-deep border border-lattice-border"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-lattice-surface">
                      <FileText className="w-4 h-4 text-gray-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white line-clamp-2">
                        {truncate(post.content, 120)}
                      </p>

                      <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                        <Calendar className="w-3 h-3" />
                        <span>{dateStr}</span>
                        <Clock className="w-3 h-3 ml-1" />
                        <span>{timeStr}</span>
                      </div>

                      {post.tags && post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {post.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] text-neon-cyan/60 bg-neon-cyan/5 px-1.5 py-0.5 rounded-full"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => cancelMutation.mutate(post.postId)}
                      disabled={cancelMutation.isPending}
                      className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                      title="Cancel scheduled post"
                    >
                      {cancelMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        {/* Past scheduled */}
        {past.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-3.5 h-3.5 text-gray-600" />
              <span className="text-xs text-gray-600">Recently posted</span>
            </div>
            {past.slice(0, 3).map((post) => (
              <div
                key={post.postId}
                className="p-2 rounded-lg bg-lattice-surface/50 border border-lattice-border/50 mb-1.5 opacity-60"
              >
                <p className="text-xs text-gray-400 truncate">{post.content}</p>
                <span className="text-[10px] text-gray-600">
                  Posted {formatRelativeTime(post.scheduledAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedPostScheduler = withErrorBoundary(PostScheduler);
export { _WrappedPostScheduler as PostScheduler };
export default _WrappedPostScheduler;

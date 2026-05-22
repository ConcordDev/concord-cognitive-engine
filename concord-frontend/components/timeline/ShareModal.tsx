'use client';

// ShareModal — repost a post onto the viewer's own timeline.
// Wires the timeline.share-post macro.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X, Share2, Globe, Users, Lock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import type { FeedPost, Privacy } from './types';

const PRIVACY: { id: Privacy; icon: typeof Globe; label: string }[] = [
  { id: 'public', icon: Globe, label: 'Public' },
  { id: 'friends', icon: Users, label: 'Friends' },
  { id: 'private', icon: Lock, label: 'Only me' },
];

export function ShareModal({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('friends');

  const shareMutation = useMutation({
    mutationFn: () => lensRun('timeline', 'share-post', { postId: post.id, comment, privacy }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-feed'] });
        useUIStore.getState().addToast({ type: 'success', message: 'Shared to your timeline' });
        onClose();
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Share failed' });
      }
    },
    onError: () => useUIStore.getState().addToast({ type: 'error', message: 'Share failed' }),
  });

  const original = post.sharedFrom
    ? { content: post.sharedFrom.content, authorId: post.sharedFrom.authorId }
    : { content: post.content, authorId: post.authorId };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-[#242526] border border-gray-700 rounded-xl w-full max-w-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-400" /> Share post
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#3a3b3c] text-gray-400" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Say something about this…"
          rows={3}
          autoFocus
          className="w-full bg-[#3a3b3c] rounded-lg p-3 text-sm text-white placeholder-gray-500 outline-none resize-none focus:ring-1 focus:ring-blue-500"
        />

        {/* Quoted original */}
        <div className="border border-gray-700 rounded-lg p-3 bg-[#18191a]">
          <p className="text-xs font-semibold text-gray-300 mb-1">{original.authorId}</p>
          <p className="text-sm text-gray-400 line-clamp-3">{original.content || '(media post)'}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Audience</span>
          {PRIVACY.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => setPrivacy(p.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5',
                  privacy === p.id ? 'bg-blue-600 text-white' : 'bg-[#3a3b3c] text-gray-400 hover:bg-[#4a4b4c]',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end pt-1">
          <button
            onClick={() => shareMutation.mutate()}
            disabled={shareMutation.isPending}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {shareMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Share now
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

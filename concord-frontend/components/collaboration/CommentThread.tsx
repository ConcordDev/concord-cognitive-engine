'use client';

import { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Reply,
  Check,
  Send,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Comment {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  resolved: boolean;
  reactions: Record<string, string[]>;
  replies?: Comment[];
}

interface User {
  id: string;
  name: string;
  avatar?: string;
  color: string;
}

interface CommentThreadProps {
  comments: Comment[];
  users: Record<string, User>;
  currentUserId: string;
  onAddComment: (content: string, parentId?: string) => void;
  onResolve: (commentId: string) => void;
  onReact: (commentId: string, emoji: string) => void;
  className?: string;
}

const QUICK_REACTIONS = ['👍', '❤️', '🎉', '🤔', '👀'];

export function CommentThread({
  comments,
  users,
  currentUserId,
  onAddComment,
  onResolve,
  onReact,
  className
}: CommentThreadProps) {
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const handleSubmit = (parentId?: string) => {
    if (!newComment.trim()) return;
    onAddComment(newComment.trim(), parentId);
    setNewComment('');
    setReplyingTo(null);
  };

  const toggleThread = (commentId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const getUser = (userId: string): User => {
    return users[userId] || { id: userId, name: 'Unknown', color: '#666' };
  };

  const CommentItem = ({ comment, depth = 0 }: { comment: Comment; depth?: number }) => {
    const user = getUser(comment.userId);
    const hasReplies = comment.replies && comment.replies.length > 0;
    const isExpanded = expandedThreads.has(comment.id);
    const isReplying = replyingTo === comment.id;

    return (
      <div className={cn('relative', depth > 0 && 'ml-8 mt-3')}>
        {/* Thread line */}
        {depth > 0 && (
          <div className="absolute left-[-20px] top-0 bottom-0 w-px bg-lattice-border" />
        )}

        <div className={cn(
          'group',
          comment.resolved && 'opacity-60'
        )}>
          {/* Comment header */}
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium text-white flex-shrink-0"
              style={{ backgroundColor: user.color }}
            >
              {user.avatar ? (
                <Image src={user.avatar} alt={user.name} width={32} height={32} className="w-full h-full rounded-full" />
              ) : (
                user.name.charAt(0).toUpperCase()
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-white">{user.name}</span>
                <span className="text-xs text-gray-400">{formatTime(comment.createdAt)}</span>
                {comment.resolved && (
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <Check className="w-3 h-3" />
                    Resolved
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-300 whitespace-pre-wrap">
                {comment.content}
              </p>

              {/* Reactions */}
              {Object.keys(comment.reactions).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {Object.entries(comment.reactions).map(([emoji, userIds]) => (
                    <button
                      key={emoji}
                      onClick={() => onReact(comment.id, emoji)}
                      className={cn(
                        'px-2 py-0.5 text-xs rounded-full border transition-colors',
                        userIds.includes(currentUserId)
                          ? 'bg-neon-cyan/20 border-neon-cyan/50 text-neon-cyan'
                          : 'bg-lattice-surface border-lattice-border text-gray-400 hover:border-gray-500'
                      )}
                    >
                      {emoji} {userIds.length}
                    </button>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setReplyingTo(isReplying ? null : comment.id)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"
                >
                  <Reply className="w-3 h-3" />
                  Reply
                </button>

                {/* Quick reactions */}
                <div className="flex items-center gap-1">
                  {QUICK_REACTIONS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => onReact(comment.id, emoji)}
                      className="p-1 text-xs hover:bg-lattice-surface rounded transition-colors"
                      aria-label={`React with ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                {!comment.resolved && (
                  <button
                    onClick={() => onResolve(comment.id)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-400 ml-auto"
                  >
                    <Check className="w-3 h-3" />
                    Resolve
                  </button>
                )}
              </div>

              {/* Reply input */}
              <AnimatePresence>
                {isReplying && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-3 overflow-hidden"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit(comment.id)}
                        placeholder="Write a reply..."
                        className="flex-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSubmit(comment.id)}
                        disabled={!newComment.trim()}
                        className="p-2 bg-neon-cyan text-black rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Send reply"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Replies toggle */}
          {hasReplies && (
            <button
              onClick={() => toggleThread(comment.id)}
              className="flex items-center gap-1 mt-2 ml-11 text-xs text-gray-400 hover:text-white"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {comment.replies!.length} {comment.replies!.length === 1 ? 'reply' : 'replies'}
            </button>
          )}

          {/* Replies */}
          <AnimatePresence>
            {hasReplies && isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {comment.replies!.map(reply => (
                  <CommentItem key={reply.id} comment={reply} depth={depth + 1} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-lattice-border">
        <MessageSquare className="w-4 h-4 text-neon-cyan" />
        <span className="font-medium text-white">Comments</span>
        <span className="text-xs text-gray-400">({comments.length})</span>
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {comments.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No comments yet</p>
            <p className="text-xs text-gray-400 mt-1">Start the conversation!</p>
          </div>
        ) : (
          comments.map(comment => (
            <CommentItem key={comment.id} comment={comment} />
          ))
        )}
      </div>

      {/* New comment input */}
      <div className="p-4 border-t border-lattice-border">
        <div className="flex items-start gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium text-white flex-shrink-0"
            style={{ backgroundColor: getUser(currentUserId).color }}
          >
            {getUser(currentUserId).name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 flex items-start gap-2">
            <input
              type="text"
              value={replyingTo ? '' : newComment}
              onChange={(e) => !replyingTo && setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !replyingTo && handleSubmit()}
              placeholder="Add a comment..."
              className="flex-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
              disabled={!!replyingTo}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={!newComment.trim() || !!replyingTo}
              className="p-2 bg-neon-cyan text-black rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neon-cyan/90 transition-colors"
              aria-label="Send comment"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

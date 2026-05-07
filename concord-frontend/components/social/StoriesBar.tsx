'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface StoryItem {
  storyId: string;
  imageUrl?: string;
  content?: string;
  createdAt: string;
  duration?: number; // seconds, default 5
}

interface UserStory {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  hasUnwatched: boolean;
  stories: StoryItem[];
}

interface StoriesBarProps {
  currentUserId: string;
  onCreateStory?: () => void;
  className?: string;
}

// ── Gradient helper ──────────────────────────────────────────────────────────

const gradients = [
  'from-neon-cyan to-blue-600',
  'from-neon-purple to-pink-600',
  'from-neon-pink to-rose-600',
  'from-amber-400 to-orange-600',
  'from-violet-500 to-indigo-600',
  'from-teal-400 to-cyan-600',
];

function pickGradient(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return gradients[Math.abs(hash) % gradients.length];
}

// ── Story Circle ─────────────────────────────────────────────────────────────

function StoryCircle({
  user,
  onClick,
}: {
  user: UserStory;
  onClick: () => void;
}) {
  const gradient = pickGradient(user.userId);

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 flex-shrink-0 w-[72px]"
    >
      <div
        className={cn(
          'w-16 h-16 rounded-full p-[2.5px]',
          user.hasUnwatched
            ? 'bg-gradient-to-br from-neon-cyan via-neon-purple to-neon-pink'
            : 'bg-gray-700'
        )}
      >
        <div className="w-full h-full rounded-full bg-lattice-deep p-[2px]">
          <div
            className={cn(
              'w-full h-full rounded-full flex items-center justify-center text-white font-bold text-sm bg-gradient-to-br',
              gradient
            )}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              user.displayName.charAt(0).toUpperCase()
            )}
          </div>
        </div>
      </div>
      <span className="text-[10px] text-gray-400 truncate w-full text-center">
        {user.displayName}
      </span>
    </button>
  );
}

// ── Story Viewer (fullscreen overlay) ────────────────────────────────────────

function StoryViewer({
  users,
  initialUserIndex,
  onClose,
}: {
  users: UserStory[];
  initialUserIndex: number;
  onClose: () => void;
}) {
  const [userIdx, setUserIdx] = useState(initialUserIndex);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const currentUser = users[userIdx];
  const currentStory = currentUser?.stories[storyIdx];
  const storyDuration = (currentStory?.duration || 5) * 1000;

  const goNext = useCallback(() => {
    if (!currentUser) return;

    if (storyIdx < currentUser.stories.length - 1) {
      setStoryIdx((prev) => prev + 1);
      setProgress(0);
    } else if (userIdx < users.length - 1) {
      setUserIdx((prev) => prev + 1);
      setStoryIdx(0);
      setProgress(0);
    } else {
      onClose();
    }
  }, [currentUser, storyIdx, userIdx, users.length, onClose]);

  const goPrev = useCallback(() => {
    if (storyIdx > 0) {
      setStoryIdx((prev) => prev - 1);
      setProgress(0);
    } else if (userIdx > 0) {
      setUserIdx((prev) => prev - 1);
      setStoryIdx(0);
      setProgress(0);
    }
  }, [storyIdx, userIdx]);

  // Auto-advance timer
  useEffect(() => {
    startTimeRef.current = Date.now();
    setProgress(0);

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(elapsed / storyDuration, 1);
      setProgress(pct);

      if (pct >= 1) {
        clearInterval(interval);
        goNext();
      }
    }, 50);

    timerRef.current = interval;
    return () => clearInterval(interval);
  }, [userIdx, storyIdx, storyDuration, goNext]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev]);

  if (!currentUser || !currentStory) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black flex items-center justify-center"
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 text-white/70 hover:text-white transition-colors"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Nav arrows */}
      {(userIdx > 0 || storyIdx > 0) && (
        <button
          onClick={goPrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 text-white/50 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      {(userIdx < users.length - 1 || storyIdx < currentUser.stories.length - 1) && (
        <button
          onClick={goNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 text-white/50 hover:text-white transition-colors"
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Story content container */}
      <div className="relative w-full max-w-md h-[80vh] max-h-[700px] rounded-2xl overflow-hidden bg-lattice-deep">
        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 p-3">
          {currentUser.stories.map((_, idx) => (
            <div
              key={idx}
              className="flex-1 h-0.5 bg-white/20 rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-white rounded-full transition-[width] duration-75 ease-linear"
                style={{
                  width:
                    idx < storyIdx
                      ? '100%'
                      : idx === storyIdx
                        ? `${progress * 100}%`
                        : '0%',
                }}
              />
            </div>
          ))}
        </div>

        {/* User info */}
        <div className="absolute top-6 left-3 right-12 z-10 flex items-center gap-2">
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold bg-gradient-to-br',
              pickGradient(currentUser.userId)
            )}
          >
            {currentUser.avatarUrl ? (
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.displayName}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              currentUser.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <span className="text-sm text-white font-medium">{currentUser.displayName}</span>
        </div>

        {/* Story content */}
        <div
          className="w-full h-full flex items-center justify-center"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width / 3) goPrev();
            else goNext();
          }}
        >
          {currentStory.imageUrl ? (
            <img
              src={currentStory.imageUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : currentStory.content ? (
            <div className="p-8 text-center">
              <p className="text-white text-lg">{currentStory.content}</p>
            </div>
          ) : (
            <div className="text-gray-600 text-sm">No content</div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function StoriesBar({ currentUserId, onCreateStory, className }: StoriesBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUserIdx, setViewerUserIdx] = useState(0);

  const { data: stories, isLoading } = useQuery({
    queryKey: ['stories', currentUserId],
    queryFn: async () => {
      const res = await api.get('/api/social/stories', {
        params: { userId: currentUserId },
      });
      // Server returns a flat array of story posts; group them by userId into UserStory[]
      const rawStories: Record<string, unknown>[] = res.data?.stories || [];
      const grouped = new Map<string, UserStory>();
      for (const s of rawStories) {
        const uid = (s.userId as string) || 'unknown';
        if (!grouped.has(uid)) {
          grouped.set(uid, {
            userId: uid,
            displayName: (s.displayName as string) || (s.userId as string) || 'User',
            avatarUrl: s.avatarUrl as string | undefined,
            hasUnwatched: true,
            stories: [],
          });
        }
        grouped.get(uid)!.stories.push({
          storyId: (s.id as string) || `story-${Date.now()}`,
          imageUrl: s.mediaUrl as string | undefined,
          content: (s.content as string) || (s.title as string) || undefined,
          createdAt: (s.createdAt as string) || new Date().toISOString(),
          duration: (s.duration as number) || 5,
        });
      }
      return Array.from(grouped.values());
    },
    enabled: !!currentUserId,
  });

  const handleOpenStory = (index: number) => {
    setViewerUserIdx(index);
    setViewerOpen(true);
  };

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' });
  };

  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' });
  };

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-4', className)}>
        <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className={cn('relative', className)}>
        {/* Scroll buttons */}
        <button
          onClick={scrollLeft}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-lattice-surface/80 backdrop-blur-sm border border-lattice-border rounded-full text-gray-400 hover:text-white transition-colors hidden sm:block"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={scrollRight}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1 bg-lattice-surface/80 backdrop-blur-sm border border-lattice-border rounded-full text-gray-400 hover:text-white transition-colors hidden sm:block"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Scrollable bar */}
        <div
          ref={scrollRef}
          className="flex items-start gap-2 overflow-x-auto scrollbar-hide px-6 py-2"
        >
          {/* Your Story */}
          <button
            onClick={onCreateStory}
            className="flex flex-col items-center gap-1 flex-shrink-0 w-[72px]"
          >
            <div className="w-16 h-16 rounded-full bg-lattice-deep border-2 border-dashed border-gray-600 flex items-center justify-center hover:border-neon-cyan/50 transition-colors">
              <Plus className="w-6 h-6 text-gray-500" />
            </div>
            <span className="text-[10px] text-gray-500">Your Story</span>
          </button>

          {/* Other users' stories */}
          {(stories || []).map((user, idx) => (
            <StoryCircle
              key={user.userId}
              user={user}
              onClick={() => handleOpenStory(idx)}
            />
          ))}
        </div>
      </div>

      {/* Story Viewer overlay */}
      <AnimatePresence>
        {viewerOpen && stories && stories.length > 0 && (
          <StoryViewer
            users={stories}
            initialUserIndex={viewerUserIdx}
            onClose={() => setViewerOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default StoriesBar;

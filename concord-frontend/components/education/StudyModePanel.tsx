'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, BookMarked, Award, CheckCircle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { ds } from '@/lib/design-system';

export function StudyModePanel() {
  const queryClient = useQueryClient();
  const [showAnswer, setShowAnswer] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());

  const { data: srsData, isLoading } = useQuery({
    queryKey: ['srs-due'],
    queryFn: () => apiHelpers.srs.due().then(r => r.data),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ dtuId, quality }: { dtuId: string; quality: number }) =>
      apiHelpers.srs.review(dtuId, { quality }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['srs-due'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const cards = srsData?.due || srsData?.cards || [];
  const currentCard = cards[currentIndex];
  const remaining = cards.filter((c: { dtu?: { id?: string }; dtuId?: string }) => !reviewed.has(c.dtu?.id || c.dtuId || '')).length;
  const total = cards.length;
  const retentionRate = total > 0 ? Math.round(((total - remaining) / Math.max(total, 1)) * 100) : 0;

  const handleReview = (quality: number) => {
    if (!currentCard) return;
    const dtuId = currentCard.dtu?.id || currentCard.dtuId;
    reviewMutation.mutate({ dtuId, quality });
    setReviewed(prev => new Set([...prev, dtuId]));
    setShowAnswer(false);
    // Advance to next
    const next = cards.findIndex((c: { dtu?: { id?: string }; dtuId?: string }, i: number) =>
      i > currentIndex && !reviewed.has(c.dtu?.id || c.dtuId || '')
    );
    if (next !== -1) setCurrentIndex(next);
  };

  if (isLoading) {
    return (
      <section className="p-6">
        <div className="flex items-center gap-2 text-gray-400">
          <Clock className="w-5 h-5 animate-spin" />
          Loading study cards...
        </div>
      </section>
    );
  }

  return (
    <section className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookMarked className="w-6 h-6 text-neon-cyan" />
          <div>
            <h2 className="text-lg font-bold text-white">Spaced Repetition Study</h2>
            <p className="text-xs text-gray-400">SM-2 algorithm -- review DTUs at optimal intervals</p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg bg-lattice-surface border border-lattice-border text-center">
          <p className="text-2xl font-bold text-neon-cyan">{total}</p>
          <p className="text-xs text-gray-400">Cards Due</p>
        </div>
        <div className="p-4 rounded-lg bg-lattice-surface border border-lattice-border text-center">
          <p className="text-2xl font-bold text-green-400">{retentionRate}%</p>
          <p className="text-xs text-gray-400">Session Progress</p>
        </div>
        <div className="p-4 rounded-lg bg-lattice-surface border border-lattice-border text-center">
          <p className="text-2xl font-bold text-purple-400">{remaining}</p>
          <p className="text-xs text-gray-400">Remaining</p>
        </div>
      </div>

      {/* Card */}
      {total === 0 ? (
        <div className="text-center py-12">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white">All caught up!</h3>
          <p className="text-gray-400">No cards due for review. Add DTUs to SRS from other lenses.</p>
        </div>
      ) : remaining === 0 ? (
        <div className="text-center py-12">
          <Award className="w-12 h-12 text-neon-cyan mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white">Session Complete!</h3>
          <p className="text-gray-400">You reviewed {total} cards.</p>
        </div>
      ) : currentCard ? (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="h-1.5 bg-lattice-surface rounded-full overflow-hidden">
            <div className="h-full bg-neon-cyan transition-all duration-300 rounded-full"
              style={{ width: `${((total - remaining) / total) * 100}%` }} />
          </div>

          {/* Question card */}
          <div className="p-8 bg-lattice-surface border border-lattice-border rounded-xl text-center">
            <h3 className="text-xl font-bold text-white mb-2">
              {currentCard.dtu?.title || currentCard.title || 'Untitled'}
            </h3>
            {(currentCard.dtu?.tags || []).slice(0, 4).map((tag: string) => (
              <span key={tag} className="inline-block px-2 py-0.5 text-xs bg-lattice-bg rounded text-gray-400 mr-1">#{tag}</span>
            ))}
            <p className="text-xs text-gray-400 mt-3">
              Interval: {currentCard.card?.interval || currentCard.interval || 1}d
              {' '} | Ease: {(currentCard.card?.easeFactor || currentCard.easiness || 2.5).toFixed(2)}
              {' '} | Reps: {currentCard.card?.repetitions || currentCard.repetitions || 0}
            </p>
          </div>

          {!showAnswer ? (
            <button onClick={() => setShowAnswer(true)}
              className="w-full py-3 bg-neon-cyan/10 border border-neon-cyan/30 rounded-xl text-neon-cyan font-medium hover:bg-neon-cyan/20 transition-colors">
              Show Answer (Space)
            </button>
          ) : (
            <div className="space-y-3">
              {currentCard.dtu?.content && (
                <div className="p-4 bg-lattice-bg border border-lattice-border rounded-xl text-gray-300 text-sm whitespace-pre-wrap">
                  {currentCard.dtu.content}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { q: 1, label: 'Again', color: 'text-red-400' },
                  { q: 3, label: 'Good', color: 'text-green-400' },
                  { q: 5, label: 'Easy', color: 'text-neon-cyan' },
                ].map(opt => (
                  <button key={opt.q} onClick={() => handleReview(opt.q)}
                    className="p-3 bg-lattice-surface border border-lattice-border rounded-lg hover:border-gray-500 transition-colors">
                    <span className={`text-sm font-medium ${opt.color}`}>{opt.label}</span>
                    <span className="block text-xs text-gray-400 mt-1">({opt.q})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Concord Educational Engine — Panel Components
// Each panel calls the /api/learning/* endpoints for real data.


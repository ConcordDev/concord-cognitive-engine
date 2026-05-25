'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Meh,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SRSCard {
  dtu: {
    id: string;
    title: string;
    content?: string;
    tags: string[];
  };
  card: {
    interval: number;
    easeFactor: number;
    nextReview: string;
    repetitions: number;
  };
}

interface SRSReviewProps {
  cards: SRSCard[];
  onReview: (dtuId: string, quality: number) => void;
  onClose?: () => void;
  className?: string;
}

const QUALITY_OPTIONS = [
  { value: 0, label: 'Blackout', description: "Complete blank", icon: ThumbsDown, color: 'text-red-400' },
  { value: 1, label: 'Wrong', description: "Incorrect, but recognized", icon: ThumbsDown, color: 'text-red-400' },
  { value: 2, label: 'Hard', description: "Correct with difficulty", icon: Meh, color: 'text-yellow-400' },
  { value: 3, label: 'Good', description: "Correct with hesitation", icon: ThumbsUp, color: 'text-green-400' },
  { value: 4, label: 'Easy', description: "Correct with effort", icon: ThumbsUp, color: 'text-green-400' },
  { value: 5, label: 'Perfect', description: "Instant recall", icon: Sparkles, color: 'text-neon-cyan' }
];

export function SRSReview({ cards, onReview, onClose, className }: SRSReviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());

  const currentCard = cards[currentIndex];
  const remaining = cards.filter(c => !reviewed.has(c.dtu.id)).length;
  const progress = ((cards.length - remaining) / cards.length) * 100;

  const handleReview = useCallback((quality: number) => {
    if (!currentCard) return;

    onReview(currentCard.dtu.id, quality);
    setReviewed(prev => new Set([...prev, currentCard.dtu.id]));
    setShowAnswer(false);

    // Move to next unreviewed card
    const nextUnreviewed = cards.findIndex((c, i) => i > currentIndex && !reviewed.has(c.dtu.id));
    if (nextUnreviewed !== -1) {
      setCurrentIndex(nextUnreviewed);
    } else {
      const firstUnreviewed = cards.findIndex(c => !reviewed.has(c.dtu.id) && c.dtu.id !== currentCard.dtu.id);
      if (firstUnreviewed !== -1) {
        setCurrentIndex(firstUnreviewed);
      }
    }
  }, [currentCard, currentIndex, cards, reviewed, onReview]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!showAnswer) {
        setShowAnswer(true);
      }
    } else if (showAnswer) {
      const num = parseInt(e.key);
      if (num >= 0 && num <= 5) {
        handleReview(num);
      }
    } else if (e.key === 'Escape' && onClose) {
      onClose();
    }
  }, [showAnswer, handleReview, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (cards.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-16', className)}>
        <Brain className="w-16 h-16 text-green-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">All caught up!</h2>
        <p className="text-gray-400">No cards due for review</p>
      </div>
    );
  }

  if (remaining === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-16', className)}>
        <Sparkles className="w-16 h-16 text-neon-cyan mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Session Complete!</h2>
        <p className="text-gray-400 mb-6">You reviewed {cards.length} cards</p>
        {onClose && (
          <button
            onClick={onClose}
            className="px-6 py-2 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors"
          >
            Done
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Progress bar */}
      <div className="h-1 bg-lattice-surface">
        <div
          className="h-full bg-neon-cyan transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <div className="px-4 py-3 border-b border-lattice-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-neon-cyan" />
          <span className="font-medium text-white">Spaced Repetition</span>
        </div>
        <div className="text-sm text-gray-400">
          {remaining} remaining
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentCard.dtu.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-2xl"
          >
            {/* Question (title) */}
            <div className="bg-lattice-surface border border-lattice-border rounded-xl p-8 mb-6">
              <h2 className="text-2xl font-bold text-white text-center mb-4">
                {currentCard.dtu.title}
              </h2>

              {/* Tags */}
              {currentCard.dtu.tags.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2">
                  {currentCard.dtu.tags.slice(0, 5).map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-1 text-xs bg-lattice-bg rounded text-gray-400"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Show/Hide Answer */}
            {!showAnswer ? (
              <button
                onClick={() => setShowAnswer(true)}
                className="w-full py-4 bg-neon-cyan/10 border border-neon-cyan/30 rounded-xl text-neon-cyan font-medium hover:bg-neon-cyan/20 transition-colors"
              >
                <Eye className="w-5 h-5 inline mr-2" />
                Show Answer (Space)
              </button>
            ) : (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-6"
              >
                {/* Answer (content) */}
                {currentCard.dtu.content && (
                  <div className="bg-lattice-bg border border-lattice-border rounded-xl p-6">
                    <p className="text-gray-300 whitespace-pre-wrap">
                      {currentCard.dtu.content}
                    </p>
                  </div>
                )}

                {/* Quality buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {QUALITY_OPTIONS.map(opt => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => handleReview(opt.value)}
                        className="p-3 bg-lattice-surface border border-lattice-border rounded-lg hover:border-gray-500 transition-colors group"
                      >
                        <div className="flex flex-col items-center gap-1">
                          <Icon className={cn('w-5 h-5', opt.color)} />
                          <span className="text-sm text-white">{opt.label}</span>
                          <span className="text-xs text-gray-400">{opt.value}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="text-center text-xs text-gray-400">
                  Press 0-5 to rate your recall
                </p>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer with card info */}
      <div className="px-4 py-3 border-t border-lattice-border text-xs text-gray-400 flex items-center justify-between">
        <span>
          Interval: {currentCard.card.interval} days
        </span>
        <span>
          Repetitions: {currentCard.card.repetitions}
        </span>
        <span>
          Ease: {currentCard.card.easeFactor.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

'use client';

/**
 * AnswerCard
 *
 * Renders one "hard problem → STSVK/Concord answer" pair in the Answers lens.
 *
 *   - Problem title (the hard question) with a section icon
 *   - Short answer title (e.g. "Self-Constraining Fixed Points")
 *   - Expandable detailed answer (framer-motion)
 *   - Optional equation rendered via <EquationDisplay>
 *   - Linked Concord module implementations
 *   - "Ask Oracle" button that navigates to /lenses/chat with the question
 *     pre-filled as a `q` URL param.
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  MessageCircleQuestion,
  Code2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EquationDisplay } from './EquationDisplay';

export type AnswerSection =
  | 'physics'
  | 'mathematics'
  | 'computation'
  | 'knowledge'
  | 'trust'
  | 'systems'
  | 'consciousness'
  | 'meta';

export interface AnswerEntry {
  /** Short slug — stable id used for React keys, DTU lookups, etc. */
  id: string;
  /** Which section this answer belongs to. */
  section: AnswerSection;
  /** The hard problem posed as a question. */
  problem: string;
  /** The short answer title (1-5 words, headline form). */
  title: string;
  /** Longer prose answer, shown when the card is expanded. */
  detail: string;
  /** Optional equation string (e.g. "x² - x = 0"). */
  equation?: string;
  /** Optional solution-set hint (e.g. "x ∈ {0, 1}"). */
  solution?: string;
  /** Concord modules / files that implement this answer. */
  modules?: string[];
}

export interface AnswerCardProps {
  entry: AnswerEntry;
  /** Icon for the section (supplied by the page so we don't duplicate mapping). */
  icon: LucideIcon;
  /** Accent color token, e.g. 'neon-cyan' | 'neon-purple' | 'neon-pink'. */
  accent?: string;
  /** Index for staggered motion. */
  index?: number;
}

export function AnswerCard({
  entry,
  icon: Icon,
  accent = 'neon-cyan',
  index = 0,
}: AnswerCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const handleAskOracle = useCallback(() => {
    const query = `About "${entry.title}" — ${entry.problem}`;
    router.push(`/lenses/chat?q=${encodeURIComponent(query)}`);
  }, [router, entry.problem, entry.title]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03 }}
      className={cn(
        'group relative rounded-xl border border-lattice-border bg-lattice-surface',
        'p-4 shadow-lattice-sm transition-colors',
        'hover:border-white/15',
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left flex items-start gap-3"
        aria-expanded={expanded}
      >
        <div
          className={cn(
            'mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
            `bg-${accent}/10 border border-${accent}/30`,
          )}
        >
          <Icon className={cn('h-4 w-4', `text-${accent}`)} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">
            Hard Problem
          </p>
          <h3 className="text-sm font-medium text-gray-200 leading-snug">
            {entry.problem}
          </h3>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold',
                `bg-${accent}/15 text-${accent}`,
              )}
            >
              {entry.title}
            </span>
            {entry.equation && (
              <code className="font-mono text-xs text-neon-cyan/80">
                {entry.equation}
              </code>
            )}
          </div>
        </div>

        <ChevronDown
          className={cn(
            'h-4 w-4 flex-shrink-0 text-gray-400 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="pt-4 mt-3 border-t border-lattice-border space-y-4">
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                {entry.detail}
              </p>

              {entry.equation && (
                <EquationDisplay
                  equation={entry.equation}
                  solution={entry.solution}
                  label="Governing Form"
                  size="md"
                />
              )}

              {entry.modules && entry.modules.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5">
                    <Code2 className="h-3 w-3" />
                    Concord Implementations
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {entry.modules.map((mod) => (
                      <li key={mod}>
                        <code className="inline-block font-mono text-xs text-neon-purple/90 bg-lattice-elevated border border-lattice-border rounded px-2 py-1">
                          {mod}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAskOracle}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium',
                    'bg-neon-pink/15 text-neon-pink border border-neon-pink/40',
                    'hover:bg-neon-pink/25 transition-colors',
                  )}
                >
                  <MessageCircleQuestion className="h-4 w-4" />
                  Ask the Oracle about this
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

export default AnswerCard;

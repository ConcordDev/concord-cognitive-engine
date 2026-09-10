'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Hash, Moon, Music, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PoemForm = 'free-verse' | 'sonnet' | 'haiku' | 'limerick' | 'villanelle' | 'ballad' | 'ode' | 'elegy' | 'acrostic' | 'other';

// Backed by the real poetry.poem-* macros (server/domains/poetry.js) —
// STATE.poetryLens.poems, the same per-user notebook substrate the
// PoetryWorkshop / PoetryStudio / PoetryDiscovery panels read from.
// poem-list's response shape still omits body text (list vs. detail
// separation, keeps the endpoint cheap); poem-detail carries the full
// `body`. poem-list DOES accept a `query` param that searches server-side
// across both title and body — the body is only ever read in memory to
// decide inclusion, never returned in the list response.
export interface PoemMeta {
  id: string;
  title: string;
  form: PoemForm;
  status: 'draft' | 'revising' | 'finished';
  lineCount: number;
  updatedAt: string;
}
export interface PoemDetail {
  id: string;
  title: string;
  body: string;
  form: PoemForm;
  status: 'draft' | 'revising' | 'finished';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export const POEM_STATUSES: PoemDetail['status'][] = ['draft', 'revising', 'finished'];

export const POEM_FORMS: { id: PoemForm; label: string; description: string }[] = [
  { id: 'free-verse', label: 'Free Verse', description: 'No fixed structure, pure expression' },
  { id: 'sonnet', label: 'Sonnet', description: '14 lines, iambic pentameter' },
  { id: 'haiku', label: 'Haiku', description: '5-7-5 syllable structure' },
  { id: 'limerick', label: 'Limerick', description: '5 lines, AABBA rhyme scheme' },
  { id: 'villanelle', label: 'Villanelle', description: '19 lines, two refrains' },
  { id: 'ballad', label: 'Ballad', description: 'Narrative verse, ABAB rhyme' },
  { id: 'ode', label: 'Ode', description: 'Lyric poem of praise' },
  { id: 'elegy', label: 'Elegy', description: 'Poem of mourning or reflection' },
  { id: 'acrostic', label: 'Acrostic', description: 'First letters spell a word' },
  { id: 'other', label: 'Other', description: 'Experimental or hybrid form' },
];

/* ------------------------------------------------------------------ */
/*  Syllable counter (approximate)                                     */
/* ------------------------------------------------------------------ */

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

function countLineSyllables(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).reduce((sum, w) => sum + countSyllables(w), 0);
}

/* ------------------------------------------------------------------ */
/*  Rhyme scheme detector                                              */
/* ------------------------------------------------------------------ */

function getEndSound(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  return w.slice(-3);
}

function detectRhymeScheme(lines: string[]): string {
  const endings = lines.map(l => {
    const words = l.trim().split(/\s+/).filter(Boolean);
    return words.length > 0 ? getEndSound(words[words.length - 1]) : '';
  });
  const letterMap: Record<string, string> = {};
  let nextLetter = 65; // 'A'
  return endings.map(end => {
    if (!end) return '-';
    if (!(end in letterMap)) {
      letterMap[end] = String.fromCharCode(nextLetter++);
    }
    return letterMap[end];
  }).join('');
}

/* ------------------------------------------------------------------ */
/*  Poem templates                                                     */
/* ------------------------------------------------------------------ */

export const POEM_TEMPLATES: Record<string, { title: string; placeholder: string; hint: string }> = {
  haiku: {
    title: 'Haiku Template',
    placeholder: 'old pond —\na frog jumps in,\nsound of water',
    hint: 'Line 1: 5 syllables • Line 2: 7 syllables • Line 3: 5 syllables',
  },
  sonnet: {
    title: 'Sonnet Template',
    placeholder: 'Shall I compare thee to a summer\'s day?\nThou art more lovely and more temperate:\n...',
    hint: '14 lines • Iambic pentameter • ABAB CDCD EFEF GG rhyme scheme',
  },
  limerick: {
    title: 'Limerick Template',
    placeholder: 'There once was a man from Nantucket\nWho kept all his cash in a bucket.\n    But his daughter, named Nan,\n    Ran away with a man\nAnd as for the bucket, Nantucket.',
    hint: '5 lines • AABBA rhyme • Lines 1,2,5 are longer; 3,4 shorter',
  },
  'free-verse': {
    title: 'Free Verse',
    placeholder: 'Write freely — no rules, pure expression.',
    hint: 'No fixed meter or rhyme — let the words flow',
  },
};

/* ------------------------------------------------------------------ */
/*  Syllable & Rhyme Panel                                             */
/* ------------------------------------------------------------------ */

export function SyllableRhymePanel({ content, form }: { content: string; form: string }) {
  const lines = useMemo(() => content.split('\n'), [content]);
  const nonEmptyLines = useMemo(() => lines.filter(l => l.trim()), [lines]);
  const syllableCounts = useMemo(() => lines.map(l => countLineSyllables(l)), [lines]);
  const rhymeScheme = useMemo(() => detectRhymeScheme(nonEmptyLines), [nonEmptyLines]);
  const totalSyllables = syllableCounts.reduce((a, b) => a + b, 0);

  const haikuValid = useMemo(() => {
    if (form !== 'haiku') return null;
    const counts = nonEmptyLines.slice(0, 3).map(l => countLineSyllables(l));
    return counts[0] === 5 && counts[1] === 7 && counts[2] === 5;
  }, [form, nonEmptyLines]);

  return (
    <div className="space-y-4 p-4 bg-white/3 rounded-lg border border-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-rose-400" />
          <span className="text-sm font-medium">Analysis</span>
        </div>
        <span className="text-xs text-gray-400">{totalSyllables} total syllables</span>
      </div>

      {/* Per-line syllable breakdown */}
      {lines.length > 0 && lines.some(l => l.trim()) && (
        <div className="space-y-1">
          <p className="text-xs text-gray-400 mb-2">Syllables per line:</p>
          {lines.map((line, i) => {
            if (!line.trim()) return null;
            const count = syllableCounts[i];
            const isHaikuTarget = form === 'haiku' && [5, 7, 5][nonEmptyLines.indexOf(line)] !== undefined;
            const target = form === 'haiku' ? [5, 7, 5][nonEmptyLines.indexOf(line)] : null;
            return (
              <div key={i} className={cn("flex items-center gap-2", isHaikuTarget && "bg-rose-500/5 rounded px-1 -mx-1")}>
                <span className="text-xs text-gray-400 w-16 truncate">{line.slice(0, 12)}…</span>
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', count > 0 ? 'bg-rose-400/60' : '')}
                    style={{ width: `${Math.min(100, count * 6)}%` }} />
                </div>
                <span className={cn('text-xs w-6 text-right font-mono',
                  target !== null ? (count === target ? 'text-green-400' : 'text-red-400') : 'text-gray-400')}>
                  {count}
                </span>
                {target !== null && <span className="text-xs text-gray-400">/{target}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Rhyme scheme */}
      {nonEmptyLines.length >= 2 && (
        <div>
          <p className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Music className="w-3 h-3" /> Rhyme Scheme:</p>
          <div className="flex flex-wrap gap-1">
            {rhymeScheme.split('').map((letter, i) => (
              <span key={i} className={cn('w-6 h-6 rounded flex items-center justify-center text-xs font-bold',
                letter === '-' ? 'bg-white/5 text-gray-600' :
                letter === 'A' ? 'bg-rose-500/20 text-rose-300' :
                letter === 'B' ? 'bg-purple-500/20 text-purple-300' :
                letter === 'C' ? 'bg-blue-500/20 text-blue-300' :
                letter === 'D' ? 'bg-green-500/20 text-green-300' :
                'bg-amber-500/20 text-amber-300'
              )}>{letter}</span>
            ))}
          </div>
        </div>
      )}

      {/* Haiku validity */}
      {form === 'haiku' && haikuValid !== null && (
        <div className={cn('text-xs px-2 py-1 rounded flex items-center gap-1',
          haikuValid ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {haikuValid ? '✓ Valid haiku (5-7-5)' : '✗ Haiku needs 5-7-5 syllables'}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reading Mode                                                       */
/* ------------------------------------------------------------------ */

export function ReadingMode({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-8"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="max-w-2xl w-full bg-gradient-to-b from-stone-950 to-black border border-rose-900/20 rounded-2xl p-12 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-8">
          <Moon className="w-5 h-5 text-rose-300/60" />
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {title && (
          <h2 className="text-2xl font-serif italic text-rose-100 text-center mb-8 tracking-wide">{title}</h2>
        )}
        <pre className="font-serif text-lg leading-[2.2] text-gray-200 whitespace-pre-wrap text-center tracking-wide">
          {content || '(empty)'}
        </pre>
        <div className="mt-10 text-center">
          <div className="inline-block w-12 h-px bg-rose-900/40" />
        </div>
      </motion.div>
    </motion.div>
  );
}

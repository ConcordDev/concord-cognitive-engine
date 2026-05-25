'use client';

import { useState } from 'react';
import { Sparkles, Loader2, Check, X, FileText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface QuizCard {
  front: string;
  back: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

interface QuizGeneratorProps {
  /** Optional pre-filled source text (e.g. open DTU content). */
  initialSource?: string;
  /** Optional DTU id — when set, the backend uses dtu-specific context. */
  sourceDtuId?: string;
  /** Called after the deck is created so the parent can switch the user to it. */
  onDeckCreated?: (deckId: string) => void;
}

export function QuizGenerator({ initialSource = '', sourceDtuId, onDeckCreated }: QuizGeneratorProps) {
  const [source, setSource] = useState(initialSource);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [generating, setGenerating] = useState(false);
  const [cards, setCards] = useState<QuizCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deckTitle, setDeckTitle] = useState('');
  const [creatingDeck, setCreatingDeck] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  async function generate() {
    if (!source.trim() && !sourceDtuId) {
      setError('Paste some notes or pick a DTU to generate from.');
      return;
    }
    setError(null); setGenerating(true); setCards([]); setExcluded(new Set());
    try {
      const res = await lensRun({
        domain: 'education',
        action: 'quiz-from-text',
        input: { source, sourceDtuId, count, difficulty },
      });
      const items = (res.data?.result?.cards || []) as QuizCard[];
      setCards(items);
      if (items.length === 0) setError('No cards generated. Try different source or count.');
      if (!deckTitle) {
        const preview = source.split('\n').find(l => l.trim().length > 0)?.slice(0, 50) || 'Generated quiz';
        setDeckTitle(`Quiz: ${preview}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generate failed');
    } finally { setGenerating(false); }
  }

  async function createDeck() {
    if (cards.length === 0) return;
    setCreatingDeck(true);
    try {
      const accepted = cards.filter((_, i) => !excluded.has(i));
      const res = await lensRun({
        domain: 'education',
        action: 'quiz-mint-deck',
        input: { title: deckTitle || 'Generated quiz', cards: accepted },
      });
      const deckId = res.data?.result?.deck?.id;
      if (deckId) onDeckCreated?.(deckId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'mint failed');
    } finally { setCreatingDeck(false); }
  }

  function toggle(i: number) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  const acceptedCount = cards.length - excluded.size;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Quiz generator</span>
        <span className="ml-auto text-[10px] text-gray-400">Quizlet Magic Notes parity</span>
      </header>
      <div className="p-4 space-y-3">
        {!sourceDtuId && (
          <textarea
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="Paste notes, lecture text, or any source material. The utility brain will mint study cards from it."
            rows={6}
            className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white resize-y"
          />
        )}
        {sourceDtuId && (
          <div className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded p-2 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> Source: DTU {sourceDtuId.slice(0, 12)}…
          </div>
        )}
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-gray-400">Cards</span>
            <input
              type="number" min={1} max={30}
              value={count}
              onChange={e => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 10)))}
              className="w-16 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-gray-400">Difficulty</span>
            <select
              value={difficulty}
              onChange={e => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard' | 'mixed')}
              className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <button
            onClick={generate}
            disabled={generating}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Generate
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
        {cards.length > 0 && (
          <>
            <div className="flex items-center gap-2 pt-2 border-t border-white/10">
              <input
                value={deckTitle}
                onChange={e => setDeckTitle(e.target.value)}
                placeholder="Deck title"
                className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
              <button
                onClick={createDeck}
                disabled={creatingDeck || acceptedCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-green-500 text-black font-bold hover:bg-green-400 disabled:opacity-50"
              >
                {creatingDeck ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Add {acceptedCount} to deck
              </button>
            </div>
            <ul className="space-y-1.5 max-h-96 overflow-y-auto">
              {cards.map((c, i) => {
                const isExcluded = excluded.has(i);
                return (
                  <li key={i} className={cn(
                    'p-2 rounded border flex items-start gap-2',
                    isExcluded ? 'bg-red-500/[0.05] border-red-500/20 opacity-60' : 'bg-white/[0.02] border-white/10'
                  )}>
                    <button
                      onClick={() => toggle(i)}
                      title={isExcluded ? 'Include' : 'Exclude'}
                      className={cn('mt-0.5 p-1 rounded text-xs', isExcluded ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300')}
                    >
                      {isExcluded ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">Q{i + 1}</span>
                        <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-bold uppercase',
                          c.difficulty === 'easy' ? 'bg-green-500/20 text-green-300' :
                          c.difficulty === 'hard' ? 'bg-orange-500/20 text-orange-300' :
                          'bg-yellow-500/20 text-yellow-300'
                        )}>{c.difficulty}</span>
                      </div>
                      <div className="text-sm text-white">{c.front}</div>
                      <div className="text-xs text-cyan-200 mt-1 italic">{c.back}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default QuizGenerator;

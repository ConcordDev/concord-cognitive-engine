'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Plus, Loader2, RotateCcw, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  ease: number;
  interval: number;
  repetitions: number;
  dueAt: string;
  scheduler: 'sm2' | 'fsrs';
  lastReviewedAt?: string;
}

export interface Deck {
  id: string;
  title: string;
  count: number;
  due: number;
}

interface FlashcardDeckProps {
  /** When set, the deck is preselected and review mode opens immediately. */
  initialDeckId?: string;
}

export function FlashcardDeck({ initialDeckId }: FlashcardDeckProps) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeck, setActiveDeck] = useState<string | null>(initialDeckId || null);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');

  useEffect(() => { refreshDecks(); }, []);
  useEffect(() => { if (activeDeck) refreshQueue(activeDeck); }, [activeDeck]);

  async function refreshDecks() {
    try {
      const res = await lensRun({
        domain: 'education', action: 'flashcards-decks', input: {},
      });
      setDecks((res.data?.result?.decks || []) as Deck[]);
    } catch (e) { console.error('[Flashcards] decks failed', e); }
  }

  async function refreshQueue(deckId: string) {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'education', action: 'flashcards-due', input: { deckId, limit: 30 },
      });
      setQueue((res.data?.result?.cards || []) as Flashcard[]);
      setIdx(0); setShowAnswer(false);
    } catch (e) { console.error('[Flashcards] queue failed', e); }
    finally { setLoading(false); }
  }

  async function createDeck() {
    if (!newDeckTitle.trim()) return;
    try {
      const res = await lensRun({
        domain: 'education', action: 'flashcards-deck-create',
        input: { title: newDeckTitle.trim() },
      });
      const id = res.data?.result?.deck?.id;
      setNewDeckTitle('');
      await refreshDecks();
      if (id) setActiveDeck(id);
    } catch (e) { console.error('[Flashcards] create deck failed', e); }
  }

  async function createCard() {
    if (!activeDeck || !newFront.trim() || !newBack.trim()) return;
    try {
      await lensRun({
        domain: 'education', action: 'flashcards-card-create',
        input: { deckId: activeDeck, front: newFront, back: newBack },
      });
      setNewFront(''); setNewBack(''); setCreating(false);
      await refreshDecks(); await refreshQueue(activeDeck);
    } catch (e) { console.error('[Flashcards] create card failed', e); }
  }

  async function reviewCard(quality: 0 | 1 | 2 | 3 | 4 | 5) {
    const card = queue[idx];
    if (!card) return;
    try {
      await lensRun({
        domain: 'education', action: 'flashcards-review',
        input: { cardId: card.id, quality },
      });
      // Advance to next card
      if (idx + 1 < queue.length) {
        setIdx(idx + 1); setShowAnswer(false);
      } else {
        // Reload due queue (some cards may have been re-scheduled to today)
        if (activeDeck) await refreshQueue(activeDeck);
      }
    } catch (e) { console.error('[Flashcards] review failed', e); }
  }

  const card = queue[idx];
  const deck = decks.find(d => d.id === activeDeck);

  const stats = useMemo(() => {
    if (!queue.length) return null;
    const reviewed = idx;
    return {
      reviewed,
      remaining: queue.length - idx,
      progressPct: Math.round((reviewed / queue.length) * 100),
    };
  }, [queue, idx]);

  if (!activeDeck) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Decks</span>
          <span className="ml-auto text-[10px] text-gray-400">{decks.length}</span>
        </header>
        <div className="p-3 border-b border-white/10 flex items-center gap-2">
          <input
            value={newDeckTitle}
            onChange={e => setNewDeckTitle(e.target.value)}
            placeholder="New deck name…"
            className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            onKeyDown={(e) => { if (e.key === 'Enter') createDeck(); }}
          />
          <button
            onClick={createDeck}
            className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400"
          >
            <Plus className="w-3 h-3 inline" /> Deck
          </button>
        </div>
        {decks.length === 0 ? (
          <div className="px-3 py-8 text-xs text-gray-400 text-center">
            No decks yet. Create one above, or generate from any DTU via the Quiz tab.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {decks.map(d => (
              <li key={d.id}>
                <button
                  onClick={() => setActiveDeck(d.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] flex items-center gap-3"
                >
                  <div className="flex-1">
                    <div className="text-sm text-white">{d.title}</div>
                    <div className="text-[10px] text-gray-400">{d.count} cards · {d.due} due today</div>
                  </div>
                  {d.due > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">
                      {d.due}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <button
          onClick={() => { setActiveDeck(null); setQueue([]); }}
          className="p-1 text-gray-400 hover:text-white"
          aria-label="Back to decks"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <Sparkles className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-bold text-white">{deck?.title || 'Deck'}</span>
        <span className="ml-auto text-[10px] text-gray-400">{deck?.count || 0} cards · {queue.length} in queue</span>
        <button
          onClick={() => setCreating(v => !v)}
          title="Add card"
          className="p-1 text-gray-400 hover:text-white"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={() => activeDeck && refreshQueue(activeDeck)}
          title="Reload queue"
          className="p-1 text-gray-400 hover:text-white"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 space-y-2">
          <input
            value={newFront}
            onChange={e => setNewFront(e.target.value)}
            placeholder="Front (prompt)"
            className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <textarea
            value={newBack}
            onChange={e => setNewBack(e.target.value)}
            placeholder="Back (answer)"
            rows={3}
            className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={createCard}
              disabled={!newFront.trim() || !newBack.trim()}
              className="px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
            >Add card</button>
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-1 text-xs rounded border border-white/10 text-gray-400 hover:text-white"
            >Cancel</button>
          </div>
        </div>
      )}

      <div className="p-4 min-h-[320px] flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading queue…
          </div>
        ) : !card ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 gap-2">
            <BarChart3 className="w-8 h-8 opacity-30" />
            <p className="text-sm">Inbox zero! No cards due.</p>
            <p className="text-xs">Add new cards or come back later for spaced-repetition reviews.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400 mb-2">
              <span>Card {idx + 1} of {queue.length}</span>
              <span>Interval: {card.interval}d · ease {card.ease.toFixed(2)} · reps {card.repetitions}</span>
            </div>
            <div className="bg-white/[0.03] border border-white/10 rounded-lg p-6 flex-1 flex flex-col">
              <div className="flex-1 flex items-center justify-center text-center">
                <div>
                  <div className="text-lg text-white whitespace-pre-wrap">{card.front}</div>
                  {showAnswer && (
                    <div className="mt-4 pt-4 border-t border-white/10 text-base text-cyan-200 whitespace-pre-wrap">
                      {card.back}
                    </div>
                  )}
                </div>
              </div>
              {!showAnswer ? (
                <button
                  onClick={() => setShowAnswer(true)}
                  className="mt-4 px-4 py-2 rounded-lg bg-cyan-500 text-black font-bold hover:bg-cyan-400"
                >
                  Show answer (space)
                </button>
              ) : (
                <div className="mt-4 grid grid-cols-4 gap-2">
                  <RatingBtn label="Again" sub="<1m" color="red" onClick={() => reviewCard(0)} />
                  <RatingBtn label="Hard" sub="~1d" color="orange" onClick={() => reviewCard(2)} />
                  <RatingBtn label="Good" sub={`${Math.round(card.interval * 2)}d`} color="cyan" onClick={() => reviewCard(4)} />
                  <RatingBtn label="Easy" sub={`${Math.round(card.interval * 4)}d`} color="green" onClick={() => reviewCard(5)} />
                </div>
              )}
            </div>
          </>
        )}
        {stats && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-green-400 transition-all" style={{ width: `${stats.progressPct}%` }} />
            </div>
            <span className="text-[10px] text-gray-400 font-mono">{stats.reviewed}/{queue.length}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RatingBtn({ label, sub, color, onClick }: { label: string; sub: string; color: 'red' | 'orange' | 'cyan' | 'green'; onClick: () => void }) {
  const palette: Record<typeof color, string> = {
    red: 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/40',
    orange: 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border-orange-500/40',
    cyan: 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border-cyan-500/40',
    green: 'bg-green-500/20 hover:bg-green-500/30 text-green-300 border-green-500/40',
  };
  return (
    <button
      onClick={onClick}
      className={cn('flex flex-col items-center py-2 rounded border font-bold transition-colors', palette[color])}
    >
      <span className="text-sm">{label}</span>
      <span className="text-[9px] text-white/60 mt-0.5">{sub}</span>
    </button>
  );
}

export default FlashcardDeck;

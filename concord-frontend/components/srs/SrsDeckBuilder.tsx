'use client';

/**
 * SrsDeckBuilder — Anki 2026-shape custom deck workbench: create decks,
 * add cards, run a study session with modern-SM-2 ratings, and view a
 * 14-day review heatmap. Wires the srs.deck-*, srs.card-*, srs.study-*
 * macros. Complements the DTU-based SRS review above it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Layers, Plus, Trash2, GraduationCap, RotateCcw, Loader2, BarChart3 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Deck { id: string; name: string; cardCount: number; newCount: number; dueCount: number; studyCount: number }
interface Card { id: string; deckId: string; front: string; back: string; tags: string[]; state: string; reps: number; interval: number }
interface Stats { totalReviews: number; accuracy: number; last14Days: { date: string; count: number }[]; ratingBreakdown: Record<string, number> }

const RATINGS: { id: string; label: string; cls: string }[] = [
  { id: 'again', label: 'Again', cls: 'bg-rose-600 hover:bg-rose-500' },
  { id: 'hard', label: 'Hard', cls: 'bg-amber-600 hover:bg-amber-500' },
  { id: 'good', label: 'Good', cls: 'bg-emerald-600 hover:bg-emerald-500' },
  { id: 'easy', label: 'Easy', cls: 'bg-sky-600 hover:bg-sky-500' },
];

export function SrsDeckBuilder() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [mode, setMode] = useState<'cards' | 'study' | 'stats'>('cards');
  const [studyCard, setStudyCard] = useState<Card | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [newDeck, setNewDeck] = useState('');
  const [nf, setNf] = useState({ front: '', back: '', tags: '' });

  const refreshDecks = useCallback(async () => {
    const r = await lensRun('srs', 'deck-list', {});
    setDecks((r.data?.result?.decks as Deck[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refreshDecks(); }, [refreshDecks]);

  const loadCards = useCallback(async (deckId: string) => {
    const r = await lensRun('srs', 'card-list', { deckId });
    setCards((r.data?.result?.cards as Card[]) || []);
  }, []);
  useEffect(() => { if (active) void loadCards(active); }, [active, loadCards]);

  async function createDeck() {
    if (!newDeck.trim()) return;
    const r = await lensRun('srs', 'deck-create', { name: newDeck.trim() });
    setNewDeck('');
    await refreshDecks();
    if (r.data?.ok) setActive(r.data.result?.deck.id);
  }
  async function deleteDeck(id: string) {
    if (!confirm('Delete this deck and all its cards?')) return;
    await lensRun('srs', 'deck-delete', { id });
    if (active === id) { setActive(null); setCards([]); }
    await refreshDecks();
  }
  async function addCard() {
    if (!active || !nf.front.trim() || !nf.back.trim()) return;
    await lensRun('srs', 'card-add', {
      deckId: active, front: nf.front.trim(), back: nf.back.trim(),
      tags: nf.tags.split(',').map(t => t.trim()).filter(Boolean),
    });
    setNf({ front: '', back: '', tags: '' });
    await loadCards(active);
    await refreshDecks();
  }
  async function deleteCard(id: string) {
    await lensRun('srs', 'card-delete', { id });
    if (active) { await loadCards(active); await refreshDecks(); }
  }

  async function startStudy() {
    if (!active) return;
    setMode('study'); setRevealed(false);
    const r = await lensRun('srs', 'study-next', { deckId: active });
    setStudyCard((r.data?.result?.card as Card) || null);
    setRemaining(r.data?.result?.remaining || 0);
  }
  async function rate(rating: string) {
    if (!studyCard || !active) return;
    await lensRun('srs', 'study-answer', { cardId: studyCard.id, rating });
    setRevealed(false);
    const r = await lensRun('srs', 'study-next', { deckId: active });
    setStudyCard((r.data?.result?.card as Card) || null);
    setRemaining(r.data?.result?.remaining || 0);
    await refreshDecks();
  }
  async function openStats() {
    if (!active) return;
    setMode('stats');
    const r = await lensRun('srs', 'study-stats', { deckId: active });
    setStats((r.data?.result as Stats) || null);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const activeDeck = decks.find(d => d.id === active);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-bold text-zinc-100">Flashcard Decks</h3>
        <span className="text-[11px] text-zinc-500">Anki shape</span>
      </div>

      <div className="grid sm:grid-cols-[200px_1fr] gap-3">
        {/* Decks */}
        <div>
          <ul className="space-y-1 mb-2">
            {decks.map(d => (
              <li key={d.id} className="group flex items-center gap-1">
                <button onClick={() => { setActive(d.id); setMode('cards'); }}
                  className={cn('flex-1 text-left rounded-lg px-2.5 py-2 border', active === d.id ? 'bg-purple-600/15 border-purple-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                  <p className="text-xs font-semibold text-zinc-100 truncate">{d.name}</p>
                  <p className="text-[10px] text-zinc-500">
                    {d.cardCount} cards · <span className="text-sky-400">{d.newCount} new</span> · <span className="text-emerald-400">{d.dueCount} due</span>
                  </p>
                </button>
                <button onClick={() => deleteDeck(d.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1">
            <input value={newDeck} onChange={e => setNewDeck(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createDeck(); }}
              placeholder="New deck" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <button onClick={createDeck} className="px-2 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {/* Detail */}
        {activeDeck ? (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-bold text-zinc-100 flex-1 truncate">{activeDeck.name}</h4>
              <button onClick={startStudy} disabled={activeDeck.studyCount === 0}
                className="px-2.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 inline-flex items-center gap-1">
                <GraduationCap className="w-3 h-3" />Study ({activeDeck.studyCount})
              </button>
              <button onClick={() => setMode('cards')} className={cn('px-2 py-1 text-xs rounded', mode === 'cards' ? 'bg-zinc-700 text-white' : 'text-zinc-400')}>Cards</button>
              <button onClick={openStats} className={cn('px-2 py-1 text-xs rounded inline-flex items-center gap-1', mode === 'stats' ? 'bg-zinc-700 text-white' : 'text-zinc-400')}>
                <BarChart3 className="w-3 h-3" />Stats
              </button>
            </div>

            {mode === 'study' && (
              <div className="text-center py-4">
                {studyCard ? (
                  <>
                    <p className="text-[10px] text-zinc-500 mb-2">{remaining} left</p>
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-6 mb-3">
                      <p className="text-base text-zinc-100">{studyCard.front}</p>
                      {revealed && <p className="text-sm text-emerald-300 mt-3 pt-3 border-t border-zinc-800">{studyCard.back}</p>}
                    </div>
                    {revealed ? (
                      <div className="flex gap-1.5 justify-center">
                        {RATINGS.map(r => (
                          <button key={r.id} onClick={() => rate(r.id)} className={cn('px-3 py-1.5 text-xs font-semibold rounded text-white', r.cls)}>{r.label}</button>
                        ))}
                      </div>
                    ) : (
                      <button onClick={() => setRevealed(true)} className="px-4 py-1.5 text-xs font-semibold rounded bg-purple-600 hover:bg-purple-500 text-white">Show answer</button>
                    )}
                  </>
                ) : (
                  <div className="py-6">
                    <RotateCcw className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                    <p className="text-sm text-zinc-300">Session complete — nothing due in this deck.</p>
                  </div>
                )}
              </div>
            )}

            {mode === 'cards' && (
              <div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 mb-2 space-y-1.5">
                  <input value={nf.front} onChange={e => setNf({ ...nf, front: e.target.value })} placeholder="Front"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                  <input value={nf.back} onChange={e => setNf({ ...nf, back: e.target.value })} placeholder="Back"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                  <div className="flex gap-1">
                    <input value={nf.tags} onChange={e => setNf({ ...nf, tags: e.target.value })} placeholder="tags (comma sep)"
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                    <button onClick={addCard} disabled={!nf.front.trim() || !nf.back.trim()}
                      className="px-3 py-1 text-xs rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold disabled:opacity-40">Add card</button>
                  </div>
                </div>
                <ul className="space-y-1 max-h-56 overflow-y-auto">
                  {cards.length === 0 && <li className="text-[11px] text-zinc-600 italic">No cards yet.</li>}
                  {cards.map(c => (
                    <li key={c.id} className="group flex items-center gap-2 bg-zinc-950/60 rounded px-2 py-1.5">
                      <span className="text-xs text-zinc-200 truncate flex-1">{c.front} <span className="text-zinc-600">→ {c.back}</span></span>
                      <span className={cn('text-[9px] px-1 rounded', c.state === 'new' ? 'bg-sky-900/50 text-sky-300' : 'bg-zinc-800 text-zinc-400')}>{c.state}</span>
                      <button onClick={() => deleteCard(c.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mode === 'stats' && stats && (
              <div>
                <div className="flex gap-4 mb-3">
                  <div><p className="text-lg font-bold text-zinc-100">{stats.totalReviews}</p><p className="text-[10px] text-zinc-500">reviews</p></div>
                  <div><p className="text-lg font-bold text-emerald-400">{stats.accuracy}%</p><p className="text-[10px] text-zinc-500">accuracy</p></div>
                </div>
                <div className="flex items-end gap-0.5 h-16">
                  {stats.last14Days.map(d => {
                    const max = Math.max(1, ...stats.last14Days.map(x => x.count));
                    return (
                      <div key={d.date} className="flex-1 bg-purple-600/70 rounded-sm" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} title={`${d.date}: ${d.count}`} />
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">last 14 days</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-500 min-h-[140px]">
            Create or select a deck.
          </div>
        )}
      </div>
    </div>
  );
}

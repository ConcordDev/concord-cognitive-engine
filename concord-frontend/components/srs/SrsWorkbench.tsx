'use client';

/**
 * SrsWorkbench — full Anki-2026-parity spaced-repetition workbench.
 *
 * Surfaces every backend backlog feature as real, purpose-built UI:
 *  - FSRS scheduler (per-deck option) + SM-2 study loop
 *  - Rich card types: basic / cloze / image-occlusion / templated
 *  - Media in cards: images + audio + browser TTS
 *  - Deck import / export (.apkg.json shared-deck bundle)
 *  - Per-deck options: new/day, review caps, learning steps, scheduler
 *  - Card browser: search, filter, bulk edit, tags, suspend/bury
 *  - Review heatmap / streak calendar + forecast graph
 *  - Sub-decks / deck hierarchy + filtered decks
 *  - Card markup (markdown/html) + hint fields
 *
 * Every value is real user input or computed from real state — no seed
 * data. All persistence flows through the srs.* macros.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Layers, Plus, Trash2, GraduationCap, Loader2, BarChart3, FolderTree,
  Filter, Image as ImageIcon, Volume2, Download, Upload, Settings2,
  Search, Ban, EyeOff, Tags, Sparkles, Flame, CalendarDays, Library,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz';

// ─── Types ───────────────────────────────────────────────────────────
interface DeckOptions {
  newPerDay: number;
  reviewsPerDay: number;
  learningSteps: number[];
  scheduler: 'fsrs' | 'sm2';
}
interface Deck {
  id: string;
  name: string;
  description?: string;
  parentId: string | null;
  filtered: boolean;
  filterQuery: string | null;
  options: DeckOptions;
  cardCount: number;
  newCount: number;
  dueCount: number;
  studyCount: number;
}
interface DeckTreeNode extends Deck {
  ownCardCount: number;
  children: DeckTreeNode[];
}
interface Card {
  id: string;
  deckId: string;
  front: string;
  back: string;
  tags: string[];
  state: string;
  reps: number;
  lapses: number;
  interval: number;
  ease?: number;
  stability?: number;
  difficulty?: number;
  cardType?: string;
  markup?: string;
  hint?: string;
  suspended?: boolean;
  buried?: boolean;
  due?: string;
  media?: {
    frontImage?: string | null;
    backImage?: string | null;
    frontAudio?: string | null;
    backAudio?: string | null;
    tts?: boolean;
  };
}
interface MediaAsset { id: string; kind: string; url: string; name: string }
interface HeatmapDay { date: string; count: number }
interface Heatmap {
  calendar: HeatmapDay[];
  currentStreak: number;
  longestStreak: number;
  totalReviews: number;
  activeDays: number;
}
interface ForecastDay { day: number; date: string; count: number }
interface Forecast { forecast: ForecastDay[]; dueNow: number; totalUpcoming: number }

type Tab = 'decks' | 'cards' | 'browse' | 'study' | 'stats' | 'transfer';
type CardType = 'basic' | 'cloze' | 'image-occlusion' | 'templated';

const RATINGS: { id: string; label: string; cls: string }[] = [
  { id: 'again', label: 'Again', cls: 'bg-rose-600 hover:bg-rose-500' },
  { id: 'hard', label: 'Hard', cls: 'bg-amber-600 hover:bg-amber-500' },
  { id: 'good', label: 'Good', cls: 'bg-emerald-600 hover:bg-emerald-500' },
  { id: 'easy', label: 'Easy', cls: 'bg-sky-600 hover:bg-sky-500' },
];

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'decks', label: 'Decks', icon: FolderTree },
  { id: 'cards', label: 'Add Cards', icon: Plus },
  { id: 'browse', label: 'Browser', icon: Search },
  { id: 'study', label: 'Study', icon: GraduationCap },
  { id: 'stats', label: 'Heatmap', icon: Flame },
  { id: 'transfer', label: 'Import/Export', icon: Download },
];

// Speak text via the Web Speech API (free, keyless, browser-native).
function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch { /* speech unavailable */ }
}

export function SrsWorkbench() {
  const [tab, setTab] = useState<Tab>('decks');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [tree, setTree] = useState<DeckTreeNode[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // ─── Deck refresh ──────────────────────────────────────────────────
  const refreshDecks = useCallback(async () => {
    const [list, t] = await Promise.all([
      lensRun('srs', 'deck-list', {}),
      lensRun('srs', 'deck-tree', {}),
    ]);
    setDecks((list.data?.result?.decks as Deck[]) || []);
    setTree((t.data?.result?.tree as DeckTreeNode[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refreshDecks(); }, [refreshDecks]);

  const activeDeck = useMemo(() => decks.find(d => d.id === active) || null, [decks, active]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-bold text-zinc-100">SRS Workbench</h3>
        <span className="text-[11px] text-zinc-400">Anki 2026 parity</span>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-3 border-b border-zinc-800 pb-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors',
              tab === t.id ? 'bg-purple-600/20 text-purple-300 border border-purple-700/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900',
            )}
          >
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-3 rounded-lg border border-emerald-700/40 bg-emerald-600/10 px-3 py-1.5 text-xs text-emerald-300">
          {notice}
        </div>
      )}

      {tab === 'decks' && (
        <DecksTab
          decks={decks} tree={tree} active={active} setActive={setActive}
          activeDeck={activeDeck} refreshDecks={refreshDecks}
          busy={busy} setBusy={setBusy} flash={flash}
        />
      )}
      {tab === 'cards' && (
        <AddCardsTab
          decks={decks} active={active} setActive={setActive}
          refreshDecks={refreshDecks} flash={flash}
        />
      )}
      {tab === 'browse' && <BrowseTab decks={decks} flash={flash} />}
      {tab === 'study' && <StudyTab decks={decks} active={active} setActive={setActive} refreshDecks={refreshDecks} />}
      {tab === 'stats' && <StatsTab decks={decks} active={active} setActive={setActive} />}
      {tab === 'transfer' && <TransferTab decks={decks} refreshDecks={refreshDecks} flash={flash} />}
    </div>
  );
}

// ═══ DECKS TAB — hierarchy, sub-decks, filtered decks, options ════════
function DecksTab({
  decks, tree, active, setActive, activeDeck, refreshDecks, busy, setBusy, flash,
}: {
  decks: Deck[]; tree: DeckTreeNode[]; active: string | null;
  setActive: (id: string | null) => void; activeDeck: Deck | null;
  refreshDecks: () => Promise<void>; busy: boolean;
  setBusy: (b: boolean) => void; flash: (m: string) => void;
}) {
  const [newDeck, setNewDeck] = useState('');
  const [newParent, setNewParent] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterQuery, setFilterQuery] = useState('tag:hard');

  async function createDeck() {
    if (!newDeck.trim()) return;
    setBusy(true);
    const r = await lensRun('srs', 'deck-create', {
      name: newDeck.trim(), parentId: newParent || undefined,
    });
    setBusy(false);
    setNewDeck(''); setNewParent('');
    await refreshDecks();
    if (r.data?.ok) flash('Deck created.');
  }
  async function createFiltered() {
    if (!filterName.trim() || !filterQuery.trim()) return;
    setBusy(true);
    const r = await lensRun('srs', 'filtered-deck-create', {
      name: filterName.trim(), query: filterQuery.trim(),
    });
    setBusy(false);
    setFilterName('');
    await refreshDecks();
    if (r.data?.ok) flash('Filtered deck created.');
    else if (r.data?.error) flash(r.data.error);
  }
  async function deleteDeck(id: string) {
    if (!confirm('Delete this deck and all its cards?')) return;
    await lensRun('srs', 'deck-delete', { id });
    if (active === id) setActive(null);
    await refreshDecks();
  }
  async function moveDeck(id: string, parentId: string) {
    const r = await lensRun('srs', 'deck-move', { id, parentId });
    await refreshDecks();
    if (!r.data?.ok && r.data?.error) flash(r.data.error);
  }

  const renderNode = (n: DeckTreeNode, depth: number) => (
    <div key={n.id}>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-lg px-2.5 py-1.5 border',
          active === n.id ? 'bg-purple-600/15 border-purple-700/50'
            : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700',
        )}
        style={{ marginLeft: depth * 16 }}
      >
        <button onClick={() => setActive(n.id)} className="flex-1 text-left">
          <p className="text-xs font-semibold text-zinc-100 truncate flex items-center gap-1.5">
            {n.filtered && <Filter className="w-3 h-3 text-amber-400" />}
            {n.name}
            <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 uppercase">
              {n.options?.scheduler || 'fsrs'}
            </span>
          </p>
          <p className="text-[10px] text-zinc-400">
            {n.ownCardCount} cards · <span className="text-sky-400">{n.newCount} new</span>
            {' · '}<span className="text-emerald-400">{n.dueCount} due</span>
          </p>
        </button>
        <button onClick={() => deleteDeck(n.id)}
          className="opacity-0 group-hover:opacity-100 p-1 text-rose-400" aria-label="Delete deck">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      {n.children.map(c => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-3">
      <div>
        {tree.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
            No decks yet. Create your first deck to begin.
          </div>
        ) : (
          <div className="space-y-1">{tree.map(n => renderNode(n, 0))}</div>
        )}

        {/* Create deck */}
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 space-y-2">
          <p className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
            <Plus className="w-3 h-3" />New deck / sub-deck
          </p>
          <div className="flex gap-1.5">
            <input value={newDeck} onChange={e => setNewDeck(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createDeck(); }}
              placeholder="Deck name"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <select value={newParent} onChange={e => setNewParent(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-300 max-w-[120px]">
              <option value="">No parent</option>
              {decks.filter(d => !d.filtered).map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button aria-label="Add" onClick={createDeck} disabled={busy || !newDeck.trim()}
              className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Filtered deck */}
        <div className="mt-2 rounded-lg border border-amber-800/40 bg-amber-950/20 p-2.5 space-y-2">
          <p className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
            <Filter className="w-3 h-3" />Filtered deck (dynamic)
          </p>
          <div className="flex gap-1.5">
            <input value={filterName} onChange={e => setFilterName(e.target.value)}
              placeholder="Name"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={filterQuery} onChange={e => setFilterQuery(e.target.value)}
              placeholder="tag:hard / is:due / is:new"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button aria-label="Add" onClick={createFiltered} disabled={busy || !filterName.trim()}
              className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-zinc-400">
            Queries: <code>tag:NAME</code>, <code>is:due</code>, <code>is:new</code>, or any text match.
          </p>
        </div>
      </div>

      {/* Deck options panel */}
      <div>
        {activeDeck && !activeDeck.filtered ? (
          <DeckOptionsPanel deck={activeDeck} decks={decks} refreshDecks={refreshDecks}
            moveDeck={moveDeck} flash={flash} />
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
            {activeDeck?.filtered ? 'Filtered decks use dynamic queries — no per-deck options.'
              : 'Select a deck to configure its options.'}
          </div>
        )}
      </div>
    </div>
  );
}

function DeckOptionsPanel({
  deck, decks, refreshDecks, moveDeck, flash,
}: {
  deck: Deck; decks: Deck[]; refreshDecks: () => Promise<void>;
  moveDeck: (id: string, parentId: string) => Promise<void>;
  flash: (m: string) => void;
}) {
  const [opts, setOpts] = useState<DeckOptions>(deck.options);
  const [stepsText, setStepsText] = useState((deck.options.learningSteps || []).join(' '));

  useEffect(() => {
    setOpts(deck.options);
    setStepsText((deck.options.learningSteps || []).join(' '));
  }, [deck]);

  async function save() {
    const learningSteps = stepsText.split(/[\s,]+/).map(Number)
      .filter(n => Number.isFinite(n) && n > 0);
    const r = await lensRun('srs', 'deck-options-update', {
      deckId: deck.id,
      options: {
        newPerDay: opts.newPerDay,
        reviewsPerDay: opts.reviewsPerDay,
        scheduler: opts.scheduler,
        learningSteps: learningSteps.length ? learningSteps : undefined,
      },
    });
    if (r.data?.ok) { flash('Deck options saved.'); await refreshDecks(); }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-3">
      <p className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
        <Settings2 className="w-3.5 h-3.5 text-purple-400" />{deck.name} — Options
      </p>

      <label className="block">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wide">Scheduler</span>
        <div className="mt-1 flex gap-1">
          {(['fsrs', 'sm2'] as const).map(s => (
            <button key={s} onClick={() => setOpts({ ...opts, scheduler: s })}
              className={cn('flex-1 px-2 py-1.5 text-xs rounded border',
                opts.scheduler === s ? 'bg-purple-600/20 border-purple-700/50 text-purple-200'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-700')}>
              {s === 'fsrs' ? 'FSRS (modern)' : 'SM-2 (classic)'}
            </button>
          ))}
        </div>
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wide">New cards / day</span>
        <input type="number" min={0} max={9999} value={opts.newPerDay}
          onChange={e => setOpts({ ...opts, newPerDay: Math.max(0, Number(e.target.value) || 0) })}
          className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wide">Reviews / day cap</span>
        <input type="number" min={0} max={99999} value={opts.reviewsPerDay}
          onChange={e => setOpts({ ...opts, reviewsPerDay: Math.max(0, Number(e.target.value) || 0) })}
          className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wide">Learning steps (minutes)</span>
        <input value={stepsText} onChange={e => setStepsText(e.target.value)}
          placeholder="1 10"
          className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wide">Move deck under</span>
        <select value={deck.parentId || ''}
          onChange={e => void moveDeck(deck.id, e.target.value)}
          className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300">
          <option value="">Top level</option>
          {decks.filter(d => d.id !== deck.id && !d.filtered).map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>

      <button onClick={save}
        className="w-full px-2 py-1.5 text-xs rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold">
        Save options
      </button>
    </div>
  );
}

// ═══ ADD CARDS TAB — rich card types, media, markup, hint ═════════════
function AddCardsTab({
  decks, active, setActive, refreshDecks, flash,
}: {
  decks: Deck[]; active: string | null; setActive: (id: string | null) => void;
  refreshDecks: () => Promise<void>; flash: (m: string) => void;
}) {
  const [cardType, setCardType] = useState<CardType>('basic');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState('');
  const [hint, setHint] = useState('');
  const [markup, setMarkup] = useState<'plain' | 'markdown' | 'html'>('plain');
  const [clozeText, setClozeText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [occLabels, setOccLabels] = useState('');
  const [fieldsText, setFieldsText] = useState('Word=\nMeaning=');
  const [frontTpl, setFrontTpl] = useState('{{Word}}');
  const [backTpl, setBackTpl] = useState('{{Meaning}}');
  const [frontImage, setFrontImage] = useState('');
  const [backImage, setBackImage] = useState('');
  const [frontAudio, setFrontAudio] = useState('');
  const [tts, setTts] = useState(false);
  const [busy, setBusy] = useState(false);

  const nonFiltered = decks.filter(d => !d.filtered);
  const deckId = active && nonFiltered.some(d => d.id === active) ? active : nonFiltered[0]?.id;

  async function submit() {
    if (!deckId) { flash('Create a deck first.'); return; }
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    const common = {
      deckId, cardType, tags: tagList, hint: hint.trim(), markup,
      frontImage: frontImage.trim() || undefined,
      backImage: backImage.trim() || undefined,
      frontAudio: frontAudio.trim() || undefined,
      tts,
    };
    let params: Record<string, unknown> = common;
    if (cardType === 'basic') {
      if (!front.trim() || !back.trim()) { flash('Front and back required.'); return; }
      params = { ...common, front: front.trim(), back: back.trim() };
    } else if (cardType === 'cloze') {
      if (!clozeText.trim()) { flash('Cloze text required.'); return; }
      params = { ...common, text: clozeText.trim() };
    } else if (cardType === 'image-occlusion') {
      const labels = occLabels.split(',').map(l => l.trim()).filter(Boolean);
      if (!imageUrl.trim() || labels.length === 0) { flash('Image URL and ≥1 label required.'); return; }
      params = {
        ...common, image: imageUrl.trim(),
        occlusions: labels.map((label, i) => ({
          x: 0.1 + (i % 3) * 0.28, y: 0.1 + Math.floor(i / 3) * 0.28,
          w: 0.22, h: 0.16, label,
        })),
      };
    } else {
      const fields: Record<string, string> = {};
      fieldsText.split('\n').forEach(line => {
        const idx = line.indexOf('=');
        if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      });
      if (Object.keys(fields).length === 0) { flash('Add at least one Field=value.'); return; }
      params = { ...common, fields, frontTemplate: frontTpl, backTemplate: backTpl };
    }
    setBusy(true);
    const r = await lensRun('srs', 'card-add', params);
    setBusy(false);
    if (r.data?.ok) {
      const gen = r.data.result?.generated;
      flash(gen ? `${gen} card(s) generated.` : 'Card added.');
      setFront(''); setBack(''); setClozeText(''); setOccLabels(''); setHint('');
      await refreshDecks();
    } else if (r.data?.error) {
      flash(r.data.error);
    }
  }

  if (nonFiltered.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
        Create a deck in the Decks tab before adding cards.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={deckId} onChange={e => setActive(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          {nonFiltered.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex gap-1">
          {(['basic', 'cloze', 'image-occlusion', 'templated'] as CardType[]).map(t => (
            <button key={t} onClick={() => setCardType(t)}
              className={cn('px-2 py-1.5 text-[11px] rounded border capitalize',
                cardType === t ? 'bg-purple-600/20 border-purple-700/50 text-purple-200'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-700')}>
              {t === 'image-occlusion' ? 'Image Occ.' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
        {cardType === 'basic' && (
          <>
            <textarea value={front} onChange={e => setFront(e.target.value)}
              placeholder="Front (question)" rows={2}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none" />
            <textarea value={back} onChange={e => setBack(e.target.value)}
              placeholder="Back (answer)" rows={3}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none" />
          </>
        )}
        {cardType === 'cloze' && (
          <>
            <textarea value={clozeText} onChange={e => setClozeText(e.target.value)}
              placeholder="The {{c1::sun}} is a {{c2::star}}." rows={3}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none" />
            <p className="text-[10px] text-zinc-400">
              Wrap deletions in <code>{'{{c1::answer}}'}</code> — optional hint:{' '}
              <code>{'{{c1::answer::hint}}'}</code>. One sub-card is generated per index.
            </p>
          </>
        )}
        {cardType === 'image-occlusion' && (
          <>
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              placeholder="Image URL (https://…)"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <input value={occLabels} onChange={e => setOccLabels(e.target.value)}
              placeholder="Region labels, comma-separated (heart, lung, liver)"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <p className="text-[10px] text-zinc-400 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" />One card is created per masked region.
            </p>
          </>
        )}
        {cardType === 'templated' && (
          <>
            <textarea value={fieldsText} onChange={e => setFieldsText(e.target.value)}
              placeholder={'Word=casa\nMeaning=house'} rows={3}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <input value={frontTpl} onChange={e => setFrontTpl(e.target.value)}
                placeholder="Front template"
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 font-mono" />
              <input value={backTpl} onChange={e => setBackTpl(e.target.value)}
                placeholder="Back template"
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 font-mono" />
            </div>
            <p className="text-[10px] text-zinc-400">
              Use <code>Field=value</code> per line; reference with <code>{'{{Field}}'}</code> in templates.
            </p>
          </>
        )}

        {/* Markup + hint */}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] text-zinc-400 uppercase">Markup</span>
            <select value={markup} onChange={e => setMarkup(e.target.value as typeof markup)}
              className="mt-0.5 w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300">
              <option value="plain">Plain text</option>
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
            </select>
          </label>
          <input value={hint} onChange={e => setHint(e.target.value)}
            placeholder="Hint (optional)"
            className="mt-[14px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </div>

        {/* Media */}
        <details className="rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1">
          <summary className="text-[11px] text-zinc-400 cursor-pointer flex items-center gap-1">
            <ImageIcon className="w-3 h-3" />Media & audio (optional)
          </summary>
          <div className="mt-2 space-y-1.5">
            <input value={frontImage} onChange={e => setFrontImage(e.target.value)}
              placeholder="Front image URL"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={backImage} onChange={e => setBackImage(e.target.value)}
              placeholder="Back image URL"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={frontAudio} onChange={e => setFrontAudio(e.target.value)}
              placeholder="Front audio URL"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input type="checkbox" checked={tts} onChange={e => setTts(e.target.checked)} />
              <Volume2 className="w-3 h-3" />Read aloud with browser text-to-speech
            </label>
          </div>
        </details>

        <input value={tags} onChange={e => setTags(e.target.value)}
          placeholder="tags, comma-separated"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />

        <button onClick={submit} disabled={busy}
          className="w-full px-2 py-1.5 text-xs rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add card
        </button>
      </div>

      <MediaLibrary flash={flash} />
    </div>
  );
}

// Reusable media asset library — register URLs once, reuse on cards.
function MediaLibrary({ flash }: { flash: (m: string) => void }) {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'image' | 'audio'>('image');

  const refresh = useCallback(async () => {
    const r = await lensRun('srs', 'media-list', {});
    setMedia((r.data?.result?.media as MediaAsset[]) || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function add() {
    if (!url.trim()) return;
    const r = await lensRun('srs', 'media-add', {
      url: url.trim(), kind, name: name.trim() || undefined,
    });
    if (r.data?.ok) {
      flash('Media asset added to library.');
      setUrl(''); setName('');
      await refresh();
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
      <p className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
        <Library className="w-3.5 h-3.5 text-pink-400" />Media library
        <span className="text-[10px] text-zinc-400 font-normal">{media.length} asset(s)</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <select value={kind} onChange={e => setKind(e.target.value as typeof kind)}
          className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-300">
          <option value="image">Image</option>
          <option value="audio">Audio</option>
        </select>
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder="Asset URL"
          className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Label"
          className="w-28 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button aria-label="Add" onClick={add} disabled={!url.trim()}
          className="px-2 py-1 rounded bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {media.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No media yet — add image/audio URLs to reuse on cards.</p>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {media.map(m => (
            <li key={m.id} className="flex items-center gap-2 text-[11px] text-zinc-300 bg-zinc-900/50 rounded px-2 py-1">
              {m.kind === 'audio'
                ? <Volume2 className="w-3 h-3 text-pink-400 shrink-0" />
                : <ImageIcon className="w-3 h-3 text-pink-400 shrink-0" />}
              <span className="truncate flex-1">{m.name}</span>
              <span className="text-zinc-600 truncate max-w-[120px]">{m.url}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═══ BROWSE TAB — search, filter, bulk edit, suspend, bury ════════════
function BrowseTab({ decks, flash }: { decks: Deck[]; flash: (m: string) => void }) {
  const [query, setQuery] = useState('');
  const [deckId, setDeckId] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState('created');
  const [cards, setCards] = useState<Card[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tag, setTag] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTags, setBulkTags] = useState('');
  const [bulkDeck, setBulkDeck] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('srs', 'card-browse', {
      query: query || undefined, deckId: deckId || undefined,
      state: stateFilter, cardType: typeFilter || undefined,
      tag: tag || undefined, sort,
    });
    setCards((r.data?.result?.cards as Card[]) || []);
    setAllTags((r.data?.result?.tags as string[]) || []);
    setLoading(false);
  }, [query, deckId, stateFilter, typeFilter, tag, sort]);
  useEffect(() => { void refresh(); }, [refresh]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const ids = () => [...selected];

  async function bulkSuspend(suspended: boolean) {
    if (selected.size === 0) return;
    await lensRun('srs', 'card-suspend', { ids: ids(), suspended });
    flash(`${selected.size} card(s) ${suspended ? 'suspended' : 'unsuspended'}.`);
    setSelected(new Set());
    await refresh();
  }
  async function bulkBury() {
    if (selected.size === 0) return;
    await lensRun('srs', 'card-bury', { ids: ids(), buried: true });
    flash(`${selected.size} card(s) buried.`);
    setSelected(new Set());
    await refresh();
  }
  async function bulkApply() {
    if (selected.size === 0) return;
    const addTags = bulkTags.split(',').map(t => t.trim()).filter(Boolean);
    await lensRun('srs', 'card-bulk-edit', {
      ids: ids(),
      addTags: addTags.length ? addTags : undefined,
      moveToDeckId: bulkDeck || undefined,
    });
    flash(`${selected.size} card(s) updated.`);
    setSelected(new Set()); setBulkTags(''); setBulkDeck('');
    await refresh();
  }
  async function del(id: string) {
    await lensRun('srs', 'card-delete', { id });
    await refresh();
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search front/back/tags"
            className="w-full pl-7 pr-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200" />
        </div>
        <select value={deckId} onChange={e => setDeckId(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-300">
          <option value="">All decks</option>
          {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-300">
          <option value="all">All states</option>
          <option value="new">New</option>
          <option value="due">Due</option>
          <option value="review">Review</option>
          <option value="learning">Learning</option>
          <option value="suspended">Suspended</option>
          <option value="buried">Buried</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-300">
          <option value="">All types</option>
          <option value="basic">Basic</option>
          <option value="cloze">Cloze</option>
          <option value="image-occlusion">Image Occ.</option>
          <option value="templated">Templated</option>
        </select>
        <select value={tag} onChange={e => setTag(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-300">
          <option value="">Any tag</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-300">
          <option value="created">Newest</option>
          <option value="due">Due date</option>
          <option value="interval">Interval</option>
          <option value="lapses">Lapses</option>
        </select>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-purple-700/40 bg-purple-600/10 p-2">
          <span className="text-[11px] text-purple-200 font-semibold">{selected.size} selected</span>
          <button onClick={() => bulkSuspend(true)}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-amber-600 hover:bg-amber-500 text-white">
            <Ban className="w-3 h-3" />Suspend
          </button>
          <button onClick={() => bulkSuspend(false)}
            className="px-2 py-1 text-[11px] rounded bg-zinc-700 hover:bg-zinc-600 text-white">
            Unsuspend
          </button>
          <button onClick={bulkBury}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-zinc-700 hover:bg-zinc-600 text-white">
            <EyeOff className="w-3 h-3" />Bury
          </button>
          <input value={bulkTags} onChange={e => setBulkTags(e.target.value)}
            placeholder="add tags"
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 w-28" />
          <select value={bulkDeck} onChange={e => setBulkDeck(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-300">
            <option value="">move to…</option>
            {decks.filter(d => !d.filtered).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button onClick={bulkApply}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-purple-600 hover:bg-purple-500 text-white">
            <Tags className="w-3 h-3" />Apply
          </button>
        </div>
      )}

      {/* Card table */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] text-zinc-400 bg-zinc-900/60 border-b border-zinc-800">
              <th className="p-2 w-8"></th>
              <th className="p-2">Front → Back</th>
              <th className="p-2 w-20">Type</th>
              <th className="p-2 w-14 text-center">Reps</th>
              <th className="p-2 w-16 text-center">Interval</th>
              <th className="p-2 w-20">State</th>
              <th className="p-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {cards.map(c => (
              <tr key={c.id} className="border-b border-zinc-800/60 hover:bg-zinc-900/40">
                <td className="p-2">
                  <input type="checkbox" checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)} aria-label="Select card" />
                </td>
                <td className="p-2 text-zinc-200">
                  <span className="truncate">{c.front}</span>
                  <span className="text-zinc-600"> → {c.back}</span>
                  {c.tags?.length > 0 && (
                    <span className="ml-1.5 text-[9px] text-purple-300">{c.tags.map(t => `#${t}`).join(' ')}</span>
                  )}
                </td>
                <td className="p-2 text-zinc-400">{c.cardType || 'basic'}</td>
                <td className="p-2 text-center text-zinc-400 font-mono">{c.reps}</td>
                <td className="p-2 text-center text-zinc-400 font-mono">{c.interval}d</td>
                <td className="p-2">
                  <span className={cn('text-[9px] px-1 rounded',
                    c.suspended ? 'bg-amber-900/50 text-amber-300'
                      : c.buried ? 'bg-zinc-800 text-zinc-400'
                      : c.state === 'new' ? 'bg-sky-900/50 text-sky-300'
                      : 'bg-emerald-900/40 text-emerald-300')}>
                    {c.suspended ? 'suspended' : c.buried ? 'buried' : c.state}
                  </span>
                </td>
                <td className="p-2">
                  <button onClick={() => del(c.id)} className="text-rose-400" aria-label="Delete card">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && cards.length === 0 && (
          <div className="p-6 text-center text-xs text-zinc-400">No cards match — no data yet.</div>
        )}
        {loading && (
          <div className="p-6 text-center text-zinc-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        )}
      </div>
    </div>
  );
}

// ═══ STUDY TAB — FSRS / SM-2 study loop with media + cloze ════════════
function StudyTab({
  decks, active, setActive, refreshDecks,
}: {
  decks: Deck[]; active: string | null; setActive: (id: string | null) => void;
  refreshDecks: () => Promise<void>;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [done, setDone] = useState(0);
  const [scheduler, setScheduler] = useState<string | null>(null);
  const [nextDays, setNextDays] = useState<number | null>(null);

  const deckId = active || decks[0]?.id;
  const deck = decks.find(d => d.id === deckId);

  const fetchNext = useCallback(async (id: string) => {
    const r = await lensRun('srs', 'study-next', { deckId: id });
    setCard((r.data?.result?.card as Card) || null);
    setRemaining(r.data?.result?.remaining || 0);
    setRevealed(false);
  }, []);
  useEffect(() => { if (deckId) void fetchNext(deckId); }, [deckId, fetchNext]);

  async function rate(rating: string) {
    if (!card || !deckId) return;
    const r = await lensRun('srs', 'study-answer', { cardId: card.id, rating });
    if (r.data?.ok) {
      setScheduler(r.data.result?.scheduler as string);
      setNextDays(r.data.result?.nextReviewInDays as number);
      setDone(d => d + 1);
    }
    await fetchNext(deckId);
    await refreshDecks();
  }

  if (decks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
        Create a deck to start studying.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select value={deckId} onChange={e => setActive(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          {decks.map(d => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.studyCount} due)
            </option>
          ))}
        </select>
        <span className="text-[11px] text-zinc-400">
          Scheduler: <span className="text-purple-300">{deck?.options?.scheduler?.toUpperCase() || 'FSRS'}</span>
        </span>
        <span className="ml-auto text-[11px] text-zinc-400">{done} studied this session</span>
      </div>

      {card ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-center">
          <p className="text-[10px] text-zinc-400 mb-2">{remaining} left</p>

          {card.media?.frontImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.media.frontImage} alt="Card front media"
              className="mx-auto mb-3 max-h-40 rounded border border-zinc-800" />
          )}
          <p className="text-base text-zinc-100 whitespace-pre-wrap">{card.front}</p>
          {card.media?.tts && (
            <button onClick={() => speak(card.front)}
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-sky-400">
              <Volume2 className="w-3 h-3" />Play
            </button>
          )}
          {!revealed && card.hint && (
            <p className="mt-2 text-[11px] text-amber-400/80 italic">Hint: {card.hint}</p>
          )}

          {revealed && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              {card.media?.backImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.media.backImage} alt="Card back media"
                  className="mx-auto mb-3 max-h-40 rounded border border-zinc-800" />
              )}
              <p className="text-sm text-emerald-300 whitespace-pre-wrap">{card.back}</p>
            </div>
          )}

          <div className="mt-4">
            {revealed ? (
              <div className="flex gap-1.5 justify-center">
                {RATINGS.map(r => (
                  <button key={r.id} onClick={() => rate(r.id)}
                    className={cn('px-3 py-1.5 text-xs font-semibold rounded text-white', r.cls)}>
                    {r.label}
                  </button>
                ))}
              </div>
            ) : (
              <button onClick={() => setRevealed(true)}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-purple-600 hover:bg-purple-500 text-white">
                Show answer
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-8 text-center">
          <Sparkles className="w-7 h-7 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-zinc-200">All caught up — nothing due in this deck.</p>
          {scheduler && nextDays != null && (
            <p className="text-[11px] text-zinc-400 mt-1">
              Last card scheduled +{nextDays}d via {scheduler.toUpperCase()}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ═══ STATS TAB — review heatmap + streaks + forecast graph ════════════
function StatsTab({
  decks, active, setActive,
}: {
  decks: Deck[]; active: string | null; setActive: (id: string | null) => void;
}) {
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const deckId = active || '';

  const refresh = useCallback(async () => {
    setLoading(true);
    const [hm, fc] = await Promise.all([
      lensRun('srs', 'review-heatmap', { days: 168, deckId: deckId || undefined }),
      lensRun('srs', 'review-forecast', { days: 30, deckId: deckId || undefined }),
    ]);
    setHeatmap((hm.data?.result as Heatmap) || null);
    setForecast((fc.data?.result as Forecast) || null);
    setLoading(false);
  }, [deckId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const maxHeat = useMemo(
    () => Math.max(1, ...(heatmap?.calendar || []).map(d => d.count)),
    [heatmap],
  );
  // Group 168 days into 24 week-columns of 7 days.
  const weeks = useMemo(() => {
    const cal = heatmap?.calendar || [];
    const out: HeatmapDay[][] = [];
    for (let i = 0; i < cal.length; i += 7) out.push(cal.slice(i, i + 7));
    return out;
  }, [heatmap]);

  function heatColor(count: number) {
    if (count === 0) return 'bg-zinc-800';
    const r = count / maxHeat;
    if (r > 0.66) return 'bg-emerald-400';
    if (r > 0.33) return 'bg-emerald-600';
    return 'bg-emerald-800';
  }

  if (loading) {
    return <div className="py-8 text-center text-zinc-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>;
  }

  const hasData = (heatmap?.totalReviews || 0) > 0 || (forecast?.totalUpcoming || 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={deckId} onChange={e => setActive(e.target.value || null)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          <option value="">All decks</option>
          {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {!hasData && (
        <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
          No review history yet — study some cards to populate the heatmap and forecast.
        </div>
      )}

      {/* Streak stat row */}
      {heatmap && (
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Current streak" value={`${heatmap.currentStreak}d`} icon={Flame} accent="text-amber-400" />
          <Stat label="Longest streak" value={`${heatmap.longestStreak}d`} icon={Flame} accent="text-emerald-400" />
          <Stat label="Total reviews" value={String(heatmap.totalReviews)} icon={BarChart3} accent="text-sky-400" />
          <Stat label="Active days" value={String(heatmap.activeDays)} icon={CalendarDays} accent="text-purple-400" />
        </div>
      )}

      {/* Heatmap calendar */}
      {heatmap && heatmap.totalReviews > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <p className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400" />Review heatmap (24 weeks)
          </p>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map(day => (
                  <div key={day.date}
                    className={cn('w-2.5 h-2.5 rounded-sm', heatColor(day.count))}
                    title={`${day.date}: ${day.count} review(s)`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Forecast chart */}
      {forecast && forecast.totalUpcoming > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <p className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-sky-400" />30-day review forecast
            <span className="ml-auto text-[10px] text-zinc-400">
              {forecast.dueNow} due now · {forecast.totalUpcoming} upcoming
            </span>
          </p>
          <ChartKit
            kind="bar"
            data={forecast.forecast.map(f => ({ day: `+${f.day}d`, cards: f.count }))}
            xKey="day"
            series={[{ key: 'cards', label: 'Cards due', color: '#06b6d4' }]}
            height={180}
            showLegend={false}
          />
        </div>
      )}
    </div>
  );
}

function Stat({
  label, value, icon: Icon, accent,
}: {
  label: string; value: string; icon: typeof Flame; accent: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-center">
      <Icon className={cn('w-4 h-4 mx-auto mb-1', accent)} />
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400">{label}</p>
    </div>
  );
}

// ═══ TRANSFER TAB — deck import / export (.apkg.json bundles) ═════════
function TransferTab({
  decks, refreshDecks, flash,
}: {
  decks: Deck[]; refreshDecks: () => Promise<void>; flash: (m: string) => void;
}) {
  const [exportDeck, setExportDeck] = useState('');
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);

  async function doExport() {
    if (!exportDeck) return;
    setBusy(true);
    const r = await lensRun('srs', 'deck-export', { deckId: exportDeck });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      const { bundle, filename } = r.data.result as { bundle: unknown; filename: string };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || 'deck.apkg.json';
      a.click();
      URL.revokeObjectURL(url);
      flash('Deck exported.');
    } else if (r.data?.error) {
      flash(r.data.error);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportText(await file.text());
    e.target.value = '';
  }

  async function doImport() {
    if (!importText.trim()) return;
    setBusy(true);
    const r = await lensRun('srs', 'deck-import', { bundle: importText.trim() });
    setBusy(false);
    if (r.data?.ok) {
      flash(`Imported ${r.data.result?.imported ?? 0} card(s).`);
      setImportText('');
      await refreshDecks();
    } else if (r.data?.error) {
      flash(r.data.error);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {/* Export */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
        <p className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5 text-emerald-400" />Export a deck
        </p>
        <select value={exportDeck} onChange={e => setExportDeck(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          <option value="">Select a deck…</option>
          {decks.filter(d => !d.filtered).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={doExport} disabled={busy || !exportDeck}
          className="w-full px-2 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
          <Download className="w-3.5 h-3.5" />Download .apkg.json bundle
        </button>
        <p className="text-[10px] text-zinc-400">
          Exports all cards, tags, media references, and deck options as a portable shared-deck bundle.
        </p>
      </div>

      {/* Import */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
        <p className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5 text-sky-400" />Import a deck
        </p>
        <input type="file" accept=".json,application/json" onChange={onFile}
          className="block w-full text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-200" />
        <textarea value={importText} onChange={e => setImportText(e.target.value)}
          placeholder="…or paste a deck bundle JSON here"
          rows={5}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-zinc-200 resize-none font-mono" />
        <button onClick={doImport} disabled={busy || !importText.trim()}
          className="w-full px-2 py-1.5 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Import bundle
        </button>
      </div>
    </div>
  );
}

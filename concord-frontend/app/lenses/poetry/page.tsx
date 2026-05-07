'use client';

import { useState, useCallback, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Feather, Plus, Search, Edit2, Trash2, BookOpen, X, Save, Sparkles,
  AlignLeft, Globe,
  Hash, Music, Layers, Moon, Zap,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';
import { FeedBanner } from '@/components/lens/FeedBanner';

type PoetryTab = 'collection' | 'compose' | 'forms' | 'workshop';
type PoemForm = 'free-verse' | 'sonnet' | 'haiku' | 'limerick' | 'villanelle' | 'ballad' | 'ode' | 'elegy' | 'acrostic' | 'other';

interface Poem {
  id: string;
  title: string;
  content: string;
  form: PoemForm;
  lineCount: number;
  wordCount: number;
  status: 'draft' | 'polished' | 'published';
  tags: string[];
  createdAt: string;
}

const POEM_FORMS: { id: PoemForm; label: string; description: string }[] = [
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

const POEM_TEMPLATES: Record<string, { title: string; placeholder: string; hint: string }> = {
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

function SyllableRhymePanel({ content, form }: { content: string; form: string }) {
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
        <span className="text-xs text-gray-500">{totalSyllables} total syllables</span>
      </div>

      {/* Per-line syllable breakdown */}
      {lines.length > 0 && lines.some(l => l.trim()) && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 mb-2">Syllables per line:</p>
          {lines.map((line, i) => {
            if (!line.trim()) return null;
            const count = syllableCounts[i];
            const isHaikuTarget = form === 'haiku' && [5, 7, 5][nonEmptyLines.indexOf(line)] !== undefined;
            const target = form === 'haiku' ? [5, 7, 5][nonEmptyLines.indexOf(line)] : null;
            return (
              <div key={i} className={cn("flex items-center gap-2", isHaikuTarget && "bg-rose-500/5 rounded px-1 -mx-1")}>
                <span className="text-xs text-gray-600 w-16 truncate">{line.slice(0, 12)}…</span>
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', count > 0 ? 'bg-rose-400/60' : '')}
                    style={{ width: `${Math.min(100, count * 6)}%` }} />
                </div>
                <span className={cn('text-xs w-6 text-right font-mono',
                  target !== null ? (count === target ? 'text-green-400' : 'text-red-400') : 'text-gray-400')}>
                  {count}
                </span>
                {target !== null && <span className="text-xs text-gray-600">/{target}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Rhyme scheme */}
      {nonEmptyLines.length >= 2 && (
        <div>
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Music className="w-3 h-3" /> Rhyme Scheme:</p>
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

function ReadingMode({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
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
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
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

export default function PoetryPage() {
  useLensNav('poetry');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('poetry');
  const { contextDTUs } = useLensDTUs({ lens: 'poetry' });

  const { items: poemItems, isLoading, isError, error, refetch, create: createPoem, update: updatePoem, remove: removePoem } = useLensData<Poem>('poetry', 'poem', { seed: [] });
  const poems = useMemo(() => poemItems.map(i => ({ ...(i.data as unknown as Poem), id: i.id, title: i.title })), [poemItems]);

  const runAction = useRunArtifact('poetry');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleAction = useCallback(async (action: string) => {
    const targetId = poemItems[0]?.id;
    if (!targetId) return;
    setActiveAction(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult({ action, ...(res.result as Record<string, unknown>) }); }
    } catch (err) {
      console.error('Poetry action failed:', err);
    } finally {
      setActiveAction(null);
    }
  }, [poemItems, runAction]);

  const [tab, setTab] = useState<PoetryTab>('collection');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [formFilter, setFormFilter] = useState<PoemForm | null>(null);
  const [readingMode, setReadingMode] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(true);

  // Composer state
  const [composingPoem, setComposingPoem] = useState<Poem | null>(null);
  const [compTitle, setCompTitle] = useState('');
  const [compContent, setCompContent] = useState('');
  const [compForm, setCompForm] = useState<PoemForm>('free-verse');
  const [isSaving, setIsSaving] = useState(false);

  const filteredPoems = useMemo(() => {
    let result = poems;
    if (formFilter) result = result.filter(p => p.form === formFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.title?.toLowerCase().includes(q) || p.content?.toLowerCase().includes(q));
    }
    return result;
  }, [poems, formFilter, searchQuery]);

  const startNew = useCallback(() => {
    setComposingPoem(null);
    setCompTitle('');
    setCompContent('');
    setCompForm('free-verse');
    setTab('compose');
  }, []);

  const openPoem = useCallback((poem: Poem) => {
    setComposingPoem(poem);
    setCompTitle(poem.title);
    setCompContent(poem.content || '');
    setCompForm(poem.form || 'free-verse');
    setTab('compose');
  }, []);

  const savePoem = useCallback(async () => {
    setIsSaving(true);
    const lines = compContent.split('\n').filter(l => l.trim());
    const words = compContent.trim().split(/\s+/).filter(Boolean).length;
    const data: Partial<Poem> = {
      title: compTitle || 'Untitled',
      content: compContent,
      form: compForm,
      lineCount: lines.length,
      wordCount: words,
      status: 'draft',
      tags: [compForm],
    };
    try {
      if (composingPoem) {
        await updatePoem(composingPoem.id, { title: data.title, data: data as unknown as Partial<Poem> });
      } else {
        await createPoem({ title: data.title!, data: { ...data, createdAt: new Date().toISOString() } as unknown as Record<string, unknown> });
      }
      refetch();
    } catch (err) {
      console.error('Save failed:', err instanceof Error ? err.message : err);
    }
    setIsSaving(false);
  }, [compTitle, compContent, compForm, composingPoem, createPoem, updatePoem, refetch]);

  // Use creative generation for AI-assisted poetry
  const [aiGenerating, setAiGenerating] = useState(false);
  const generatePoem = useCallback(async () => {
    setAiGenerating(true);
    try {
      const resp = await api.post('/api/lens/run', { domain: 'creative', action: 'generate', mode: 'structural_poetry', form: compForm });
      if (resp.data?.result?.content) {
        setCompContent(prev => prev ? prev + '\n\n' + resp.data.result.content : resp.data.result.content);
      }
    } catch (err) {
      console.error('AI generation failed:', err instanceof Error ? err.message : err);
    }
    setAiGenerating(false);
  }, [compForm]);

  const lineCount = useMemo(() => compContent.split('\n').filter(l => l.trim()).length, [compContent]);
  const wordCount = useMemo(() => compContent.trim().split(/\s+/).filter(Boolean).length, [compContent]);

  const TABS: { id: PoetryTab; label: string; icon: typeof Feather }[] = [
    { id: 'collection', label: 'Collection', icon: BookOpen },
    { id: 'compose', label: 'Compose', icon: Feather },
    { id: 'forms', label: 'Forms', icon: AlignLeft },
    { id: 'workshop', label: 'Workshop', icon: Globe },
  ];

  return (
    <div data-lens-theme="poetry" className="min-h-screen">
      {/* Reading Mode Overlay */}
      <AnimatePresence>
        {readingMode && (
          <ReadingMode title={compTitle} content={compContent} onClose={() => setReadingMode(false)} />
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Feather className="w-6 h-6 text-rose-400" />
            <h1 className="text-2xl font-bold">Poetry</h1>
            {isLoading && (
              <div className="flex items-center gap-1.5 text-xs text-rose-400">
                <div className="w-3 h-3 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          </div>
          <div className="flex items-center gap-2">
            <DTUExportButton domain="poetry" data={{}} compact />
            <button onClick={() => setShowFeatures(!showFeatures)} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Features</button>
            <button onClick={startNew} className="px-3 py-1.5 text-xs bg-rose-500/20 border border-rose-500/30 rounded-lg hover:bg-rose-500/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> New Poem
            </button>
          </div>
        </div>

        {showFeatures && <LensFeaturePanel lensId="poetry" />}
        <FeedBanner domain="poetry" />
        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />
      <UniversalActions domain="poetry" artifactId={null} compact />

        {/* Poetry Actions Panel */}
        <div className="bg-white/3 border border-white/10 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-rose-300 flex items-center gap-2"><Zap className="w-4 h-4" /> Poetry Analysis</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { action: 'meterAnalysis', label: 'Meter Analysis' },
              { action: 'rhymeScheme', label: 'Rhyme Scheme' },
              { action: 'formGuide', label: 'Form Guide' },
              { action: 'wordFrequency', label: 'Word Frequency' },
            ].map(({ action, label }) => (
              <button key={action} onClick={() => handleAction(action)} disabled={activeAction === action || !poemItems[0]?.id}
                className="px-3 py-1.5 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 disabled:opacity-50 flex items-center gap-1.5">
                {activeAction === action ? <div className="w-3 h-3 border border-rose-400 border-t-transparent rounded-full animate-spin" /> : <Zap className="w-3 h-3 text-rose-400" />}
                {label}
              </button>
            ))}
          </div>
          {actionResult && (
            <div className="mt-3 p-3 bg-black/30 rounded-lg border border-rose-500/20 text-xs space-y-2">
              {actionResult.action === 'meterAnalysis' && (
                <div className="space-y-1">
                  <div className="flex gap-4 flex-wrap">
                    <span className="text-gray-400">Lines: <span className="text-white font-mono">{String(actionResult.lines ?? '')}</span></span>
                    <span className="text-gray-400">Avg syllables: <span className="text-rose-300 font-mono">{String(actionResult.avgSyllables ?? '')}</span></span>
                    <span className="text-gray-400">Consistency: <span className={`font-mono ${actionResult.meterConsistency === 'regular' ? 'text-green-400' : 'text-yellow-400'}`}>{String(actionResult.meterConsistency ?? '')}</span></span>
                    <span className="text-gray-400">Form: <span className="text-rose-300 font-mono">{String(actionResult.possibleForm ?? '')}</span></span>
                  </div>
                  {Array.isArray(actionResult.syllablesPerLine) && (
                    <div className="flex flex-wrap gap-1 mt-1">{(actionResult.syllablesPerLine as number[]).map((n, i) => <span key={i} className="px-1.5 py-0.5 bg-rose-500/10 rounded text-rose-300 font-mono">{n}</span>)}</div>
                  )}
                </div>
              )}
              {actionResult.action === 'rhymeScheme' && (
                <div className="space-y-1">
                  <div className="flex gap-4 flex-wrap">
                    <span className="text-gray-400">Scheme: <span className="text-rose-300 font-mono text-sm tracking-widest">{String(actionResult.scheme ?? '')}</span></span>
                    <span className="text-gray-400">Form: <span className="text-white">{String(actionResult.form ?? '')}</span></span>
                    <span className={`${actionResult.rhyming ? 'text-green-400' : 'text-gray-500'}`}>{actionResult.rhyming ? 'Rhymes detected' : 'No rhymes'}</span>
                  </div>
                </div>
              )}
              {actionResult.action === 'formGuide' && (
                <div className="space-y-1">
                  <p className="text-rose-300 font-semibold capitalize">{String(actionResult.form ?? '')}</p>
                  <div className="grid grid-cols-2 gap-1">
                    <span className="text-gray-400">Lines: <span className="text-white">{String(actionResult.lines ?? '')}</span></span>
                    <span className="text-gray-400">Meter: <span className="text-white">{String(actionResult.meter ?? '')}</span></span>
                    <span className="text-gray-400 col-span-2">Rhyme: <span className="text-rose-300">{String(actionResult.rhyme ?? '')}</span></span>
                    <span className="text-gray-400 col-span-2">Structure: <span className="text-gray-200">{String(actionResult.structure ?? '')}</span></span>
                  </div>
                  {!!actionResult.tip && <p className="text-gray-500 italic">{String(actionResult.tip)}</p>}
                </div>
              )}
              {actionResult.action === 'wordFrequency' && (
                <div className="space-y-1">
                  <div className="flex gap-4 flex-wrap">
                    <span className="text-gray-400">Total words: <span className="text-white font-mono">{String(actionResult.totalWords ?? '')}</span></span>
                    <span className="text-gray-400">Unique: <span className="text-rose-300 font-mono">{String(actionResult.uniqueWords ?? '')}</span></span>
                    <span className="text-gray-400">Density: <span className="text-white font-mono">{String(actionResult.lexicalDensity ?? '')}%</span></span>
                  </div>
                  {Array.isArray(actionResult.topWords) && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(actionResult.topWords as {word:string;count:number}[]).slice(0,8).map(({word,count}) => (
                        <span key={word} className="px-2 py-0.5 bg-rose-500/10 rounded text-rose-300 font-mono">{word} <span className="text-gray-500">×{count}</span></span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => setActionResult(null)} className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1 mt-1"><X className="w-3 h-3" /> Dismiss</button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', tab === t.id ? 'bg-rose-500/20 text-rose-400' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {isError && <ErrorState error={error?.message} onRetry={refetch} />}

        {/* Collection */}
        {tab === 'collection' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search poems..." className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-rose-500/50" />
              </div>
              <select value={formFilter || ''} onChange={e => setFormFilter((e.target.value || null) as PoemForm | null)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                <option value="">All forms</option>
                {POEM_FORMS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            {filteredPoems.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Feather className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No poems yet. Begin composing.</p>
                <button onClick={startNew} className="mt-3 px-4 py-2 text-xs bg-rose-500/20 rounded-lg hover:bg-rose-500/30">Compose</button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredPoems.map(poem => (
                  <motion.div key={poem.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-rose-500/30 transition-colors cursor-pointer" onClick={() => openPoem(poem)}>
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium text-sm italic">{poem.title}</h3>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span>{poem.form || 'free-verse'}</span>
                          <span>{poem.lineCount || 0} lines</span>
                          <span>{poem.wordCount || 0} words</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <PullToSubstrate domain="poetry" artifactId={poem.id} compact />
                        <button onClick={e => { e.stopPropagation(); openPoem(poem); }} className="p-1 hover:bg-white/10 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={e => { e.stopPropagation(); removePoem(poem.id).then(() => refetch()).catch((err) => { console.error('[Poetry] Failed to delete poem:', err); useUIStore.getState().addToast({ type: 'error', message: 'Failed to delete poem' }); }); }} className="p-1 hover:bg-white/10 rounded text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    {poem.content && (
                      <pre className="text-xs text-gray-500 mt-2 font-serif whitespace-pre-wrap line-clamp-4">{poem.content.slice(0, 300)}</pre>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Compose */}
        {tab === 'compose' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <input value={compTitle} onChange={e => setCompTitle(e.target.value)} placeholder="Poem title" className="text-lg font-semibold bg-transparent border-none focus:outline-none placeholder-gray-600 italic" />
                <select value={compForm} onChange={e => {
                  const f = e.target.value as PoemForm;
                  setCompForm(f);
                  if (POEM_TEMPLATES[f] && !compContent) setCompContent('');
                }} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs">
                  {POEM_FORMS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">{lineCount} lines / {wordCount} words</span>
                <button onClick={() => setShowAnalysis(a => !a)}
                  className={cn('px-2 py-1.5 text-xs rounded-lg flex items-center gap-1', showAnalysis ? 'bg-rose-500/15 text-rose-400 border border-rose-500/25' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10')}>
                  <Hash className="w-3 h-3" /> Analysis
                </button>
                <button onClick={() => setReadingMode(true)} disabled={!compContent.trim()}
                  className="px-2 py-1.5 text-xs bg-white/5 rounded-lg hover:bg-white/10 flex items-center gap-1 border border-white/10 disabled:opacity-40">
                  <Moon className="w-3 h-3" /> Read
                </button>
                {POEM_TEMPLATES[compForm] && (
                  <button onClick={() => { if (!compContent.trim()) setCompContent(POEM_TEMPLATES[compForm].placeholder); }}
                    className="px-2 py-1.5 text-xs bg-white/5 rounded-lg hover:bg-white/10 flex items-center gap-1 border border-white/10">
                    <Layers className="w-3 h-3" /> Template
                  </button>
                )}
                <button onClick={generatePoem} disabled={aiGenerating} className="px-3 py-1.5 text-xs bg-white/5 rounded-lg hover:bg-white/10 flex items-center gap-1 disabled:opacity-50 border border-white/10">
                  <Sparkles className="w-3 h-3" /> {aiGenerating ? 'Generating...' : 'AI Assist'}
                </button>
                <button onClick={savePoem} disabled={isSaving} className="px-3 py-1.5 text-xs bg-rose-500/20 border border-rose-500/30 rounded-lg hover:bg-rose-500/30 flex items-center gap-1 disabled:opacity-50">
                  <Save className="w-3 h-3" /> {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            {/* Template hint */}
            {POEM_TEMPLATES[compForm] && (
              <p className="text-xs text-gray-600 italic px-1">{POEM_TEMPLATES[compForm].hint}</p>
            )}

            <div className={cn('grid gap-4', showAnalysis ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1')}>
              <div className={showAnalysis ? 'lg:col-span-2' : ''}>
                <textarea
                  value={compContent}
                  onChange={e => setCompContent(e.target.value)}
                  placeholder={POEM_TEMPLATES[compForm]?.placeholder || "Write your poem here..."}
                  className="w-full h-[50vh] px-8 py-6 bg-white/5 border border-white/10 rounded-lg text-sm leading-loose focus:outline-none focus:border-rose-500/30 resize-none font-serif italic"
                />
              </div>
              {showAnalysis && (
                <AnimatePresence>
                  <motion.div
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    className="space-y-3"
                  >
                    <SyllableRhymePanel content={compContent} form={compForm} />
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </div>
        )}

        {/* Forms guide */}
        {tab === 'forms' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><AlignLeft className="w-5 h-5 text-rose-400" /> Poetic Forms</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {POEM_FORMS.map(form => (
                <div key={form.id} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-rose-500/30 transition-colors">
                  <h3 className="font-medium text-sm">{form.label}</h3>
                  <p className="text-xs text-gray-500 mt-1">{form.description}</p>
                  <button onClick={() => { setCompForm(form.id); setCompTitle(''); setCompContent(''); setComposingPoem(null); setTab('compose'); }} className="mt-2 text-xs text-rose-400 hover:text-rose-300">
                    Try this form
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Workshop */}
        {tab === 'workshop' && (
          <div className="text-center py-16 text-gray-500">
            <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-2">Poetry Workshop</p>
            <p className="text-xs text-gray-600">Share poems for critique, participate in collaborative verse, and discover other poets.</p>
            <div className="mt-4 text-xs text-gray-600">Poetry DTUs: {contextDTUs.length}</div>
          </div>
        )}
      </div>
    </div>
  );
}

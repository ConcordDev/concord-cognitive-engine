'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useUIStore } from '@/store/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Plus, Search, FileText, Edit2, Trash2,
  Clock, Sparkles, Save, BarChart3, Globe,
  AlignLeft, PenTool, Check, Zap, Users, Star,
  Maximize2, Minimize2, Shuffle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type WritingTab = 'works' | 'editor' | 'prompts' | 'workshop';
type WritingGenre = 'fiction' | 'nonfiction' | 'screenplay' | 'short-story' | 'novel' | 'essay' | 'blog' | 'other';

interface WritingWork {
  id: string;
  title: string;
  genre: WritingGenre;
  content: string;
  wordCount: number;
  status: 'draft' | 'revision' | 'published';
  createdAt: string;
  updatedAt: string;
}

const GENRES: { id: WritingGenre; label: string }[] = [
  { id: 'fiction', label: 'Fiction' },
  { id: 'nonfiction', label: 'Non-Fiction' },
  { id: 'screenplay', label: 'Screenplay' },
  { id: 'short-story', label: 'Short Story' },
  { id: 'novel', label: 'Novel' },
  { id: 'essay', label: 'Essay' },
  { id: 'blog', label: 'Blog Post' },
  { id: 'other', label: 'Other' },
];

// Prompts are loaded from the backend via useLensData; empty until real data exists
const FALLBACK_PROMPTS: { text: string; genres: WritingGenre[] }[] = [];

const WORD_COUNT_GOAL = 1000;

function getRelativeTime(isoString?: string): string {
  if (!isoString) return 'never';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function readingTime(wordCount: number): string {
  const mins = Math.max(1, Math.round(wordCount / 200));
  return `${mins} min read`;
}

export default function CreativeWritingPage() {
  useLensNav('creative-writing');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('creative-writing');
  const { contextDTUs, isLoading: dtusLoading } = useLensDTUs({ lens: 'creative-writing' });

  const { items: workItems, isLoading, isError, error, refetch, create: createWork, update: updateWork, remove: removeWork } = useLensData<WritingWork>('creative-writing', 'work', { seed: [] });
  const works = useMemo(() => workItems.map(i => ({ ...(i.data as unknown as WritingWork), id: i.id, title: i.title })), [workItems]);

  const { items: promptItems } = useLensData<{ text: string; genres: string[] }>('creative-writing', 'prompt', { noSeed: true });
  const WRITING_PROMPTS = useMemo(() => {
    if (promptItems.length > 0) return promptItems.map(i => ({ text: i.data.text || i.title, genres: (i.data.genres || []) as WritingGenre[] }));
    return FALLBACK_PROMPTS;
  }, [promptItems]);

  const [tab, setTab] = useState<WritingTab>('works');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [genreFilter, setGenreFilter] = useState<WritingGenre | null>(null);

  // Editor state
  const [editingWork, setEditingWork] = useState<WritingWork | null>(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorGenre, setEditorGenre] = useState<WritingGenre>('fiction');
  const [isSaving, setIsSaving] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session timer
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const sessionInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Prompts state
  const [highlightedPrompt, setHighlightedPrompt] = useState<number | null>(null);

  const filteredWorks = useMemo(() => {
    let result = works;
    if (genreFilter) result = result.filter(w => w.genre === genreFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(w => w.title.toLowerCase().includes(q) || (w.content || '').toLowerCase().includes(q));
    }
    return result;
  }, [works, genreFilter, searchQuery]);

  // Session timer — starts when editor tab opens, resets on tab switch
  useEffect(() => {
    if (tab === 'editor') {
      setSessionSeconds(0);
      sessionInterval.current = setInterval(() => {
        setSessionSeconds(s => s + 1);
      }, 1000);
    } else {
      if (sessionInterval.current) {
        clearInterval(sessionInterval.current);
        sessionInterval.current = null;
      }
      setSessionSeconds(0);
    }
    return () => {
      if (sessionInterval.current) clearInterval(sessionInterval.current);
    };
  }, [tab]);

  // Auto-save debounce
  useEffect(() => {
    if (!editingWork || !editorContent.trim()) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const wordCount = editorContent.trim().split(/\s+/).filter(Boolean).length;
      const data: Partial<WritingWork> = {
        title: editorTitle || 'Untitled',
        genre: editorGenre,
        content: editorContent,
        wordCount,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      };
      try {
        await updateWork(editingWork.id, { title: data.title, data: data as unknown as Partial<WritingWork> });
        refetch();
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 2000);
      } catch {
        // silent auto-save failure
      }
    }, 5000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [editorContent, editorTitle, editorGenre, editingWork, updateWork, refetch]);

  const startNewWork = useCallback(() => {
    setEditingWork(null);
    setEditorTitle('');
    setEditorContent('');
    setEditorGenre('fiction');
    setFocusMode(false);
    setTab('editor');
  }, []);

  const openWork = useCallback((work: WritingWork) => {
    setEditingWork(work);
    setEditorTitle(work.title);
    setEditorContent(work.content || '');
    setEditorGenre(work.genre || 'fiction');
    setFocusMode(false);
    setTab('editor');
  }, []);

  const saveWork = useCallback(async () => {
    setIsSaving(true);
    const wordCount = editorContent.trim().split(/\s+/).filter(Boolean).length;
    const data: Partial<WritingWork> = {
      title: editorTitle || 'Untitled',
      genre: editorGenre,
      content: editorContent,
      wordCount,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editingWork) {
        await updateWork(editingWork.id, { title: data.title, data: data as unknown as Partial<WritingWork> });
      } else {
        await createWork({ title: data.title!, data: { ...data, createdAt: new Date().toISOString() } as unknown as Record<string, unknown> });
      }
      refetch();
    } catch (err) {
      console.error('Save failed:', err instanceof Error ? err.message : err);
    }
    setIsSaving(false);
  }, [editorTitle, editorContent, editorGenre, editingWork, createWork, updateWork, refetch]);

  const wordCount = useMemo(() => editorContent.trim().split(/\s+/).filter(Boolean).length, [editorContent]);
  const charCount = editorContent.length;
  const paragraphCount = useMemo(() => editorContent.split(/\n\s*\n/).filter(p => p.trim()).length || (editorContent.trim() ? 1 : 0), [editorContent]);
  const estReadingTime = readingTime(wordCount);
  const goalProgress = Math.min(100, Math.round((wordCount / WORD_COUNT_GOAL) * 100));

  const sessionLabel = useMemo(() => {
    const m = Math.floor(sessionSeconds / 60);
    const s = sessionSeconds % 60;
    return `${m}m ${s}s`;
  }, [sessionSeconds]);

  const pickRandomPrompt = useCallback(() => {
    const idx = Math.floor(Math.random() * WRITING_PROMPTS.length);
    setHighlightedPrompt(idx);
  }, []);

  const totalWordsWritten = useMemo(() => works.reduce((sum, w) => sum + (w.wordCount || 0), 0), [works]);
  const avgWordCount = works.length > 0 ? Math.round(totalWordsWritten / works.length) : 0;

  const TABS: { id: WritingTab; label: string; icon: typeof BookOpen }[] = [
    { id: 'works', label: 'My Works', icon: FileText },
    { id: 'editor', label: 'Editor', icon: Edit2 },
    { id: 'prompts', label: 'Prompts', icon: Sparkles },
    { id: 'workshop', label: 'Workshop', icon: Globe },
  ];

  return (
    <div data-lens-theme="creative-writing" className="min-h-screen">
      {/* Focus mode exit button */}
      <AnimatePresence>
        {focusMode && (
          <motion.button
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onClick={() => setFocusMode(false)}
            className="fixed top-4 right-4 z-50 px-3 py-1.5 text-xs bg-amber-500/30 border border-amber-500/50 rounded-lg hover:bg-amber-500/40 flex items-center gap-1 text-amber-300"
          >
            <Minimize2 className="w-3 h-3" /> Exit Focus
          </motion.button>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header — hidden in focus mode */}
        {!focusMode && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BookOpen className="w-6 h-6 text-amber-400" />
                <h1 className="text-2xl font-bold">Creative Writing</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <div className="flex items-center gap-2">
                <DTUExportButton domain="creative-writing" data={{}} compact />
                <button onClick={() => setShowFeatures(!showFeatures)} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Features</button>
                <button onClick={startNewWork} className="px-3 py-1.5 text-xs bg-amber-500/20 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> New Work
                </button>
              </div>
            </div>

            {showFeatures && <LensFeaturePanel lensId="creative-writing" />}
            <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />
      <UniversalActions domain="creative-writing" artifactId={null} compact />

            {/* Tabs */}
            <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', tab === t.id ? 'bg-amber-500/20 text-amber-400' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
                  <t.icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              ))}
            </div>
          </>
        )}

        {(isLoading || dtusLoading) && (
          <div className="flex items-center justify-center py-4">
            <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-gray-400">Loading...</span>
          </div>
        )}

        {isError && <ErrorState error={error?.message} onRetry={refetch} />}

        {/* Works list */}
        {tab === 'works' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search works..." className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-amber-500/50" />
              </div>
              <select value={genreFilter || ''} onChange={e => setGenreFilter((e.target.value || null) as WritingGenre | null)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                <option value="">All genres</option>
                {GENRES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </div>
            {filteredWorks.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No works yet. Start writing!</p>
                <button onClick={startNewWork} className="mt-3 px-4 py-2 text-xs bg-amber-500/20 rounded-lg hover:bg-amber-500/30">New Work</button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredWorks.map((work, i) => {
                  const wc = work.wordCount || 0;
                  const progress = Math.min(100, Math.round((wc / WORD_COUNT_GOAL) * 100));
                  return (
                    <motion.div
                      key={work.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-amber-500/30 transition-colors cursor-pointer overflow-hidden"
                      onClick={() => openWork(work)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium text-sm">{work.title}</h3>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            <span>{work.genre || 'unset'}</span>
                            <span>{wc} words</span>
                            <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> {readingTime(wc)}</span>
                            <span className={cn('px-1.5 py-0.5 rounded', work.status === 'published' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400')}>{work.status || 'draft'}</span>
                            {work.updatedAt && (
                              <span className="text-gray-600">{getRelativeTime(work.updatedAt)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={e => { e.stopPropagation(); openWork(work); }} className="p-1 hover:bg-white/10 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={e => { e.stopPropagation(); removeWork(work.id).then(() => { refetch(); useUIStore.getState().addToast({ type: 'success', message: 'Work deleted' }); }).catch(() => useUIStore.getState().addToast({ type: 'error', message: 'Failed to delete' })); }} className="p-1 hover:bg-white/10 rounded text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                      {work.content && <p className="text-xs text-gray-600 mt-2 line-clamp-2">{work.content.slice(0, 200)}</p>}
                      {/* Word count progress bar */}
                      <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-500/40 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Editor */}
        {tab === 'editor' && (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <input value={editorTitle} onChange={e => setEditorTitle(e.target.value)} placeholder="Untitled work" className="text-lg font-semibold bg-transparent border-none focus:outline-none placeholder-gray-600" />
                <select value={editorGenre} onChange={e => setEditorGenre(e.target.value as WritingGenre)} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs">
                  {GENRES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                {/* Auto-saved indicator */}
                <AnimatePresence>
                  {autoSaved && (
                    <motion.span
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-1 text-xs text-green-400"
                    >
                      <Check className="w-3 h-3" /> Auto-saved
                    </motion.span>
                  )}
                </AnimatePresence>
                <span className="text-xs text-gray-500">{wordCount} words</span>
                {/* Focus mode toggle */}
                <button
                  onClick={() => setFocusMode(f => !f)}
                  className={cn(
                    'px-2.5 py-1.5 text-xs border rounded-lg flex items-center gap-1 transition-colors',
                    focusMode
                      ? 'bg-amber-500/30 border-amber-500/50 text-amber-300 hover:bg-amber-500/40'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                  )}
                >
                  <Maximize2 className="w-3 h-3" /> Focus
                </button>
                <button onClick={saveWork} disabled={isSaving} className="px-3 py-1.5 text-xs bg-amber-500/20 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 flex items-center gap-1 disabled:opacity-50">
                  <Save className="w-3 h-3" /> {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            {/* Stats bar — hidden in focus mode */}
            {!focusMode && (
              <div className="flex items-center gap-4 px-4 py-2 bg-white/5 border border-white/10 rounded-lg">
                <span className="text-xs text-gray-500">{charCount} chars</span>
                <span className="text-xs text-gray-500">{paragraphCount} {paragraphCount === 1 ? 'para' : 'paras'}</span>
                <span className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {estReadingTime}</span>
                <span className="text-xs text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3" /> Session: {sessionLabel}</span>
                {/* Goal progress bar */}
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-gray-500">{wordCount}/{WORD_COUNT_GOAL} goal</span>
                  <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', goalProgress >= 100 ? 'bg-green-500' : 'bg-amber-500/60')}
                      style={{ width: `${goalProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{goalProgress}%</span>
                </div>
              </div>
            )}

            <textarea
              value={editorContent}
              onChange={e => setEditorContent(e.target.value)}
              placeholder="Begin writing..."
              className={cn(
                'w-full px-6 py-4 border border-white/10 rounded-lg leading-relaxed focus:outline-none focus:border-amber-500/30 resize-none font-mono transition-all',
                focusMode
                  ? 'h-[80vh] bg-black/80 text-base text-gray-200'
                  : 'h-[60vh] bg-white/5 text-sm'
              )}
            />
          </div>
        )}

        {/* Prompts */}
        {tab === 'prompts' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5 text-amber-400" /> Writing Prompts</h2>
              <button
                onClick={pickRandomPrompt}
                className="px-3 py-1.5 text-xs bg-amber-500/20 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 flex items-center gap-1 text-amber-400"
              >
                <Shuffle className="w-3 h-3" /> Random Prompt
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {WRITING_PROMPTS.map((prompt, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={cn(
                    'bg-white/5 border rounded-lg p-4 transition-all',
                    highlightedPrompt === i
                      ? 'border-amber-400/60 shadow-[0_0_16px_rgba(251,191,36,0.2)] bg-amber-500/5'
                      : 'border-white/10 hover:border-amber-500/30'
                  )}
                >
                  <p className="text-sm italic text-gray-300 mb-3">&ldquo;{prompt.text}&rdquo;</p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1 flex-wrap">
                      {prompt.genres.slice(0, 2).map(g => (
                        <span key={g} className="px-1.5 py-0.5 text-[10px] bg-amber-500/10 border border-amber-500/20 rounded text-amber-400/70">{g}</span>
                      ))}
                    </div>
                    <button onClick={() => { setEditorContent(prompt.text + '\n\n'); setEditorTitle(''); setEditingWork(null); setTab('editor'); }} className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
                      <PenTool className="w-3 h-3" /> Start writing
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Workshop */}
        {tab === 'workshop' && (
          <div className="space-y-6">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Words', value: totalWordsWritten.toLocaleString(), icon: AlignLeft },
                { label: 'Works', value: works.length, icon: FileText },
                { label: 'Avg. Words', value: avgWordCount.toLocaleString(), icon: BarChart3 },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="bg-white/5 border border-white/10 rounded-lg p-4 flex items-center gap-3"
                >
                  <stat.icon className="w-5 h-5 text-amber-400 opacity-70" />
                  <div>
                    <p className="text-lg font-semibold">{stat.value}</p>
                    <p className="text-xs text-gray-500">{stat.label}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Share for review */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium mb-1">Share for Peer Review</p>
                <p className="text-xs text-gray-500">Get feedback from the community on your latest work.</p>
              </div>
              <button className="px-4 py-2 text-xs bg-amber-500/20 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 flex items-center gap-1.5 text-amber-400 whitespace-nowrap">
                <Users className="w-3.5 h-3.5" /> Share for Review
              </button>
            </div>

            {/* Recent activity placeholder */}
            <div>
              <h3 className="text-sm font-medium mb-3 text-gray-400">Recent Activity</h3>
              <div className="space-y-2">
                {[
                  { text: 'Workshop opens for beta writers next month', icon: Star },
                  { text: 'Peer review matching coming soon', icon: Users },
                  { text: 'Collaborative editing in development', icon: Edit2 },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-500"
                  >
                    <item.icon className="w-3.5 h-3.5 text-amber-400/50 shrink-0" />
                    {item.text}
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="text-xs text-gray-600 text-center">DTUs in workshop: {contextDTUs.length}</div>
          </div>
        )}
      </div>
    </div>
  );
}

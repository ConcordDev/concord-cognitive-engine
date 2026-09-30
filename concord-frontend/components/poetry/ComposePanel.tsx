'use client';

/**
 * ComposePanel — writing desk: editor, live syllable/rhyme, analysis zaps,
 * AI assist, reading mode, Datamuse + PoetryActionPanel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Feather, Hash, Layers, Moon, Save, Sparkles, X, Zap,
} from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { DatamusePanel } from '@/components/linguistics/DatamusePanel';
import { PoetryActionPanel } from '@/components/poetry/PoetryActionPanel';
import {
  POEM_FORMS, POEM_STATUSES, POEM_TEMPLATES, SyllableRhymePanel, ReadingMode,
  type PoemDetail, type PoemForm,
} from '@/components/poetry/poetry-craft';

export interface ComposeIntent {
  /** Bumps whenever Collection/Forms/header asks Compose to reset or load. */
  nonce: number;
  poemId?: string | null;
  form?: PoemForm;
}

export interface ComposePanelProps {
  intent: ComposeIntent;
}

export function ComposePanel({ intent }: ComposePanelProps) {
  const [composingPoem, setComposingPoem] = useState<PoemDetail | null>(null);
  const [compTitle, setCompTitle] = useState('');
  const [compContent, setCompContent] = useState('');
  const [compForm, setCompForm] = useState<PoemForm>('free-verse');
  const [isSaving, setIsSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  // Apply navigation intent from Collection / Forms / New Poem.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (intent.poemId) {
        const r = await lensRun('poetry', 'poem-detail', { id: intent.poemId });
        if (cancelled) return;
        if (r.data?.ok && r.data.result?.poem) {
          const p = r.data.result.poem as PoemDetail;
          setComposingPoem(p);
          setCompTitle(p.title);
          setCompContent(p.body || '');
          setCompForm(p.form || 'free-verse');
        } else {
          useUIStore.getState().addToast({ type: 'error', message: 'Could not load poem' });
        }
        return;
      }
      // New poem (optionally pre-select a form)
      setComposingPoem(null);
      setCompTitle('');
      setCompContent('');
      setCompForm(intent.form || 'free-verse');
      setActionResult(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when nonce changes
  }, [intent.nonce]);

  const handleAction = useCallback(async (action: string) => {
    if (action !== 'formGuide' && !compContent.trim()) return;
    setActiveAction(action);
    try {
      const input = action === 'formGuide' ? { form: compForm } : { text: compContent };
      const r = await lensRun('poetry', action, input);
      if (r.data?.ok && r.data.result) {
        setActionResult({ action, ...(r.data.result as Record<string, unknown>) });
      } else {
        setActionResult({ action, message: `Action failed: ${r.data?.error || 'Unknown error'}` });
      }
    } catch (err) {
      console.error('Poetry action failed:', err);
    } finally {
      setActiveAction(null);
    }
  }, [compContent, compForm]);

  const setPoemStatus = useCallback(async (status: string) => {
    if (!composingPoem) return;
    await lensRun('poetry', 'poem-update', { id: composingPoem.id, status });
    setComposingPoem({ ...composingPoem, status: status as PoemDetail['status'] });
  }, [composingPoem]);

  const savePoem = useCallback(async () => {
    setIsSaving(true);
    try {
      if (composingPoem) {
        await lensRun('poetry', 'poem-update', {
          id: composingPoem.id, title: compTitle || 'Untitled', body: compContent, form: compForm,
        });
      } else {
        const r = await lensRun('poetry', 'poem-create', {
          title: compTitle || 'Untitled', body: compContent, form: compForm,
        });
        if (r.data?.ok && r.data.result?.poem) {
          setComposingPoem(r.data.result.poem as PoemDetail);
        }
      }
    } catch (err) {
      console.error('Save failed:', err instanceof Error ? err.message : err);
    }
    setIsSaving(false);
  }, [compTitle, compContent, compForm, composingPoem]);

  const generatePoem = useCallback(async () => {
    setAiGenerating(true);
    try {
      const resp = await api.post('/api/lens/run', {
        domain: 'creative', action: 'generate', mode: 'structural_poetry', form: compForm,
      });
      const generated = resp.data?.result?.content;
      if (generated) {
        setCompContent((prev) => (prev ? `${prev}\n\n${generated}` : generated));
      }
    } catch (err) {
      console.error('AI generation failed:', err instanceof Error ? err.message : err);
    }
    setAiGenerating(false);
  }, [compForm]);

  const lineCount = useMemo(
    () => compContent.split('\n').filter((l) => l.trim()).length,
    [compContent],
  );
  const wordCount = useMemo(
    () => compContent.trim().split(/\s+/).filter(Boolean).length,
    [compContent],
  );

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {readingMode && (
          <ReadingMode title={compTitle} content={compContent} onClose={() => setReadingMode(false)} />
        )}
      </AnimatePresence>

      {/* Poetry Analysis — analyzes whatever's currently in the editor */}
      <div className="bg-white/3 border border-white/10 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-rose-300 flex items-center gap-2">
          <Zap className="w-4 h-4" /> Poetry Analysis
        </h3>
        <p className="text-[11px] text-gray-400 -mt-1">Analyzes the poem open in this Compose desk.</p>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'meterAnalysis', label: 'Meter Analysis' },
            { action: 'rhymeScheme', label: 'Rhyme Scheme' },
            { action: 'formGuide', label: 'Form Guide' },
            { action: 'wordFrequency', label: 'Word Frequency' },
          ].map(({ action, label }) => (
            <button
              key={action}
              type="button"
              onClick={() => handleAction(action)}
              disabled={activeAction === action || (action !== 'formGuide' && !compContent.trim())}
              className="px-3 py-1.5 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 disabled:opacity-50 flex items-center gap-1.5"
            >
              {activeAction === action
                ? <div className="w-3 h-3 border border-rose-400 border-t-transparent rounded-full animate-spin" />
                : <Zap className="w-3 h-3 text-rose-400" />}
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
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(actionResult.syllablesPerLine as number[]).map((n, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-rose-500/10 rounded text-rose-300 font-mono">{n}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {actionResult.action === 'rhymeScheme' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Scheme: <span className="text-rose-300 font-mono text-sm tracking-widest">{String(actionResult.scheme ?? '')}</span></span>
                  <span className="text-gray-400">Form: <span className="text-white">{String(actionResult.form ?? '')}</span></span>
                  <span className={`${actionResult.rhyming ? 'text-green-400' : 'text-gray-400'}`}>
                    {actionResult.rhyming ? 'Rhymes detected' : 'No rhymes'}
                  </span>
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
                {!!actionResult.tip && <p className="text-gray-400 italic">{String(actionResult.tip)}</p>}
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
                    {(actionResult.topWords as { word: string; count: number }[]).slice(0, 8).map(({ word, count }) => (
                      <span key={word} className="px-2 py-0.5 bg-rose-500/10 rounded text-rose-300 font-mono">
                        {word} <span className="text-gray-400">×{count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setActionResult(null)}
              className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1 mt-1"
            >
              <X className="w-3 h-3" /> Dismiss
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Feather className="w-4 h-4 text-rose-400 shrink-0" />
          <input
            value={compTitle}
            onChange={(e) => setCompTitle(e.target.value)}
            placeholder="Poem title"
            className="text-lg font-semibold bg-transparent border-none focus:outline-none placeholder-gray-600 italic"
          />
          <select
            value={compForm}
            onChange={(e) => {
              const f = e.target.value as PoemForm;
              setCompForm(f);
              if (POEM_TEMPLATES[f] && !compContent) setCompContent('');
            }}
            className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs"
          >
            {POEM_FORMS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">{lineCount} lines / {wordCount} words</span>
          {composingPoem && (
            <select
              value={composingPoem.status}
              onChange={(e) => setPoemStatus(e.target.value)}
              className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs capitalize"
            >
              {POEM_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setShowAnalysis((a) => !a)}
            className={cn(
              'px-2 py-1.5 text-xs rounded-lg flex items-center gap-1',
              showAnalysis
                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/25'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10',
            )}
          >
            <Hash className="w-3 h-3" /> Analysis
          </button>
          <button
            type="button"
            onClick={() => setReadingMode(true)}
            disabled={!compContent.trim()}
            className="px-2 py-1.5 text-xs bg-white/5 rounded-lg hover:bg-white/10 flex items-center gap-1 border border-white/10 disabled:opacity-40"
          >
            <Moon className="w-3 h-3" /> Read
          </button>
          {POEM_TEMPLATES[compForm] && (
            <button
              type="button"
              onClick={() => {
                if (!compContent.trim()) setCompContent(POEM_TEMPLATES[compForm].placeholder);
              }}
              className="px-2 py-1.5 text-xs bg-white/5 rounded-lg hover:bg-white/10 flex items-center gap-1 border border-white/10"
            >
              <Layers className="w-3 h-3" /> Template
            </button>
          )}
          <button
            type="button"
            onClick={generatePoem}
            disabled={aiGenerating}
            className="px-3 py-1.5 text-xs bg-white/5 rounded-lg hover:bg-white/10 flex items-center gap-1 disabled:opacity-50 border border-white/10"
          >
            <Sparkles className="w-3 h-3" /> {aiGenerating ? 'Generating...' : 'AI Assist'}
          </button>
          <button
            type="button"
            onClick={savePoem}
            disabled={isSaving}
            className="px-3 py-1.5 text-xs bg-rose-500/20 border border-rose-500/30 rounded-lg hover:bg-rose-500/30 flex items-center gap-1 disabled:opacity-50"
          >
            <Save className="w-3 h-3" /> {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {POEM_TEMPLATES[compForm] && (
        <p className="text-xs text-gray-400 italic px-1">{POEM_TEMPLATES[compForm].hint}</p>
      )}

      <div className={cn('grid gap-4', showAnalysis ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1')}>
        <div className={showAnalysis ? 'lg:col-span-2' : ''}>
          <textarea
            value={compContent}
            onChange={(e) => setCompContent(e.target.value)}
            placeholder={POEM_TEMPLATES[compForm]?.placeholder || 'Write your poem here...'}
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
      <DatamusePanel domain="poetry" />
      <PoetryActionPanel />
    </div>
  );
}

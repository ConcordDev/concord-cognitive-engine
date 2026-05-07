'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Languages, Plus, Search, X, Trash2, Eye, Layers, ChevronDown,
  BookOpen, Hash, Type, Globe,
  FileText, Sparkles, BookA, GraduationCap, Zap, Loader2,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Analyses' | 'Lexicon' | 'Grammars' | 'Corpora' | 'Translations' | 'Dashboard';
type ArtifactType = 'Analysis' | 'LexiconEntry' | 'Grammar' | 'Corpus' | 'Translation';
type LingSubfield = 'phonology' | 'morphology' | 'syntax' | 'semantics' | 'pragmatics' | 'sociolinguistics' | 'historical' | 'computational' | 'other';

interface LinguisticsArtifact {
  artifactType: ArtifactType;
  subfield: LingSubfield;
  language?: string;
  description: string;
  sourceText?: string;
  targetText?: string;
  glosses?: string[];
  morphemes?: string[];
  syntaxTree?: string;
  ipa?: string;
  examples?: string[];
  notes?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Languages; type: ArtifactType }[] = [
  { id: 'Analyses', label: 'Analyses', icon: FileText, type: 'Analysis' },
  { id: 'Lexicon', label: 'Lexicon', icon: BookOpen, type: 'LexiconEntry' },
  { id: 'Grammars', label: 'Grammars', icon: Type, type: 'Grammar' },
  { id: 'Corpora', label: 'Corpora', icon: Hash, type: 'Corpus' },
  { id: 'Translations', label: 'Translations', icon: Globe, type: 'Translation' },
  { id: 'Dashboard', label: 'Dashboard', icon: Sparkles, type: 'Analysis' },
];

const SUBFIELD_COLORS: Record<LingSubfield, string> = {
  phonology: 'text-pink-400',
  morphology: 'text-purple-400',
  syntax: 'text-blue-400',
  semantics: 'text-green-400',
  pragmatics: 'text-yellow-400',
  sociolinguistics: 'text-orange-400',
  historical: 'text-cyan-400',
  computational: 'text-neon-cyan',
  other: 'text-gray-400',
};

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function LinguisticsLensPage() {
  useLensNav('linguistics');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('linguistics');

  const [activeTab, setActiveTab] = useState<ModeTab>('Analyses');
  const [searchQuery, setSearchQuery] = useState('');
  const [subfieldFilter, setSubfieldFilter] = useState<LingSubfield | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  // Analyze panel
  const [analyzeText, setAnalyzeText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formSubfield, setFormSubfield] = useState<LingSubfield>('syntax');
  const [formLanguage, setFormLanguage] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSourceText, setFormSourceText] = useState('');
  const [formTargetText, setFormTargetText] = useState('');

  const currentType = MODE_TABS.find(t => t.id === activeTab)?.type || 'Analysis';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<LinguisticsArtifact>('linguistics', currentType, {
    seed: [],
  });

  // All items for dashboard
  const { items: analyses } = useLensData<LinguisticsArtifact>('linguistics', 'Analysis', { seed: [] });
  const { items: lexicon } = useLensData<LinguisticsArtifact>('linguistics', 'LexiconEntry', { seed: [] });
  const { items: grammars } = useLensData<LinguisticsArtifact>('linguistics', 'Grammar', { seed: [] });
  const { items: corpora } = useLensData<LinguisticsArtifact>('linguistics', 'Corpus', { seed: [] });
  const { items: translations } = useLensData<LinguisticsArtifact>('linguistics', 'Translation', { seed: [] });

  const runArtifact = useRunArtifact('linguistics');

  const handleAction = useCallback((artifactId: string) => {
    runArtifact.mutate({ id: artifactId, action: 'analyze' });
  }, [runArtifact]);

  // Analyze text through the lens/run endpoint
  const handleAnalyze = useCallback(async () => {
    if (!analyzeText.trim()) return;
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'linguistics',
        action: 'analyze',
        input: { text: analyzeText.trim(), type: 'morphosyntactic' },
      });
      const data = res.data;
      const content = typeof data?.result === 'string'
        ? data.result
        : typeof data?.result?.content === 'string'
          ? data.result.content
          : JSON.stringify(data?.result ?? data, null, 2);
      setAnalyzeResult(content);
    } catch {
      setAnalyzeResult('Analysis unavailable. Try again later.');
    } finally {
      setAnalyzing(false);
    }
  }, [analyzeText]);

  // Filtering
  const filtered = useMemo(() => {
    let list = [...items];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.data.description?.toLowerCase().includes(q) ||
        i.data.language?.toLowerCase().includes(q)
      );
    }
    if (subfieldFilter) {
      list = list.filter(i => i.data.subfield === subfieldFilter);
    }
    return list;
  }, [items, searchQuery, subfieldFilter]);

  const selected = useMemo(() => items.find(i => i.id === selectedId), [items, selectedId]);

  const handleCreate = () => {
    if (!formTitle.trim()) return;
    create({
      title: formTitle,
      data: {
        artifactType: currentType,
        subfield: formSubfield,
        language: formLanguage || undefined,
        description: formDescription,
        sourceText: formSourceText || undefined,
        targetText: formTargetText || undefined,
      },
    });
    setFormTitle('');
    setFormDescription('');
    setFormLanguage('');
    setFormSourceText('');
    setFormTargetText('');
    setShowCreate(false);
  };

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={(error as Error)?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div data-lens-theme="linguistics" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Languages className="w-6 h-6 text-pink-400" />
        <div>
          <h1 className="text-xl font-bold">Linguistics</h1>
          <p className="text-sm text-gray-400">
            Language analysis, lexicon, grammars, corpora, and translations
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {runArtifact.isPending && <Loader2 className="w-4 h-4 animate-spin text-pink-400" />}
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="linguistics" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <UniversalActions domain="linguistics" artifactId={selectedId} compact />
      </header>

      {/* Quick Analyze Panel */}
      <div className="p-4 bg-lattice-surface border border-lattice-border rounded-xl space-y-3">
        <div className="flex items-center gap-2">
          <Type className="w-5 h-5 text-pink-400" />
          <h2 className="text-sm font-semibold text-white">Quick Analysis</h2>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            value={analyzeText}
            onChange={e => setAnalyzeText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            placeholder="Enter text for linguistic analysis..."
            className="flex-1 px-4 py-2.5 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-pink-400 text-sm"
          />
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !analyzeText.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-pink-400/20 text-pink-400 rounded-lg text-sm font-medium hover:bg-pink-400/30 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {analyzing ? (
              <span className="w-4 h-4 border-2 border-pink-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
        {analyzeResult && (
          <div className="p-4 rounded-lg bg-lattice-deep border border-lattice-border">
            <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-auto">
              {analyzeResult}
            </div>
            <button onClick={() => setAnalyzeResult(null)} className="mt-2 text-xs text-gray-400 hover:text-white">
              <X className="w-3 h-3 inline mr-1" /> Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap pb-1">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedId(null); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'bg-pink-400/20 text-pink-400'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface/50'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: FileText, label: 'Analyses', value: analyses.length, color: 'text-pink-400' },
          { icon: BookA, label: 'Lexicon', value: lexicon.length, color: 'text-purple-400' },
          { icon: Type, label: 'Grammars', value: grammars.length, color: 'text-blue-400' },
          { icon: Globe, label: 'Translations', value: translations.length, color: 'text-neon-cyan' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={cn('w-5 h-5 mb-2', stat.color)} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Language Family Tree & Proficiency Badges */}
      {(() => {
        const langs = [...new Set(items.map(i => i.data.language).filter(Boolean))];
        const subfieldCounts = items.reduce<Record<string, number>>((acc, i) => {
          acc[i.data.subfield] = (acc[i.data.subfield] || 0) + 1;
          return acc;
        }, {});
        return langs.length > 0 || Object.keys(subfieldCounts).length > 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {langs.length > 0 && (
              <div className="panel p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <Languages className="w-4 h-4 text-pink-400" /> Languages Studied
                </h3>
                <div className="flex flex-wrap gap-2">
                  {langs.map(lang => {
                    const count = items.filter(i => i.data.language === lang).length;
                    return (
                      <motion.span
                        key={lang}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-400/10 border border-pink-400/20 text-xs text-pink-300"
                      >
                        <Globe className="w-3 h-3" />
                        {lang}
                        <span className="text-pink-500 font-mono">{count}</span>
                      </motion.span>
                    );
                  })}
                </div>
              </div>
            )}
            {Object.keys(subfieldCounts).length > 0 && (
              <div className="panel p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-purple-400" /> Proficiency by Subfield
                </h3>
                <div className="space-y-2">
                  {Object.entries(subfieldCounts).sort((a, b) => b[1] - a[1]).map(([subfield, count]) => (
                    <div key={subfield} className="flex items-center gap-2">
                      <span className={cn('text-xs w-24 capitalize', SUBFIELD_COLORS[subfield as LingSubfield] || 'text-gray-400')}>{subfield}</span>
                      <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
                        <div className="h-full bg-pink-400/60 rounded-full" style={{ width: `${Math.min(100, count * 20)}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ) : null;
      })()}

      {/* Dashboard Tab */}
      {activeTab === 'Dashboard' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="lens-card">
            <FileText className="w-5 h-5 text-pink-400 mb-2" />
            <p className="text-2xl font-bold">{analyses.length}</p>
            <p className="text-sm text-gray-400">Analyses</p>
          </div>
          <div className="lens-card">
            <BookOpen className="w-5 h-5 text-purple-400 mb-2" />
            <p className="text-2xl font-bold">{lexicon.length}</p>
            <p className="text-sm text-gray-400">Lexicon</p>
          </div>
          <div className="lens-card">
            <Type className="w-5 h-5 text-blue-400 mb-2" />
            <p className="text-2xl font-bold">{grammars.length}</p>
            <p className="text-sm text-gray-400">Grammars</p>
          </div>
          <div className="lens-card">
            <Hash className="w-5 h-5 text-green-400 mb-2" />
            <p className="text-2xl font-bold">{corpora.length}</p>
            <p className="text-sm text-gray-400">Corpora</p>
          </div>
          <div className="lens-card">
            <Globe className="w-5 h-5 text-neon-cyan mb-2" />
            <p className="text-2xl font-bold">{translations.length}</p>
            <p className="text-sm text-gray-400">Translations</p>
          </div>
        </motion.div>
      )}

      {activeTab !== 'Dashboard' && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-10 pr-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-pink-400"
              />
            </div>
            <select
              value={subfieldFilter}
              onChange={e => setSubfieldFilter(e.target.value as LingSubfield | '')}
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
            >
              <option value="">All Subfields</option>
              <option value="phonology">Phonology</option>
              <option value="morphology">Morphology</option>
              <option value="syntax">Syntax</option>
              <option value="semantics">Semantics</option>
              <option value="pragmatics">Pragmatics</option>
              <option value="sociolinguistics">Sociolinguistics</option>
              <option value="historical">Historical</option>
              <option value="computational">Computational</option>
            </select>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-1.5 px-3 py-2 bg-pink-400/20 text-pink-400 rounded-lg text-sm font-medium hover:bg-pink-400/30 transition-colors"
            >
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
            <span className="text-sm text-gray-500 ml-auto">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Create Form */}
          {showCreate && (
            <div className="panel p-4 space-y-3">
              <h3 className="font-semibold text-sm">New {currentType}</h3>
              <input
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="Title..."
                className="input-lattice w-full"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={formSubfield}
                  onChange={e => setFormSubfield(e.target.value as LingSubfield)}
                  className="input-lattice"
                >
                  <option value="phonology">Phonology</option>
                  <option value="morphology">Morphology</option>
                  <option value="syntax">Syntax</option>
                  <option value="semantics">Semantics</option>
                  <option value="pragmatics">Pragmatics</option>
                  <option value="sociolinguistics">Sociolinguistics</option>
                  <option value="historical">Historical</option>
                  <option value="computational">Computational</option>
                </select>
                <input
                  value={formLanguage}
                  onChange={e => setFormLanguage(e.target.value)}
                  placeholder="Language..."
                  className="input-lattice"
                />
              </div>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Description..."
                className="input-lattice w-full h-20 resize-none"
              />
              {currentType === 'Translation' && (
                <div className="grid grid-cols-2 gap-3">
                  <textarea
                    value={formSourceText}
                    onChange={e => setFormSourceText(e.target.value)}
                    placeholder="Source text..."
                    className="input-lattice h-20 resize-none"
                  />
                  <textarea
                    value={formTargetText}
                    onChange={e => setFormTargetText(e.target.value)}
                    placeholder="Target text..."
                    className="input-lattice h-20 resize-none"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={!formTitle.trim()} className="px-3 py-1.5 bg-pink-400/20 text-pink-400 rounded-lg text-sm font-medium hover:bg-pink-400/30 disabled:opacity-50">Create</button>
                <button onClick={() => setShowCreate(false)} className="text-sm text-gray-400 hover:text-white">Cancel</button>
              </div>
            </div>
          )}

          {/* Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-2">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-20 bg-lattice-surface animate-pulse rounded-lg" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <Languages className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-sm">No {currentType.toLowerCase()}s yet. Create one to get started.</p>
                </div>
              ) : (
                filtered.map((item, idx) => (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'w-full text-left p-4 rounded-lg border transition-colors',
                      selectedId === item.id
                        ? 'bg-lattice-surface border-pink-400/50'
                        : 'bg-lattice-surface/50 border-lattice-border hover:border-gray-600'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-white">{item.title}</h3>
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.data.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={cn('text-xs', SUBFIELD_COLORS[item.data.subfield] || 'text-gray-400')}>
                            {item.data.subfield}
                          </span>
                          {item.data.language && (
                            <span className="text-xs text-gray-500">{item.data.language}</span>
                          )}
                        </div>
                      </div>
                      <Eye className="w-4 h-4 text-gray-600 flex-shrink-0 mt-1" />
                    </div>
                  </motion.button>
                ))
              )}
            </div>

            {/* Detail Panel */}
            <div className="panel p-4 space-y-4 sticky top-4">
              {selected ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-white">{selected.title}</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleAction(selected.id)} className="text-gray-500 hover:text-pink-400" title="Run AI analysis"><Zap className="w-4 h-4" /></button>
                      <button onClick={() => update(selected.id, { data: { ...selected.data, lastReviewed: new Date().toISOString() } as unknown as Partial<LinguisticsArtifact> })} className="text-gray-500 hover:text-blue-400" title="Update"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => remove(selected.id)} className="text-red-400 hover:text-red-300">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-medium', SUBFIELD_COLORS[selected.data.subfield] || 'text-gray-400')}>
                      {selected.data.subfield}
                    </span>
                    {selected.data.language && (
                      <span className="text-xs text-gray-400 flex items-center gap-0.5">
                        <Globe className="w-3 h-3" /> {selected.data.language}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{selected.data.description}</p>

                  {selected.data.ipa && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">IPA Transcription</h3>
                      <p className="text-sm font-mono text-neon-cyan">{selected.data.ipa}</p>
                    </div>
                  )}
                  {selected.data.morphemes && selected.data.morphemes.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Morphemes</h3>
                      <div className="flex flex-wrap gap-1">
                        {selected.data.morphemes.map((m, i) => (
                          <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-purple-400/10 text-purple-400 font-mono">{m}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.data.syntaxTree && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Syntax Tree</h3>
                      <pre className="text-xs font-mono text-gray-300 bg-lattice-deep p-2 rounded overflow-auto max-h-32">{selected.data.syntaxTree}</pre>
                    </div>
                  )}
                  {selected.data.sourceText && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Source Text</h3>
                      <p className="text-xs text-gray-300 bg-lattice-deep p-2 rounded">{selected.data.sourceText}</p>
                    </div>
                  )}
                  {selected.data.targetText && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Target Text</h3>
                      <p className="text-xs text-gray-300 bg-lattice-deep p-2 rounded">{selected.data.targetText}</p>
                    </div>
                  )}
                  {selected.data.glosses && selected.data.glosses.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Glosses</h3>
                      <div className="flex flex-wrap gap-1">
                        {selected.data.glosses.map((g, i) => (
                          <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-lattice-deep text-gray-300">{g}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.data.examples && selected.data.examples.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Examples</h3>
                      <ul className="space-y-1">
                        {selected.data.examples.map((e, i) => (
                          <li key={i} className="text-xs text-gray-300 pl-3 border-l-2 border-pink-400/30 italic">{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="text-xs text-gray-500 pt-2 border-t border-lattice-border">
                    Created {new Date(selected.createdAt).toLocaleDateString()}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Languages className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Select an item to view details</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="linguistics"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="linguistics" />
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

/**
 * NotebookPanel — Analyses / Lexicon / Grammars / Corpora / Translations /
 * Dashboard artifact desk. Extracted from linguistics/page.tsx consolidation.
 * Owns useLensData CRUD + useRunArtifact('analyze') for saved entries.
 */

import { useState, useMemo, useCallback, useRef, type RefObject } from 'react';
import { motion } from 'framer-motion';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import {
  Languages, Plus, Search, X, Trash2, Eye,
  BookOpen, Hash, Type, Globe,
  FileText, Sparkles, BookA, GraduationCap, Zap, Loader2,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { IpaBreakdown } from '@/components/linguistics/IpaBreakdown';
import {
  type ModeTab,
  type ArtifactType,
  type LingSubfield,
  type LinguisticsArtifact,
  SUBFIELD_COLORS,
} from '@/components/linguistics/linguistics-shared';

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Languages; type: ArtifactType }[] = [
  { id: 'Analyses', label: 'Analyses', icon: FileText, type: 'Analysis' },
  { id: 'Lexicon', label: 'Lexicon', icon: BookOpen, type: 'LexiconEntry' },
  { id: 'Grammars', label: 'Grammars', icon: Type, type: 'Grammar' },
  { id: 'Corpora', label: 'Corpora', icon: Hash, type: 'Corpus' },
  { id: 'Translations', label: 'Translations', icon: Globe, type: 'Translation' },
  { id: 'Dashboard', label: 'Dashboard', icon: Sparkles, type: 'Analysis' },
];

export function NotebookPanel({
  mode,
  searchInputRef: externalSearchRef,
}: {
  mode: ModeTab;
  searchInputRef?: RefObject<HTMLInputElement>;
}) {
  const localSearchRef = useRef<HTMLInputElement>(null);
  const searchInputRef = externalSearchRef ?? localSearchRef;

  const [searchQuery, setSearchQuery] = useState('');
  const [subfieldFilter, setSubfieldFilter] = useState<LingSubfield | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);


  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formSubfield, setFormSubfield] = useState<LingSubfield>('syntax');
  const [formLanguage, setFormLanguage] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSourceText, setFormSourceText] = useState('');
  const [formTargetText, setFormTargetText] = useState('');
  // Type-specific structured fields (Lexicon: ipa/examples; Grammar: morphemes/syntaxTree/glosses) —
  // these map onto LinguisticsArtifact fields the detail panel already renders, but which the
  // create form never captured, so a Lexicon/Grammar entry could never actually carry an IPA
  // transcription, a syntax tree, or morpheme/gloss breakdowns (permanently-dead detail sections).
  const [formIpa, setFormIpa] = useState('');
  const [formExamples, setFormExamples] = useState('');
  const [formMorphemes, setFormMorphemes] = useState('');
  const [formSyntaxTree, setFormSyntaxTree] = useState('');
  const [formGlosses, setFormGlosses] = useState('');

  // Result of running the real `linguistics.analyze` macro against a saved artifact
  // (the "Zap" button in the detail panel). Keyed so switching the selected item doesn't
  // show a stale result under the wrong title.
  const [actionResult, setActionResult] = useState<{ forId: string; content: string } | null>(null);
  const [actionError, setActionError] = useState<{ forId: string; message: string } | null>(null);

  const activeTab = mode;
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

  // Run the real linguistics.analyze macro against a saved artifact. The macro reads
  // `params.text` (falling back to `artifact.data.text`/`.content`, neither of which a
  // CRUD artifact here ever has) — so the fix is sending the artifact's own sourceText
  // (Translation) or description (everything else) as `params.text` explicitly, and then
  // actually rendering the macro's response instead of discarding it silently.
  const handleAction = useCallback((artifactId: string) => {
    const target = items.find(i => i.id === artifactId);
    const text = (target?.data.sourceText || target?.data.description || '').trim();
    setActionResult(null);
    setActionError(null);
    if (!text) {
      setActionError({ forId: artifactId, message: 'Add a description or source text before running analysis.' });
      return;
    }
    runArtifact.mutate(
      { id: artifactId, action: 'analyze', params: { text } },
      {
        onSuccess: (data) => {
          const result = (data as { result?: unknown })?.result;
          if (result && typeof result === 'object' && (result as { ok?: boolean }).ok === false) {
            setActionError({ forId: artifactId, message: (result as { error?: string }).error || 'Analysis failed.' });
            return;
          }
          const content = typeof result === 'string'
            ? result
            : typeof (result as { content?: unknown })?.content === 'string'
              ? (result as { content: string }).content
              : JSON.stringify(result, null, 2);
          setActionResult({ forId: artifactId, content });
        },
        onError: (e) => setActionError({ forId: artifactId, message: (e as Error)?.message || 'Analysis failed.' }),
      },
    );
  }, [runArtifact, items]);


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
    const splitList = (s: string): string[] | undefined => {
      const parts = s.split(/[,\n]+/).map(x => x.trim()).filter(Boolean);
      return parts.length ? parts : undefined;
    };
    create({
      title: formTitle,
      data: {
        artifactType: currentType,
        subfield: formSubfield,
        language: formLanguage || undefined,
        description: formDescription,
        sourceText: formSourceText || undefined,
        targetText: formTargetText || undefined,
        ipa: currentType === 'LexiconEntry' ? (formIpa.trim() || undefined) : undefined,
        examples: currentType === 'LexiconEntry' ? splitList(formExamples) : undefined,
        morphemes: currentType === 'Grammar' ? splitList(formMorphemes) : undefined,
        syntaxTree: currentType === 'Grammar' ? (formSyntaxTree.trim() || undefined) : undefined,
        glosses: currentType === 'Grammar' ? splitList(formGlosses) : undefined,
      },
    });
    setFormTitle('');
    setFormDescription('');
    setFormLanguage('');
    setFormSourceText('');
    setFormTargetText('');
    setFormIpa('');
    setFormExamples('');
    setFormMorphemes('');
    setFormSyntaxTree('');
    setFormGlosses('');
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
    <div className="space-y-6">
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
                      <span className="text-xs text-gray-400 w-8 text-right">{count}</span>
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
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
            <span className="text-sm text-gray-400 ml-auto">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
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
              {currentType === 'LexiconEntry' && (
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={formIpa}
                    onChange={e => setFormIpa(e.target.value)}
                    placeholder="IPA transcription (e.g. /səˈɹɛndɪpɪti/)..."
                    className="input-lattice font-mono"
                  />
                  <input
                    value={formExamples}
                    onChange={e => setFormExamples(e.target.value)}
                    placeholder="Example sentences, comma-separated..."
                    className="input-lattice"
                  />
                  {formIpa.trim() && (
                    <div className="col-span-2">
                      <IpaBreakdown ipa={formIpa} />
                    </div>
                  )}
                </div>
              )}
              {currentType === 'Grammar' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={formMorphemes}
                      onChange={e => setFormMorphemes(e.target.value)}
                      placeholder="Morphemes, comma-separated (un-, break, -able)..."
                      className="input-lattice font-mono"
                    />
                    <input
                      value={formGlosses}
                      onChange={e => setFormGlosses(e.target.value)}
                      placeholder="Glosses, comma-separated (NEG-break-ABIL)..."
                      className="input-lattice font-mono"
                    />
                  </div>
                  <textarea
                    value={formSyntaxTree}
                    onChange={e => setFormSyntaxTree(e.target.value)}
                    placeholder="Syntax tree (bracket notation, e.g. [S [NP the cat] [VP sat]])..."
                    className="input-lattice w-full h-16 resize-none font-mono text-xs"
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
                <div className="text-center py-16 text-gray-400">
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
                            <span className="text-xs text-gray-400">{item.data.language}</span>
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
                      <button
                        onClick={() => handleAction(selected.id)}
                        disabled={runArtifact.isPending}
                        className="text-gray-400 hover:text-pink-400 disabled:opacity-40"
                        title="Run morphosyntactic analysis on this entry's text"
                      >
                        {runArtifact.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      </button>
                      <button onClick={() => update(selected.id, { data: { ...selected.data, lastReviewed: new Date().toISOString() } as unknown as Partial<LinguisticsArtifact> })} className="text-gray-400 hover:text-blue-400" title="Update"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => remove(selected.id)} className="text-red-400 hover:text-red-300" aria-label="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {actionResult?.forId === selected.id && (
                    <div className="p-3 rounded-lg bg-pink-400/5 border border-pink-400/20">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wide text-pink-300 font-semibold">Analysis</span>
                        <button onClick={() => setActionResult(null)} className="text-gray-500 hover:text-white" aria-label="Dismiss analysis"><X className="w-3 h-3" aria-hidden="true" /></button>
                      </div>
                      <p className="text-xs text-gray-300 whitespace-pre-wrap max-h-40 overflow-auto">{actionResult.content}</p>
                    </div>
                  )}
                  {actionError?.forId === selected.id && (
                    <div className="p-3 rounded-lg bg-red-400/5 border border-red-400/20">
                      <p className="text-xs text-red-300">{actionError.message}</p>
                    </div>
                  )}
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
                      <IpaBreakdown ipa={selected.data.ipa} />
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
                  <div className="text-xs text-gray-400 pt-2 border-t border-lattice-border">
                    Created {new Date(selected.createdAt).toLocaleDateString()}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <Languages className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Select an item to view details</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

    </div>
  );
}

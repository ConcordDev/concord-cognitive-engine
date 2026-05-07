'use client';

import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { showToast } from '@/components/common/Toasts';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useMemo, useCallback } from 'react';
import {
  FileText, Plus, Search, Calendar, FlaskConical, CheckCircle, AlertTriangle,
  BookOpen, Lightbulb, Beaker, Brain, Library, ChevronDown, ChevronRight,
  X, Trash2, Edit3, Save, Download, BarChart3, Clock,
  Link2, ArrowUpDown, Copy, FileDown, Quote, Hash, Target,
  TrendingUp, TrendingDown, ListTree, PanelRightClose,
  RefreshCw, Sparkles, ShieldCheck, AlertCircle, Layers, type LucideIcon
} from 'lucide-react';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ErrorState } from '@/components/common/EmptyState';
import { useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModeTab = 'papers' | 'hypotheses' | 'evidence' | 'experiments' | 'synthesis' | 'bibliography';

interface PaperData {
  excerpt?: string;
  wordCount?: number;
  content?: string;
  sections?: PaperSection[];
  doi?: string;
}

interface PaperSection {
  heading: string;
  body: string;
}

interface HypothesisData {
  statement?: string;
  status?: 'proposed' | 'testing' | 'supported' | 'refuted';
  confidence?: number;
  linkedEvidence?: string[];
  linkedExperiments?: string[];
  rationale?: string;
}

interface EvidenceData {
  source?: string;
  strength?: 'weak' | 'moderate' | 'strong';
  type?: 'empirical' | 'theoretical' | 'anecdotal';
  summary?: string;
  linkedHypotheses?: string[];
}

interface ExperimentData {
  status?: 'planned' | 'running' | 'completed' | 'failed';
  methodology?: string;
  results?: string;
  conclusions?: string;
  linkedHypothesis?: string;
  linkedEvidence?: string[];
  startDate?: string;
  endDate?: string;
}

interface CitationData {
  doi?: string;
  authors?: string;
  year?: number;
  journal?: string;
  volume?: string;
  pages?: string;
  url?: string;
  citedByCount?: number;
  style?: 'apa' | 'mla' | 'chicago';
}

type _AnyData = PaperData | HypothesisData | EvidenceData | ExperimentData | CitationData;

// Helper type-safe data accessor
function getData<T>(item: LensItem): T {
  return (item.data ?? {}) as T;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_TABS: { key: ModeTab; label: string; icon: LucideIcon }[] = [
  { key: 'papers', label: 'Papers', icon: FileText },
  { key: 'hypotheses', label: 'Hypotheses', icon: Lightbulb },
  { key: 'evidence', label: 'Evidence', icon: ShieldCheck },
  { key: 'experiments', label: 'Experiments', icon: Beaker },
  { key: 'synthesis', label: 'Synthesis', icon: Brain },
  { key: 'bibliography', label: 'Bibliography', icon: Library },
];

const PAPER_SECTIONS = [
  'Abstract', 'Introduction', 'Literature Review', 'Methods', 'Results', 'Discussion', 'Conclusion',
];

const HYPOTHESIS_STATUSES: HypothesisData['status'][] = ['proposed', 'testing', 'supported', 'refuted'];
const EVIDENCE_STRENGTHS: EvidenceData['strength'][] = ['weak', 'moderate', 'strong'];
const EVIDENCE_TYPES: EvidenceData['type'][] = ['empirical', 'theoretical', 'anecdotal'];
const EXPERIMENT_STATUSES: ExperimentData['status'][] = ['planned', 'running', 'completed', 'failed'];
const CITATION_STYLES: CitationData['style'][] = ['apa', 'mla', 'chicago'];

const STATUS_COLORS: Record<string, string> = {
  proposed: 'neon-blue',
  testing: 'neon-cyan',
  supported: 'neon-green',
  refuted: 'red-400',
  planned: 'gray-400',
  running: 'neon-cyan',
  completed: 'neon-green',
  failed: 'red-400',
  weak: 'red-400',
  moderate: 'yellow-400',
  strong: 'neon-green',
  empirical: 'neon-blue',
  theoretical: 'neon-purple',
  anecdotal: 'gray-400',
};

// ---------------------------------------------------------------------------
// Helper: Citation Formatters
// ---------------------------------------------------------------------------

function formatAPA(c: CitationData & { title?: string }): string {
  const authors = c.authors || 'Unknown';
  const year = c.year || 'n.d.';
  const title = c.title || 'Untitled';
  const journal = c.journal ? ` ${c.journal}` : '';
  const vol = c.volume ? `, ${c.volume}` : '';
  const pages = c.pages ? `, ${c.pages}` : '';
  return `${authors} (${year}). ${title}.${journal}${vol}${pages}.`;
}

function formatMLA(c: CitationData & { title?: string }): string {
  const authors = c.authors || 'Unknown';
  const title = c.title || 'Untitled';
  const journal = c.journal || '';
  const vol = c.volume ? ` ${c.volume}` : '';
  const year = c.year || 'n.d.';
  const pages = c.pages ? `: ${c.pages}` : '';
  return `${authors}. "${title}." ${journal}${vol} (${year})${pages}.`;
}

function formatChicago(c: CitationData & { title?: string }): string {
  const authors = c.authors || 'Unknown';
  const title = c.title || 'Untitled';
  const journal = c.journal ? ` ${c.journal}` : '';
  const vol = c.volume ? ` ${c.volume}` : '';
  const year = c.year || 'n.d.';
  const pages = c.pages ? `: ${c.pages}` : '';
  return `${authors}. "${title}."${journal}${vol} (${year})${pages}.`;
}

function formatCitation(c: CitationData & { title?: string }, style: CitationData['style']): string {
  switch (style) {
    case 'mla': return formatMLA(c);
    case 'chicago': return formatChicago(c);
    default: return formatAPA(c);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PaperLensPage() {
  useLensNav('paper');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('paper');

  // ---- State ----
  const [activeTab, setActiveTab] = useState<ModeTab>('papers');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [editorTitle, setEditorTitle] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['Abstract']));
  const [sortField, setSortField] = useState<'updatedAt' | 'title'>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [citationStyle, setCitationStyle] = useState<CitationData['style']>('apa');
  const [showFeatures, setShowFeatures] = useState(true);

  // ---- Modal state for creating items ----
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStatement, setNewStatement] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newStrength, setNewStrength] = useState<EvidenceData['strength']>('moderate');
  const [newEvidenceType, setNewEvidenceType] = useState<EvidenceData['type']>('empirical');
  const [newMethodology, setNewMethodology] = useState('');
  const [newDoi, setNewDoi] = useState('');
  const [newAuthors, setNewAuthors] = useState('');
  const [newYear, setNewYear] = useState('');
  const [newJournal, setNewJournal] = useState('');

  // ---- Synthesis state ----
  const [synthesisResult, setSynthesisResult] = useState<string | null>(null);

  // ---- Artifact type mapping for each tab ----
  const typeForTab: Record<ModeTab, string> = useMemo(() => ({
    papers: 'project',
    hypotheses: 'hypothesis',
    evidence: 'evidence',
    experiments: 'experiment',
    synthesis: 'project',
    bibliography: 'citation',
  }), []);

  // ---- Data hooks ----
  const {
    isLoading, isError, error, refetch, items: paperItems,
    create: createArtifact, update: updateArtifact, remove: removeArtifact,
  } = useLensData('paper', typeForTab[activeTab], {
    search: searchQuery || undefined,
    tags: selectedTag ? [selectedTag] : undefined,
    status: statusFilter || undefined,
  });

  // Fetch all types for dashboard stats
  const { items: allPapers } = useLensData('paper', 'project', { noSeed: true });
  const { items: allHypotheses } = useLensData('paper', 'hypothesis', { noSeed: true });
  const { items: allEvidence } = useLensData('paper', 'evidence', { noSeed: true });
  const { items: allExperiments } = useLensData('paper', 'experiment', { noSeed: true });
  const { items: allCitations } = useLensData('paper', 'citation', { noSeed: true });

  const runArtifact = useRunArtifact('paper');

  // ---- Validation mutation (existing pattern) ----
  const [validationResults, setValidationResults] = useState<Record<string, { passRate: number; issueCount: number; claimsChecked: number }>>({});
  const validateMutation = useMutation({
    mutationFn: async (artifact: { id: string; title: string; data: Record<string, unknown> }) => {
      const res = await apiHelpers.bridge.lensValidate(artifact);
      return { id: artifact.id, result: res.data };
    },
    onSuccess: (data) => {
      if (data.result?.ok) {
        setValidationResults(prev => ({
          ...prev,
          [data.id]: {
            passRate: data.result.passRate ?? 1,
            issueCount: data.result.issueCount ?? 0,
            claimsChecked: data.result.claimsChecked ?? 0,
          },
        }));
      }
    },
    onError: (err) => {
      console.error('Validation failed:', err instanceof Error ? err.message : err);
    },
  });

  // ---- Derived data ----
  const allTags = useMemo(
    () => Array.from(new Set(paperItems.flatMap(item => item.meta?.tags || []))),
    [paperItems]
  );

  const selectedItem = useMemo(
    () => paperItems.find(i => i.id === selectedItemId) || null,
    [paperItems, selectedItemId]
  );

  const sortedItems = useMemo(() => {
    const clone = [...paperItems];
    clone.sort((a, b) => {
      const va = sortField === 'title' ? a.title : a.updatedAt;
      const vb = sortField === 'title' ? b.title : b.updatedAt;
      const cmp = String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return clone;
  }, [paperItems, sortField, sortDir]);

  // ---- Stat counts ----
  const stats = useMemo(() => ({
    papers: allPapers.length,
    hypotheses: allHypotheses.filter(h => {
      const d = getData<HypothesisData>(h);
      return d.status === 'proposed' || d.status === 'testing';
    }).length,
    evidence: allEvidence.length,
    experiments: allExperiments.filter(e => getData<ExperimentData>(e).status === 'completed').length,
  }), [allPapers, allHypotheses, allEvidence, allExperiments]);

  // ---- Callbacks ----
  const toggleSection = useCallback((s: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(s)) { next.delete(s); } else { next.add(s); }
      return next;
    });
  }, []);

  const wordCount = useMemo(() => editorContent.split(/\s+/).filter(Boolean).length, [editorContent]);
  const readingTime = useMemo(() => Math.max(1, Math.ceil(wordCount / 250)), [wordCount]);

  const openEditor = useCallback((item: LensItem) => {
    const d = getData<PaperData>(item);
    setEditorTitle(item.title);
    setEditorContent(d.content || d.excerpt || '');
    setSelectedItemId(item.id);
    setEditorOpen(true);
  }, []);

  const saveEditor = useCallback(async () => {
    if (!selectedItemId) return;
    await updateArtifact(selectedItemId, {
      title: editorTitle,
      data: {
        content: editorContent,
        excerpt: editorContent.slice(0, 200),
        wordCount,
      },
    });
    setEditorOpen(false);
  }, [selectedItemId, editorTitle, editorContent, wordCount, updateArtifact]);

  const openDetail = useCallback((item: LensItem) => {
    setSelectedItemId(item.id);
    setDetailOpen(true);
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      switch (activeTab) {
        case 'papers':
          await createArtifact({ title: newTitle || 'Untitled Paper', data: { wordCount: 0, excerpt: '', content: '', sections: PAPER_SECTIONS.map(h => ({ heading: h, body: '' })) }, meta: { tags: [] } });
          break;
        case 'hypotheses':
          await createArtifact({ title: newTitle || 'Untitled Hypothesis', data: { statement: newStatement, status: 'proposed', confidence: 50, linkedEvidence: [], linkedExperiments: [], rationale: '' }, meta: { tags: [] } });
          break;
        case 'evidence':
          await createArtifact({ title: newTitle || 'Untitled Evidence', data: { source: newSource, strength: newStrength, type: newEvidenceType, summary: '', linkedHypotheses: [] }, meta: { tags: [] } });
          break;
        case 'experiments':
          await createArtifact({ title: newTitle || 'Untitled Experiment', data: { status: 'planned', methodology: newMethodology, results: '', conclusions: '', linkedHypothesis: '', linkedEvidence: [] }, meta: { tags: [] } });
          break;
        case 'bibliography':
          await createArtifact({ title: newTitle || 'Untitled Citation', data: { doi: newDoi, authors: newAuthors, year: parseInt(newYear) || undefined, journal: newJournal, citedByCount: 0 }, meta: { tags: [] } });
          break;
        default:
          break;
      }
      setCreateModalOpen(false);
      resetCreateForm();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create item');
    }
  }, [activeTab, newTitle, newStatement, newSource, newStrength, newEvidenceType, newMethodology, newDoi, newAuthors, newYear, newJournal, createArtifact]);

  const resetCreateForm = () => {
    setNewTitle('');
    setNewStatement('');
    setNewSource('');
    setNewStrength('moderate');
    setNewEvidenceType('empirical');
    setNewMethodology('');
    setNewDoi('');
    setNewAuthors('');
    setNewYear('');
    setNewJournal('');
  };

  const handleDomainAction = useCallback(async (action: string) => {
    if (!selectedItemId) return;
    try {
      const result = await runArtifact.mutateAsync({ id: selectedItemId, action });
      if (result.ok === false) {
        setSynthesisResult(`Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}`);
      } else if (action === 'generate_abstract' || action === 'synthesize') {
        setSynthesisResult(typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2));
      }
    } catch (e) { console.error(`Paper action ${action} failed:`, e); }
  }, [selectedItemId, runArtifact]);

  const handleExportCSV = useCallback(() => {
    const headers = ['Title', 'Type', 'Tags', 'Status', 'Updated'];
    const rows = paperItems.map(i => [
      i.title,
      typeForTab[activeTab],
      (i.meta?.tags || []).join('; '),
      i.meta?.status || '',
      i.updatedAt,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paper-lens-${activeTab}-export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [paperItems, activeTab, typeForTab]);

  const handleExportBibTeX = useCallback(() => {
    const entries = allCitations.map((c, idx) => {
      const d = getData<CitationData>(c);
      const key = `ref${idx + 1}`;
      return `@article{${key},\n  author = {${d.authors || ''}},\n  title = {${c.title}},\n  journal = {${d.journal || ''}},\n  year = {${d.year || ''}},\n  doi = {${d.doi || ''}}\n}`;
    });
    const bibtex = entries.join('\n\n');
    const blob = new Blob([bibtex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bibliography.bib';
    a.click();
    URL.revokeObjectURL(url);
  }, [allCitations]);

  const handleExportLaTeX = useCallback(() => {
    if (!selectedItem) return;
    const d = getData<PaperData>(selectedItem);
    const sections = d.sections || PAPER_SECTIONS.map(h => ({ heading: h, body: '' }));
    const latex = [
      '\\documentclass{article}',
      '\\usepackage[utf8]{inputenc}',
      `\\title{${selectedItem.title}}`,
      '\\author{}',
      '\\date{\\today}',
      '\\begin{document}',
      '\\maketitle',
      ...sections.map(s => `\\section{${s.heading}}\n${s.body || ''}`),
      '\\end{document}',
    ].join('\n\n');
    const blob = new Blob([latex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedItem.title.replace(/\s+/g, '_')}.tex`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedItem]);

  // ---- Loading state ----
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  // ====================================================================
  // RENDER
  // ====================================================================

  return (
    <div className={ds.pageContainer}>
      {/* ---- Header ---- */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neon-purple/20 border border-neon-purple/30">
            <FileText className="w-6 h-6 text-neon-purple" />
          </div>
          <div>
            <h1 className={ds.heading1}>Paper Lens</h1>
            <p className={ds.textMuted}>
              Research workspace -- papers, hypotheses, evidence, experiments, and citations
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="paper" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCSV} className={cn(ds.btnGhost, ds.btnSmall)} title="Export CSV">
            <Download className="w-4 h-4" /> CSV
          </button>
          <button onClick={handleExportBibTeX} className={cn(ds.btnGhost, ds.btnSmall)} title="Export BibTeX">
            <FileDown className="w-4 h-4" /> BibTeX
          </button>
          {selectedItem && activeTab === 'papers' && (
            <button onClick={handleExportLaTeX} className={cn(ds.btnGhost, ds.btnSmall)} title="Export LaTeX">
              <FileDown className="w-4 h-4" /> LaTeX
            </button>
          )}
          <button
            onClick={() => { resetCreateForm(); setCreateModalOpen(true); }}
            className={ds.btnPrimary}
          >
            <Plus className="w-4 h-4" />
            New {activeTab === 'bibliography' ? 'Citation' : activeTab.slice(0, -1).replace(/^./, c => c.toUpperCase())}
          </button>
        </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Papers', value: stats.papers, icon: FileText },
          { label: 'Citations', value: allCitations.length, icon: Link2 },
          { label: 'Hypotheses', value: stats.hypotheses, icon: Lightbulb },
          { label: 'Experiments', value: stats.experiments, icon: Beaker },
        ].map((stat) => (
          <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
            <stat.icon className="w-5 h-5 text-neon-purple shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Dashboard Stats ---- */}
      <div className={ds.grid4}>
        <StatCard icon={FileText} label="Total Papers" value={stats.papers} color="neon-purple" />
        <StatCard icon={Lightbulb} label="Active Hypotheses" value={stats.hypotheses} color="neon-blue" />
        <StatCard icon={ShieldCheck} label="Evidence Items" value={stats.evidence} color="neon-cyan" />
        <StatCard icon={Beaker} label="Experiments Run" value={stats.experiments} color="neon-green" />
      </div>

      {/* ---- Mode Tabs ---- */}
      <div className="flex items-center gap-1 border-b border-lattice-border pb-0 flex-wrap">
        {MODE_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSelectedItemId(null); setDetailOpen(false); setEditorOpen(false); }}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                isActive
                  ? 'border-neon-purple text-neon-purple'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-500'
              )}>
                {activeTab === tab.key ? sortedItems.length : '--'}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---- Search & Filters ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            className={cn(ds.input, 'pl-10')}
          />
        </div>
        <select value={selectedTag || ''} onChange={e => setSelectedTag(e.target.value || null)} className={cn(ds.select, 'w-auto min-w-[140px]')}>
          <option value="">All Tags</option>
          {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        {(activeTab === 'hypotheses' || activeTab === 'experiments') && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={cn(ds.select, 'w-auto min-w-[140px]')}>
            <option value="">All Statuses</option>
            {(activeTab === 'hypotheses' ? HYPOTHESIS_STATUSES : EXPERIMENT_STATUSES).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}
          className={cn(ds.btnGhost, ds.btnSmall)}
          title={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
        >
          <ArrowUpDown className="w-4 h-4" />
        </button>
        <button onClick={() => setSortField(f => f === 'title' ? 'updatedAt' : 'title')} className={cn(ds.btnGhost, ds.btnSmall)}>
          {sortField === 'title' ? 'By Date' : 'By Name'}
        </button>
      </div>

      {/* ---- Domain Actions Bar ---- */}
      {selectedItemId && (
        <div className={cn(ds.panel, 'flex flex-wrap items-center gap-2')}>
          <span className={ds.textMuted}>Actions:</span>
          <button onClick={() => handleDomainAction('validate_claims')} className={cn(ds.btnSecondary, ds.btnSmall)} disabled={runArtifact.isPending}>
            <FlaskConical className="w-3.5 h-3.5" /> Validate Claims
          </button>
          <button onClick={() => handleDomainAction('check_consistency')} className={cn(ds.btnSecondary, ds.btnSmall)} disabled={runArtifact.isPending}>
            <ShieldCheck className="w-3.5 h-3.5" /> Check Consistency
          </button>
          <button onClick={() => handleDomainAction('generate_abstract')} className={cn(ds.btnSecondary, ds.btnSmall)} disabled={runArtifact.isPending}>
            <Sparkles className="w-3.5 h-3.5" /> Generate Abstract
          </button>
          <button onClick={() => handleDomainAction('export_pdf')} className={cn(ds.btnSecondary, ds.btnSmall)} disabled={runArtifact.isPending}>
            <FileDown className="w-3.5 h-3.5" /> Export PDF
          </button>
          {runArtifact.isPending && <RefreshCw className="w-4 h-4 text-neon-cyan animate-spin" />}
        </div>
      )}

      {/* ---- Main Content Area ---- */}
      <div className="flex gap-4 min-h-[500px]">
        {/* Left: Items list / Editor left panel */}
        <div className={cn('flex-1 space-y-4', detailOpen && 'max-w-[65%]')}>
          {/* ---- Editor Split View (Papers tab) ---- */}
          {editorOpen && activeTab === 'papers' && (
            <div className="grid grid-cols-[240px_1fr] gap-4 mb-4">
              {/* Document Outline */}
              <div className={cn(ds.panel, 'space-y-1 max-h-[600px] overflow-y-auto')}>
                <h3 className={cn(ds.heading3, 'text-sm mb-2 flex items-center gap-2')}>
                  <ListTree className="w-4 h-4 text-neon-purple" /> Outline
                </h3>
                {PAPER_SECTIONS.map(section => (
                  <button
                    key={section}
                    onClick={() => toggleSection(section)}
                    className={cn(
                      'w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
                      expandedSections.has(section)
                        ? 'bg-neon-purple/10 text-neon-purple'
                        : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
                    )}
                  >
                    {expandedSections.has(section) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {section}
                  </button>
                ))}
              </div>

              {/* Editor Panel */}
              <div className={cn(ds.panel, 'space-y-3')}>
                <div className="flex items-center justify-between">
                  <input
                    type="text"
                    value={editorTitle}
                    onChange={e => setEditorTitle(e.target.value)}
                    className={cn(ds.input, 'text-lg font-semibold bg-transparent border-none focus:ring-0 p-0')}
                    placeholder="Paper title..."
                  />
                  <div className="flex items-center gap-2">
                    <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                      <Hash className="w-3 h-3" /> {wordCount} words
                    </span>
                    <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                      <Clock className="w-3 h-3" /> {readingTime} min read
                    </span>
                  </div>
                </div>
                {/* Section navigation */}
                <div className="flex flex-wrap gap-1">
                  {PAPER_SECTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => toggleSection(s)}
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full transition-colors',
                        expandedSections.has(s) ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-500 hover:text-gray-300'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <textarea
                  value={editorContent}
                  onChange={e => setEditorContent(e.target.value)}
                  className={cn(ds.textarea, 'min-h-[400px] font-mono text-sm leading-relaxed')}
                  placeholder="Begin writing your paper..."
                />
                <div className="flex items-center justify-between">
                  <button onClick={() => setEditorOpen(false)} className={cn(ds.btnGhost, ds.btnSmall)}>
                    <X className="w-4 h-4" /> Cancel
                  </button>
                  <button onClick={saveEditor} className={cn(ds.btnPrimary, ds.btnSmall)}>
                    <Save className="w-4 h-4" /> Save Paper
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ---- Tab-Specific Content ---- */}
          {activeTab === 'papers' && !editorOpen && <PapersGrid items={sortedItems} onEdit={openEditor} onSelect={openDetail} onValidate={(item) => validateMutation.mutate({ id: item.id, title: item.title, data: item.data as Record<string, unknown> })} validationResults={validationResults} isValidating={validateMutation.isPending} />}
          {activeTab === 'hypotheses' && <HypothesesList items={sortedItems} onSelect={openDetail} allEvidence={allEvidence} />}
          {activeTab === 'evidence' && <EvidenceBoard items={sortedItems} onSelect={openDetail} />}
          {activeTab === 'experiments' && <ExperimentLog items={sortedItems} onSelect={openDetail} />}
          {activeTab === 'synthesis' && <SynthesisEngine items={sortedItems} allHypotheses={allHypotheses} allEvidence={allEvidence} allExperiments={allExperiments} synthesisResult={synthesisResult} onRunSynthesize={() => { if (sortedItems[0]) { setSelectedItemId(sortedItems[0].id); handleDomainAction('synthesize'); } }} isPending={runArtifact.isPending} />}
          {activeTab === 'bibliography' && <BibliographyManager items={sortedItems} onSelect={openDetail} citationStyle={citationStyle} onStyleChange={setCitationStyle} />}

          {sortedItems.length === 0 && !editorOpen && (
            <div className={cn(ds.panel, 'text-center py-16')}>
              <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className={ds.heading3}>No {activeTab} found</p>
              <p className={cn(ds.textMuted, 'mt-2')}>Create your first {activeTab === 'bibliography' ? 'citation' : activeTab.slice(0, -1)} to get started.</p>
              <button onClick={() => { resetCreateForm(); setCreateModalOpen(true); }} className={cn(ds.btnPrimary, 'mt-4')}>
                <Plus className="w-4 h-4" /> Create
              </button>
            </div>
          )}
        </div>

        {/* ---- Detail Side Panel ---- */}
        {detailOpen && selectedItem && (
          <div className={cn(ds.panel, 'w-[35%] min-w-[300px] max-h-[calc(100vh-200px)] overflow-y-auto space-y-4 sticky top-6')}>
            <div className="flex items-center justify-between">
              <h3 className={ds.heading3}>Detail</h3>
              <button onClick={() => setDetailOpen(false)} className={ds.btnGhost}>
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <span className={ds.label}>Title</span>
                <p className="text-white font-medium">{selectedItem.title}</p>
              </div>

              <div>
                <span className={ds.label}>Type</span>
                <p className={ds.textMono}>{typeForTab[activeTab]}</p>
              </div>

              <div>
                <span className={ds.label}>Tags</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(selectedItem.meta?.tags || []).length > 0
                    ? selectedItem.meta.tags.map((t: string) => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">{t}</span>
                      ))
                    : <span className={ds.textMuted}>No tags</span>
                  }
                </div>
              </div>

              <div>
                <span className={ds.label}>Last Updated</span>
                <p className={cn(ds.textMuted, 'flex items-center gap-1')}>
                  <Calendar className="w-3 h-3" /> {new Date(selectedItem.updatedAt).toLocaleString()}
                </p>
              </div>

              <div>
                <span className={ds.label}>Version</span>
                <p className={ds.textMono}>v{selectedItem.version}</p>
              </div>

              {/* Tab-specific detail fields */}
              {activeTab === 'papers' && <PaperDetailFields item={selectedItem} />}
              {activeTab === 'hypotheses' && <HypothesisDetailFields item={selectedItem} allEvidence={allEvidence} />}
              {activeTab === 'evidence' && <EvidenceDetailFields item={selectedItem} />}
              {activeTab === 'experiments' && <ExperimentDetailFields item={selectedItem} />}
              {activeTab === 'bibliography' && <CitationDetailFields item={selectedItem} citationStyle={citationStyle} />}

              {/* Validation results in detail */}
              {validationResults[selectedItem.id] && (
                <div className="space-y-1">
                  <span className={ds.label}>Validation</span>
                  <div className={cn('p-2 rounded-lg', validationResults[selectedItem.id].passRate >= 0.8 ? 'bg-neon-green/10' : 'bg-red-500/10')}>
                    <p className="text-sm text-white">Pass Rate: {Math.round(validationResults[selectedItem.id].passRate * 100)}%</p>
                    <p className={ds.textMuted}>{validationResults[selectedItem.id].claimsChecked} claims checked, {validationResults[selectedItem.id].issueCount} issues</p>
                  </div>
                </div>
              )}

              {/* Version History Placeholder */}
              <div>
                <span className={ds.label}>Version History</span>
                <div className="space-y-1 mt-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span>v{selectedItem.version} -- {new Date(selectedItem.updatedAt).toLocaleDateString()}</span>
                  </div>
                  {selectedItem.version > 1 && (
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <Clock className="w-3 h-3" />
                      <span>v1 -- {new Date(selectedItem.createdAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-lattice-border">
                {activeTab === 'papers' && (
                  <button onClick={() => openEditor(selectedItem)} className={cn(ds.btnSecondary, ds.btnSmall)}>
                    <Edit3 className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
                <button
                  onClick={async () => {
                    await removeArtifact(selectedItem.id);
                    setDetailOpen(false);
                    setSelectedItemId(null);
                  }}
                  className={cn(ds.btnDanger, ds.btnSmall)}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- Create Modal ---- */}
      {createModalOpen && (
        <>
          <div className={ds.modalBackdrop} onClick={() => setCreateModalOpen(false)} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg p-6 space-y-4')}>
              <div className="flex items-center justify-between">
                <h2 className={ds.heading2}>
                  New {activeTab === 'bibliography' ? 'Citation' : activeTab.slice(0, -1).replace(/^./, c => c.toUpperCase())}
                </h2>
                <button onClick={() => setCreateModalOpen(false)} className={ds.btnGhost}><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className={ds.label}>Title</label>
                  <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} className={ds.input} placeholder="Enter title..." />
                </div>

                {activeTab === 'hypotheses' && (
                  <div>
                    <label className={ds.label}>Hypothesis Statement</label>
                    <textarea value={newStatement} onChange={e => setNewStatement(e.target.value)} className={cn(ds.textarea, 'min-h-[80px]')} placeholder="State your hypothesis..." />
                  </div>
                )}

                {activeTab === 'evidence' && (
                  <>
                    <div>
                      <label className={ds.label}>Source</label>
                      <input type="text" value={newSource} onChange={e => setNewSource(e.target.value)} className={ds.input} placeholder="Source of evidence..." />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={ds.label}>Strength</label>
                        <select value={newStrength} onChange={e => setNewStrength(e.target.value as EvidenceData['strength'])} className={ds.select}>
                          {EVIDENCE_STRENGTHS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={ds.label}>Type</label>
                        <select value={newEvidenceType} onChange={e => setNewEvidenceType(e.target.value as EvidenceData['type'])} className={ds.select}>
                          {EVIDENCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === 'experiments' && (
                  <div>
                    <label className={ds.label}>Methodology</label>
                    <textarea value={newMethodology} onChange={e => setNewMethodology(e.target.value)} className={cn(ds.textarea, 'min-h-[80px]')} placeholder="Describe methodology..." />
                  </div>
                )}

                {activeTab === 'bibliography' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={ds.label}>DOI</label>
                        <input type="text" value={newDoi} onChange={e => setNewDoi(e.target.value)} className={ds.input} placeholder="10.xxxx/xxxxx" />
                      </div>
                      <div>
                        <label className={ds.label}>Year</label>
                        <input type="text" value={newYear} onChange={e => setNewYear(e.target.value)} className={ds.input} placeholder="2024" />
                      </div>
                    </div>
                    <div>
                      <label className={ds.label}>Authors</label>
                      <input type="text" value={newAuthors} onChange={e => setNewAuthors(e.target.value)} className={ds.input} placeholder="Last, F. M. & Last, F. M." />
                    </div>
                    <div>
                      <label className={ds.label}>Journal</label>
                      <input type="text" value={newJournal} onChange={e => setNewJournal(e.target.value)} className={ds.input} placeholder="Journal of..." />
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button onClick={() => setCreateModalOpen(false)} className={ds.btnSecondary}>Cancel</button>
                <button onClick={handleCreate} className={ds.btnPrimary}>
                  <Plus className="w-4 h-4" /> Create
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <RealtimeDataPanel data={realtimeInsights} />
      <UniversalActions domain="paper" artifactId={null} compact />

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
            <LensFeaturePanel lensId="paper" />
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Sub-components
// ===========================================================================

// ---- Stat Card ----
function StatCard({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: number; color: string }) {
  return (
    <div className={cn(ds.panel, 'flex items-center gap-3')}>
      <div className={`p-2 rounded-lg bg-${color}/20`}>
        <Icon className={`w-5 h-5 text-${color}`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className={ds.textMuted}>{label}</p>
      </div>
    </div>
  );
}

// ---- Papers Grid ----
function PapersGrid({ items, onEdit, onSelect, onValidate, validationResults, isValidating }: {
  items: LensItem[];
  onEdit: (item: LensItem) => void;
  onSelect: (item: LensItem) => void;
  onValidate: (item: LensItem) => void;
  validationResults: Record<string, { passRate: number; issueCount: number; claimsChecked: number }>;
  isValidating?: boolean;
}) {
  return (
    <div className={ds.grid3}>
      {items.map((item, index) => {
        const d = getData<PaperData>(item);
        const vr = validationResults[item.id];
        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
            className={cn(ds.panelHover, 'space-y-3')}
            onClick={() => onSelect(item)}
          >
            <div className="flex items-start justify-between">
              <FileText className="w-6 h-6 text-neon-purple" />
              <span className={cn(ds.textMuted, 'text-xs')}>{d.wordCount || 0} words</span>
            </div>
            <h3 className="font-semibold text-white line-clamp-2">{item.title}</h3>
            <p className={cn(ds.textMuted, 'line-clamp-3 text-sm')}>
              {d.excerpt || 'No content yet...'}
            </p>
            {vr && (
              <div className={cn('flex items-center gap-2 px-2 py-1 rounded-md text-xs', vr.passRate >= 0.8 ? 'bg-neon-green/10 text-neon-green' : 'bg-red-500/10 text-red-400')}>
                {vr.passRate >= 0.8 ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {Math.round(vr.passRate * 100)}% pass ({vr.claimsChecked} claims)
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {(item.meta?.tags || []).slice(0, 3).map((tag: string) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">{tag}</span>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-lattice-border">
              <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                <Calendar className="w-3 h-3" /> {new Date(item.updatedAt).toLocaleDateString()}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={e => { e.stopPropagation(); onValidate(item); }} disabled={isValidating} className={cn(ds.btnGhost, 'text-xs px-1.5 py-0.5 disabled:opacity-50 disabled:cursor-not-allowed')} title="Validate">
                  <FlaskConical className={`w-3 h-3 text-neon-green ${isValidating ? 'animate-pulse' : ''}`} />
                </button>
                <button onClick={e => { e.stopPropagation(); onEdit(item); }} className={cn(ds.btnGhost, 'text-xs px-1.5 py-0.5')} title="Edit">
                  <Edit3 className="w-3 h-3 text-neon-cyan" />
                </button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ---- Hypotheses List ----
function HypothesesList({ items, onSelect, allEvidence: _allEvidence }: { items: LensItem[]; onSelect: (item: LensItem) => void; allEvidence: LensItem[] }) {
  return (
    <div className="space-y-3">
      {items.map(item => {
        const d = getData<HypothesisData>(item);
        const confidence = d.confidence ?? 50;
        const linkedCount = (d.linkedEvidence || []).length;
        const statusColor = STATUS_COLORS[d.status || 'proposed'] || 'gray-400';
        return (
          <div key={item.id} className={cn(ds.panelHover)} onClick={() => onSelect(item)}>
            <div className="flex items-start gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Lightbulb className={`w-5 h-5 text-${statusColor}`} />
                  <h3 className="font-semibold text-white">{item.title}</h3>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', `bg-${statusColor}/20 text-${statusColor}`)}>
                    {d.status || 'proposed'}
                  </span>
                </div>
                {d.statement && <p className={cn(ds.textMuted, 'text-sm')}>{d.statement}</p>}
                <div className="flex items-center gap-4">
                  <div className="flex-1 max-w-[200px]">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={ds.textMuted}>Confidence</span>
                      <span className="text-white font-medium">{confidence}%</span>
                    </div>
                    <div className="h-2 bg-lattice-surface rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', confidence >= 70 ? 'bg-neon-green' : confidence >= 40 ? 'bg-yellow-400' : 'bg-red-400')}
                        style={{ width: `${confidence}%` }}
                      />
                    </div>
                  </div>
                  <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                    <Link2 className="w-3 h-3" /> {linkedCount} evidence
                  </span>
                  <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                    <Calendar className="w-3 h-3" /> {new Date(item.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="flex items-center">
                {d.status === 'supported' && <TrendingUp className="w-5 h-5 text-neon-green" />}
                {d.status === 'refuted' && <TrendingDown className="w-5 h-5 text-red-400" />}
                {d.status === 'testing' && <RefreshCw className="w-5 h-5 text-neon-cyan" />}
                {d.status === 'proposed' && <Target className="w-5 h-5 text-neon-blue" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Evidence Board ----
function EvidenceBoard({ items, onSelect }: { items: LensItem[]; onSelect: (item: LensItem) => void }) {
  const grouped = useMemo(() => {
    const groups: Record<string, LensItem[]> = { strong: [], moderate: [], weak: [] };
    items.forEach(item => {
      const d = getData<EvidenceData>(item);
      const k = d.strength || 'moderate';
      if (!groups[k]) groups[k] = [];
      groups[k].push(item);
    });
    return groups;
  }, [items]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {EVIDENCE_STRENGTHS.map(strength => {
        const color = STATUS_COLORS[strength || 'moderate'];
        const groupItems = grouped[strength || 'moderate'] || [];
        return (
          <div key={strength} className="space-y-2">
            <div className={cn('flex items-center gap-2 mb-3')}>
              <div className={`w-3 h-3 rounded-full bg-${color}`} />
              <h3 className={cn(ds.heading3, 'text-sm uppercase tracking-wide')}>{strength}</h3>
              <span className={cn(ds.textMuted, 'text-xs')}>({groupItems.length})</span>
            </div>
            {groupItems.map(item => {
              const d = getData<EvidenceData>(item);
              const typeColor = STATUS_COLORS[d.type || 'empirical'];
              return (
                <div key={item.id} className={cn(ds.panelHover, 'space-y-2')} onClick={() => onSelect(item)}>
                  <h4 className="text-sm font-medium text-white">{item.title}</h4>
                  {d.summary && <p className={cn(ds.textMuted, 'text-xs line-clamp-2')}>{d.summary}</p>}
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full capitalize', `bg-${typeColor}/20 text-${typeColor}`)}>
                      {d.type || 'empirical'}
                    </span>
                    {d.source && (
                      <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1 truncate max-w-[120px]')}>
                        <Quote className="w-3 h-3" /> {d.source}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Link2 className="w-3 h-3 text-gray-500" />
                    <span className={cn(ds.textMuted, 'text-xs')}>{(d.linkedHypotheses || []).length} hypotheses</span>
                  </div>
                </div>
              );
            })}
            {groupItems.length === 0 && (
              <div className={cn(ds.panel, 'text-center py-6')}>
                <p className={cn(ds.textMuted, 'text-xs')}>No {strength} evidence</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Experiment Log ----
function ExperimentLog({ items, onSelect }: { items: LensItem[]; onSelect: (item: LensItem) => void }) {
  return (
    <div className="space-y-3">
      {items.map(item => {
        const d = getData<ExperimentData>(item);
        const statusColor = STATUS_COLORS[d.status || 'planned'];
        return (
          <div key={item.id} className={cn(ds.panelHover)} onClick={() => onSelect(item)}>
            <div className="flex items-start gap-4">
              <div className={cn('p-2 rounded-lg', `bg-${statusColor}/20`)}>
                <Beaker className={`w-5 h-5 text-${statusColor}`} />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white">{item.title}</h3>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', `bg-${statusColor}/20 text-${statusColor}`)}>
                    {d.status || 'planned'}
                  </span>
                </div>
                {d.methodology && (
                  <p className={cn(ds.textMuted, 'text-sm line-clamp-2')}>
                    <strong className="text-gray-300">Method:</strong> {d.methodology}
                  </p>
                )}
                {d.results && (
                  <p className={cn(ds.textMuted, 'text-sm line-clamp-2')}>
                    <strong className="text-gray-300">Results:</strong> {d.results}
                  </p>
                )}
                {d.conclusions && (
                  <p className={cn(ds.textMuted, 'text-sm line-clamp-1')}>
                    <strong className="text-gray-300">Conclusion:</strong> {d.conclusions}
                  </p>
                )}
                <div className="flex items-center gap-3 pt-1">
                  {d.linkedHypothesis && (
                    <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                      <Lightbulb className="w-3 h-3" /> Linked hypothesis
                    </span>
                  )}
                  <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                    <Link2 className="w-3 h-3" /> {(d.linkedEvidence || []).length} evidence
                  </span>
                  <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                    <Calendar className="w-3 h-3" /> {new Date(item.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Synthesis Engine ----
function SynthesisEngine({ items, allHypotheses, allEvidence, allExperiments, synthesisResult, onRunSynthesize, isPending }: {
  items: LensItem[];
  allHypotheses: LensItem[];
  allEvidence: LensItem[];
  allExperiments: LensItem[];
  synthesisResult: string | null;
  onRunSynthesize: () => void;
  isPending: boolean;
}) {
  // Cross-reference analysis
  const supportedHypotheses = allHypotheses.filter(h => getData<HypothesisData>(h).status === 'supported');
  const refutedHypotheses = allHypotheses.filter(h => getData<HypothesisData>(h).status === 'refuted');
  const strongEvidence = allEvidence.filter(e => getData<EvidenceData>(e).strength === 'strong');
  const completedExperiments = allExperiments.filter(e => getData<ExperimentData>(e).status === 'completed');

  // Find potential contradictions: hypotheses with conflicting statuses sharing evidence
  const contradictions = useMemo(() => {
    const results: { a: LensItem; b: LensItem; sharedEvidence: string[] }[] = [];
    for (let i = 0; i < allHypotheses.length; i++) {
      for (let j = i + 1; j < allHypotheses.length; j++) {
        const da = getData<HypothesisData>(allHypotheses[i]);
        const db = getData<HypothesisData>(allHypotheses[j]);
        if (da.status && db.status && da.status !== db.status) {
          const shared = (da.linkedEvidence || []).filter(e => (db.linkedEvidence || []).includes(e));
          if (shared.length > 0) {
            results.push({ a: allHypotheses[i], b: allHypotheses[j], sharedEvidence: shared });
          }
        }
      }
    }
    return results;
  }, [allHypotheses]);

  return (
    <div className="space-y-4">
      {/* Cross-reference summary */}
      <div className={ds.grid2}>
        <div className={cn(ds.panel, 'space-y-2')}>
          <h3 className={cn(ds.heading3, 'text-sm flex items-center gap-2')}>
            <BarChart3 className="w-4 h-4 text-neon-cyan" /> Research Summary
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-center p-2 bg-neon-green/10 rounded-lg">
              <p className="text-lg font-bold text-neon-green">{supportedHypotheses.length}</p>
              <p className={cn(ds.textMuted, 'text-xs')}>Supported</p>
            </div>
            <div className="text-center p-2 bg-red-500/10 rounded-lg">
              <p className="text-lg font-bold text-red-400">{refutedHypotheses.length}</p>
              <p className={cn(ds.textMuted, 'text-xs')}>Refuted</p>
            </div>
            <div className="text-center p-2 bg-neon-blue/10 rounded-lg">
              <p className="text-lg font-bold text-neon-blue">{strongEvidence.length}</p>
              <p className={cn(ds.textMuted, 'text-xs')}>Strong Evidence</p>
            </div>
            <div className="text-center p-2 bg-neon-cyan/10 rounded-lg">
              <p className="text-lg font-bold text-neon-cyan">{completedExperiments.length}</p>
              <p className={cn(ds.textMuted, 'text-xs')}>Completed Exp.</p>
            </div>
          </div>
        </div>

        <div className={cn(ds.panel, 'space-y-2')}>
          <h3 className={cn(ds.heading3, 'text-sm flex items-center gap-2')}>
            <AlertCircle className="w-4 h-4 text-yellow-400" /> Contradictions Detected
          </h3>
          {contradictions.length === 0 ? (
            <p className={cn(ds.textMuted, 'text-sm')}>No contradictions found among current hypotheses.</p>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {contradictions.map((c, idx) => (
                <div key={idx} className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm">
                  <p className="text-yellow-400 font-medium">
                    &quot;{c.a.title}&quot; vs &quot;{c.b.title}&quot;
                  </p>
                  <p className={ds.textMuted}>{c.sharedEvidence.length} shared evidence item(s)</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Generate Synthesis */}
      <div className={cn(ds.panel, 'space-y-3')}>
        <div className="flex items-center justify-between">
          <h3 className={cn(ds.heading3, 'text-sm flex items-center gap-2')}>
            <Brain className="w-4 h-4 text-neon-purple" /> AI Synthesis
          </h3>
          <button onClick={onRunSynthesize} className={cn(ds.btnPrimary, ds.btnSmall)} disabled={isPending || items.length === 0}>
            {isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate Synthesis
          </button>
        </div>
        {synthesisResult ? (
          <div className="p-3 bg-lattice-elevated rounded-lg">
            <pre className={cn(ds.textMono, 'whitespace-pre-wrap text-gray-300')}>{synthesisResult}</pre>
          </div>
        ) : (
          <p className={ds.textMuted}>Select a paper and click &quot;Generate Synthesis&quot; to cross-reference all findings.</p>
        )}
      </div>
    </div>
  );
}

// ---- Bibliography Manager ----
function BibliographyManager({ items, onSelect, citationStyle, onStyleChange }: {
  items: LensItem[];
  onSelect: (item: LensItem) => void;
  citationStyle: CitationData['style'];
  onStyleChange: (s: CitationData['style']) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className={ds.label}>Citation Style:</label>
        {CITATION_STYLES.map(s => (
          <button
            key={s}
            onClick={() => onStyleChange(s)}
            className={cn(
              'text-xs px-3 py-1 rounded-full font-medium uppercase transition-colors',
              citationStyle === s
                ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                : 'bg-lattice-surface text-gray-400 hover:text-white border border-lattice-border'
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {items.map(item => {
          const d = getData<CitationData>(item);
          const formatted = formatCitation({ ...d, title: item.title }, citationStyle);
          return (
            <div key={item.id} className={cn(ds.panelHover, 'space-y-2')} onClick={() => onSelect(item)}>
              <div className="flex items-start gap-3">
                <Library className="w-5 h-5 text-neon-purple mt-0.5" />
                <div className="flex-1 space-y-1">
                  <h4 className="text-sm font-medium text-white">{item.title}</h4>
                  <p className={cn(ds.textMuted, 'text-xs italic')}>{formatted}</p>
                  <div className="flex items-center gap-3">
                    {d.doi && (
                      <span className={cn(ds.textMono, 'text-xs text-neon-blue')}>DOI: {d.doi}</span>
                    )}
                    {d.year && (
                      <span className={cn(ds.textMuted, 'text-xs')}>{d.year}</span>
                    )}
                    {d.citedByCount !== undefined && d.citedByCount > 0 && (
                      <span className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                        <Quote className="w-3 h-3" /> {d.citedByCount} citations
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(formatted);
                  }}
                  className={cn(ds.btnGhost, 'text-xs px-1.5 py-0.5')}
                  title="Copy citation"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// Detail Field Components
// ===========================================================================

function PaperDetailFields({ item }: { item: LensItem }) {
  const d = getData<PaperData>(item);
  return (
    <>
      <div>
        <span className={ds.label}>Word Count</span>
        <p className={ds.textMono}>{d.wordCount || 0}</p>
      </div>
      {d.doi && (
        <div>
          <span className={ds.label}>DOI</span>
          <p className={cn(ds.textMono, 'text-neon-blue')}>{d.doi}</p>
        </div>
      )}
      {d.sections && d.sections.length > 0 && (
        <div>
          <span className={ds.label}>Sections</span>
          <ul className="space-y-1 mt-1">
            {d.sections.map((s, i) => (
              <li key={i} className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
                <ChevronRight className="w-3 h-3" /> {s.heading} {s.body ? `(${s.body.split(/\s+/).length} words)` : '(empty)'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function HypothesisDetailFields({ item, allEvidence }: { item: LensItem; allEvidence: LensItem[] }) {
  const d = getData<HypothesisData>(item);
  const confidence = d.confidence ?? 50;
  const statusColor = STATUS_COLORS[d.status || 'proposed'];
  return (
    <>
      <div>
        <span className={ds.label}>Status</span>
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', `bg-${statusColor}/20 text-${statusColor}`)}>
          {d.status || 'proposed'}
        </span>
      </div>
      {d.statement && (
        <div>
          <span className={ds.label}>Statement</span>
          <p className="text-sm text-gray-300">{d.statement}</p>
        </div>
      )}
      <div>
        <span className={ds.label}>Confidence</span>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-3 bg-lattice-surface rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', confidence >= 70 ? 'bg-neon-green' : confidence >= 40 ? 'bg-yellow-400' : 'bg-red-400')}
              style={{ width: `${confidence}%` }}
            />
          </div>
          <span className="text-sm font-bold text-white">{confidence}%</span>
        </div>
      </div>
      {d.rationale && (
        <div>
          <span className={ds.label}>Rationale</span>
          <p className="text-sm text-gray-300">{d.rationale}</p>
        </div>
      )}
      <div>
        <span className={ds.label}>Linked Evidence ({(d.linkedEvidence || []).length})</span>
        <div className="space-y-1 mt-1">
          {(d.linkedEvidence || []).map(eid => {
            const ev = allEvidence.find(e => e.id === eid);
            return (
              <div key={eid} className="text-xs text-gray-400 flex items-center gap-1">
                <Link2 className="w-3 h-3" /> {ev ? ev.title : eid}
              </div>
            );
          })}
          {(d.linkedEvidence || []).length === 0 && <p className={cn(ds.textMuted, 'text-xs')}>No linked evidence</p>}
        </div>
      </div>
    </>
  );
}

function EvidenceDetailFields({ item }: { item: LensItem }) {
  const d = getData<EvidenceData>(item);
  const strengthColor = STATUS_COLORS[d.strength || 'moderate'];
  const typeColor = STATUS_COLORS[d.type || 'empirical'];
  return (
    <>
      <div className="flex items-center gap-2">
        <div>
          <span className={ds.label}>Strength</span>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', `bg-${strengthColor}/20 text-${strengthColor}`)}>
            {d.strength || 'moderate'}
          </span>
        </div>
        <div>
          <span className={ds.label}>Type</span>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', `bg-${typeColor}/20 text-${typeColor}`)}>
            {d.type || 'empirical'}
          </span>
        </div>
      </div>
      {d.source && (
        <div>
          <span className={ds.label}>Source</span>
          <p className="text-sm text-gray-300">{d.source}</p>
        </div>
      )}
      {d.summary && (
        <div>
          <span className={ds.label}>Summary</span>
          <p className="text-sm text-gray-300">{d.summary}</p>
        </div>
      )}
      <div>
        <span className={ds.label}>Linked Hypotheses ({(d.linkedHypotheses || []).length})</span>
        {(d.linkedHypotheses || []).length === 0 && <p className={cn(ds.textMuted, 'text-xs')}>No linked hypotheses</p>}
      </div>
    </>
  );
}

function ExperimentDetailFields({ item }: { item: LensItem }) {
  const d = getData<ExperimentData>(item);
  const statusColor = STATUS_COLORS[d.status || 'planned'];
  return (
    <>
      <div>
        <span className={ds.label}>Status</span>
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize', `bg-${statusColor}/20 text-${statusColor}`)}>
          {d.status || 'planned'}
        </span>
      </div>
      {d.methodology && (
        <div>
          <span className={ds.label}>Methodology</span>
          <p className="text-sm text-gray-300">{d.methodology}</p>
        </div>
      )}
      {d.results && (
        <div>
          <span className={ds.label}>Results</span>
          <p className="text-sm text-gray-300">{d.results}</p>
        </div>
      )}
      {d.conclusions && (
        <div>
          <span className={ds.label}>Conclusions</span>
          <p className="text-sm text-gray-300">{d.conclusions}</p>
        </div>
      )}
      <div className="flex items-center gap-4">
        {d.startDate && (
          <div>
            <span className={ds.label}>Start</span>
            <p className={cn(ds.textMuted, 'text-xs')}>{d.startDate}</p>
          </div>
        )}
        {d.endDate && (
          <div>
            <span className={ds.label}>End</span>
            <p className={cn(ds.textMuted, 'text-xs')}>{d.endDate}</p>
          </div>
        )}
      </div>
      {d.linkedHypothesis && (
        <div>
          <span className={ds.label}>Linked Hypothesis</span>
          <p className={cn(ds.textMuted, 'text-xs flex items-center gap-1')}>
            <Lightbulb className="w-3 h-3" /> {d.linkedHypothesis}
          </p>
        </div>
      )}
    </>
  );
}

function CitationDetailFields({ item, citationStyle }: { item: LensItem; citationStyle: CitationData['style'] }) {
  const d = getData<CitationData>(item);
  const formatted = formatCitation({ ...d, title: item.title }, citationStyle);
  return (
    <>
      <div data-lens-theme="paper">
        <span className={ds.label}>Formatted Citation ({citationStyle?.toUpperCase()})</span>
        <p className="text-sm text-gray-300 italic mt-1">{formatted}</p>
      </div>
      {d.authors && (
        <div>
          <span className={ds.label}>Authors</span>
          <p className="text-sm text-gray-300">{d.authors}</p>
        </div>
      )}
      {d.year && (
        <div>
          <span className={ds.label}>Year</span>
          <p className={ds.textMono}>{d.year}</p>
        </div>
      )}
      {d.journal && (
        <div>
          <span className={ds.label}>Journal</span>
          <p className="text-sm text-gray-300">{d.journal}</p>
        </div>
      )}
      {d.doi && (
        <div>
          <span className={ds.label}>DOI</span>
          <p className={cn(ds.textMono, 'text-neon-blue')}>{d.doi}</p>
        </div>
      )}
      {d.volume && (
        <div>
          <span className={ds.label}>Volume</span>
          <p className={ds.textMono}>{d.volume}</p>
        </div>
      )}
      {d.pages && (
        <div>
          <span className={ds.label}>Pages</span>
          <p className={ds.textMono}>{d.pages}</p>
        </div>
      )}
      {d.url && (
        <div>
          <span className={ds.label}>URL</span>
          <p className={cn(ds.textMono, 'text-neon-blue text-xs break-all')}>{d.url}</p>
        </div>
      )}
      {d.citedByCount !== undefined && (
        <div>
          <span className={ds.label}>Cited By</span>
          <p className={ds.textMono}>{d.citedByCount}</p>
        </div>
      )}
    </>
  );
}

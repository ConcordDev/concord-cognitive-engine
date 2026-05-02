'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Search,
  Plus,
  Play,
  Square,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  BookOpen,
  Microscope,
  Brain,
  Beaker,
  Lightbulb,
  FileText,
  Link2,
  Tag,
  ArrowRight,
  RefreshCw,
  Eye,
  XCircle,
  Layers,
  Zap,
  Globe,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type JobStatus = 'queued' | 'running' | 'synthesizing' | 'complete' | 'failed';

type ResearchStep =
  | 'survey'
  | 'gap_analysis'
  | 'ingest'
  | 'reasoning'
  | 'hypotheses'
  | 'synthesis'
  | 'complete';

interface ResearchJob {
  id: string;
  topic: string;
  status: JobStatus;
  depth?: 'shallow' | 'standard' | 'deep';
  priority?: number;
  domains?: string[];
  currentStep?: ResearchStep;
  steps?: Record<ResearchStep, { status: string; startedAt?: string; completedAt?: string }>;
  progress?: number;
  createdAt?: string;
  completedAt?: string;
  error?: string;
  urls?: string[];
  synthesis?: string;
  hypotheses?: string[];
  gaps?: string[];
}

interface JobResults {
  id: string;
  topic: string;
  synthesis?: string;
  hypotheses?: Array<{ statement: string; confidence?: number }>;
  sources?: Array<{ url: string; title?: string; relevance?: number }>;
  gaps?: string[];
  reasoning?: string[];
  dtusCreated?: number;
  duration?: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const RESEARCH_STEPS: ResearchStep[] = [
  'survey',
  'gap_analysis',
  'ingest',
  'reasoning',
  'hypotheses',
  'synthesis',
  'complete',
];

const STEP_LABELS: Record<ResearchStep, string> = {
  survey: 'Survey',
  gap_analysis: 'Gap Analysis',
  ingest: 'Ingest',
  reasoning: 'Reasoning',
  hypotheses: 'Hypotheses',
  synthesis: 'Synthesis',
  complete: 'Complete',
};

const STEP_ICONS: Record<ResearchStep, React.ReactNode> = {
  survey: <Globe className="w-3.5 h-3.5" />,
  gap_analysis: <Search className="w-3.5 h-3.5" />,
  ingest: <Layers className="w-3.5 h-3.5" />,
  reasoning: <Brain className="w-3.5 h-3.5" />,
  hypotheses: <Lightbulb className="w-3.5 h-3.5" />,
  synthesis: <Beaker className="w-3.5 h-3.5" />,
  complete: <CheckCircle2 className="w-3.5 h-3.5" />,
};

const STATUS_COLORS: Record<JobStatus, { bg: string; text: string; dot: string }> = {
  queued: { bg: 'bg-gray-500/20', text: 'text-gray-400', dot: 'bg-gray-400' },
  running: { bg: 'bg-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' },
  synthesizing: { bg: 'bg-purple-500/20', text: 'text-purple-400', dot: 'bg-purple-400' },
  complete: { bg: 'bg-green-500/20', text: 'text-green-400', dot: 'bg-green-400' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400', dot: 'bg-red-400' },
};

const DEPTH_OPTIONS = [
  { value: 'shallow', label: 'Shallow', description: 'Quick survey, minimal depth' },
  { value: 'standard', label: 'Standard', description: 'Balanced breadth and depth' },
  { value: 'deep', label: 'Deep', description: 'Comprehensive multi-pass research' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function decree<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  return api.post('/api/run', body).then((r) => r.data);
}

function getStepIndex(step?: ResearchStep): number {
  if (!step) return -1;
  return RESEARCH_STEPS.indexOf(step);
}

function computeProgress(job: ResearchJob): number {
  if (job.progress != null) return job.progress;
  if (job.status === 'complete') return 100;
  if (job.status === 'failed') return 0;
  if (job.status === 'queued') return 0;
  const idx = getStepIndex(job.currentStep);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / RESEARCH_STEPS.length) * 100);
}

function formatDuration(ms?: number): string {
  if (!ms) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remaining}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTime(iso?: string): string {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: JobStatus }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.queued;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium',
        colors.bg,
        colors.text
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          colors.dot,
          status === 'running' && 'animate-pulse'
        )}
      />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ProgressSteps({ job }: { job: ResearchJob }) {
  const currentIdx = getStepIndex(job.currentStep);
  const isComplete = job.status === 'complete';
  const isFailed = job.status === 'failed';

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-lattice-elevated rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isFailed
                ? 'bg-red-500'
                : isComplete
                  ? 'bg-green-500'
                  : job.status === 'synthesizing'
                    ? 'bg-purple-500'
                    : 'bg-blue-500'
            )}
            style={{ width: `${computeProgress(job)}%` }}
          />
        </div>
        <span className="text-xs font-mono text-gray-400 w-10 text-right">
          {computeProgress(job)}%
        </span>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-1">
        {RESEARCH_STEPS.map((step, idx) => {
          const stepData = job.steps?.[step];
          const isDone =
            stepData?.status === 'complete' ||
            stepData?.completedAt ||
            isComplete ||
            idx < currentIdx;
          const isCurrent = idx === currentIdx && !isComplete && !isFailed;
          const isPending = !isDone && !isCurrent;

          return (
            <div key={step} className="flex items-center flex-1 min-w-0">
              <div
                className={cn(
                  'flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 transition-colors',
                  isDone && 'bg-green-500/20 text-green-400',
                  isCurrent && 'bg-blue-500/20 text-blue-400 ring-2 ring-blue-500/40',
                  isPending && 'bg-lattice-elevated text-gray-600',
                  isFailed && isCurrent && 'bg-red-500/20 text-red-400 ring-2 ring-red-500/40'
                )}
                title={STEP_LABELS[step]}
              >
                {STEP_ICONS[step]}
              </div>
              {idx < RESEARCH_STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-px mx-1',
                    isDone ? 'bg-green-500/40' : 'bg-lattice-border'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step label */}
      {job.currentStep && !isComplete && (
        <p className="text-xs text-gray-400">
          {isFailed ? (
            <span className="text-red-400">Failed at: {STEP_LABELS[job.currentStep]}</span>
          ) : (
            <>
              Currently: <span className="text-white">{STEP_LABELS[job.currentStep]}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function JobCard({
  job,
  isSelected,
  onClick,
  onCancel,
}: {
  job: ResearchJob;
  isSelected: boolean;
  onClick: () => void;
  onCancel: (id: string) => void;
}) {
  const isActive = job.status === 'running' || job.status === 'synthesizing';

  return (
    <div
      onClick={onClick}
      className={cn(
        ds.panel,
        'cursor-pointer transition-all',
        isSelected ? 'border-neon-cyan/60 ring-1 ring-neon-cyan/20' : 'hover:border-neon-cyan/30'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{job.topic}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={job.status} />
            {job.depth && (
              <span className={cn(ds.badge('gray-400'), 'text-[10px]')}>{job.depth}</span>
            )}
            {job.priority != null && job.priority > 0 && (
              <span className={cn(ds.badge('yellow-400'), 'text-[10px]')}>P{job.priority}</span>
            )}
          </div>
        </div>
        {isActive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel(job.id);
            }}
            className={cn(ds.btnGhost, 'p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10')}
            title="Cancel job"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isActive && <ProgressSteps job={job} />}

      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTime(job.createdAt)}
        </span>
        {job.domains && job.domains.length > 0 && (
          <span className="flex items-center gap-1 truncate">
            <Tag className="w-3 h-3" />
            {job.domains.slice(0, 2).join(', ')}
            {job.domains.length > 2 && ` +${job.domains.length - 2}`}
          </span>
        )}
        {job.urls && job.urls.length > 0 && (
          <span className="flex items-center gap-1">
            <Link2 className="w-3 h-3" />
            {job.urls.length} URLs
          </span>
        )}
      </div>
    </div>
  );
}

function NewJobForm({
  onSubmit,
  onSubmitDeep,
  isPending,
}: {
  onSubmit: (data: { topic: string; depth: string; domains: string[] }) => void;
  onSubmitDeep: (topic: string) => void;
  isPending: boolean;
}) {
  const [topic, setTopic] = useState('');
  const [depth, setDepth] = useState('standard');
  const [domainInput, setDomainInput] = useState('');
  const [domains, setDomains] = useState<string[]>([]);

  const addDomain = useCallback(() => {
    const trimmed = domainInput.trim().toLowerCase();
    if (trimmed && !domains.includes(trimmed)) {
      setDomains((prev) => [...prev, trimmed]);
      setDomainInput('');
    }
  }, [domainInput, domains]);

  const removeDomain = (d: string) => {
    setDomains((prev) => prev.filter((x) => x !== d));
  };

  const handleSubmit = (deep: boolean) => {
    if (!topic.trim()) return;
    if (deep) {
      onSubmitDeep(topic.trim());
    } else {
      onSubmit({ topic: topic.trim(), depth, domains });
    }
    setTopic('');
    setDomains([]);
    setDomainInput('');
  };

  return (
    <div className={cn(ds.panel, 'space-y-4')}>
      <h2 className={cn(ds.heading3, 'flex items-center gap-2')}>
        <Plus className="w-4 h-4 text-neon-blue" />
        Launch Research Job
      </h2>

      {/* Topic */}
      <div>
        <label className={ds.label}>Research Topic</label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What do you want to research? Be specific..."
          rows={3}
          className={ds.textarea}
        />
      </div>

      {/* Depth */}
      <div>
        <label className={ds.label}>Research Depth</label>
        <select value={depth} onChange={(e) => setDepth(e.target.value)} className={ds.select}>
          {DEPTH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} -- {opt.description}
            </option>
          ))}
        </select>
      </div>

      {/* Domain tags */}
      <div>
        <label className={ds.label}>Domain Tags</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDomain();
              }
            }}
            placeholder="Add domain (press Enter)..."
            className={cn(ds.input, 'flex-1')}
          />
          <button
            type="button"
            onClick={addDomain}
            disabled={!domainInput.trim()}
            className={ds.btnSecondary}
          >
            <Tag className="w-4 h-4" />
          </button>
        </div>
        {domains.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {domains.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20"
              >
                {d}
                <button onClick={() => removeDomain(d)} className="hover:text-white">
                  <XCircle className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex gap-2">
        <button
          onClick={() => handleSubmit(false)}
          disabled={!topic.trim() || isPending}
          className={cn(ds.btnPrimary, 'flex-1')}
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isPending ? 'Submitting...' : 'Launch Research'}
        </button>
        <button
          onClick={() => handleSubmit(true)}
          disabled={!topic.trim() || isPending}
          className={cn(ds.btnSecondary, 'flex-shrink-0')}
          title="Deep research -- comprehensive multi-pass analysis"
        >
          <Microscope className="w-4 h-4" />
          Deep
        </button>
      </div>
    </div>
  );
}

function JobResultsView({
  results,
  onClose,
}: {
  results: JobResults | null;
  isLoading: boolean;
  onClose: () => void;
}) {
  if (!results) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={ds.heading2}>{results.topic}</h2>
          <div className="flex items-center gap-3 mt-1">
            {results.duration != null && (
              <span className={ds.textMuted}>Completed in {formatDuration(results.duration)}</span>
            )}
            {results.dtusCreated != null && (
              <span className={cn(ds.badge('neon-cyan'))}>{results.dtusCreated} DTUs created</span>
            )}
          </div>
        </div>
        <button onClick={onClose} className={ds.btnGhost}>
          <XCircle className="w-4 h-4" />
        </button>
      </div>

      {/* Synthesis */}
      {results.synthesis && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <BookOpen className="w-4 h-4 text-neon-purple" />
            Synthesis Report
          </h3>
          <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
            {results.synthesis}
          </div>
        </div>
      )}

      {/* Hypotheses */}
      {results.hypotheses && results.hypotheses.length > 0 && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <Lightbulb className="w-4 h-4 text-yellow-400" />
            Hypotheses ({results.hypotheses.length})
          </h3>
          <div className="space-y-2">
            {results.hypotheses.map((h, i) => (
              <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-lattice-elevated">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-yellow-400/20 text-yellow-400 text-xs flex items-center justify-center font-mono">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200">{h.statement}</p>
                  {h.confidence != null && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 bg-lattice-surface rounded-full overflow-hidden max-w-[120px]">
                        <div
                          className="h-full bg-yellow-400/60 rounded-full"
                          style={{ width: `${Math.round(h.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 font-mono">
                        {Math.round(h.confidence * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {results.reasoning && results.reasoning.length > 0 && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <Brain className="w-4 h-4 text-blue-400" />
            Reasoning Chain
          </h3>
          <div className="space-y-1.5">
            {results.reasoning.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <ArrowRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-400/60" />
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge Gaps */}
      {results.gaps && results.gaps.length > 0 && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            Knowledge Gaps ({results.gaps.length})
          </h3>
          <ul className="space-y-1">
            {results.gaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400/60 mt-1.5 flex-shrink-0" />
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sources / Fetched URLs */}
      {results.sources && results.sources.length > 0 && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <Link2 className="w-4 h-4 text-neon-cyan" />
            Ingested Sources ({results.sources.length})
          </h3>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {results.sources.map((src, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-1.5 rounded bg-lattice-elevated text-xs group"
              >
                <Globe className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-300 truncate">{src.title || src.url}</p>
                  {src.title && <p className="text-gray-500 truncate">{src.url}</p>}
                </div>
                {src.relevance != null && (
                  <span className="text-[10px] font-mono text-gray-500 flex-shrink-0">
                    {Math.round(src.relevance * 100)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

type ViewTab = 'active' | 'queue' | 'completed';

export default function ResearchDashboardPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ViewTab>('active');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');

  /* ---- Queries ---- */

  const {
    data: jobsData,
    isLoading: jobsLoading,
    isError: jobsError,
    error: jobsErrorObj,
    refetch: refetchJobs,
  } = useQuery({
    queryKey: ['research-jobs'],
    queryFn: () =>
      decree<{ ok: boolean; jobs?: ResearchJob[]; queue?: ResearchJob[] }>({
        action: 'research-queue',
      }),
    refetchInterval: 4000,
  });

  const selectedJob = (() => {
    if (!selectedJobId) return null;
    const allJobs = [...(jobsData?.jobs || []), ...(jobsData?.queue || [])];
    return allJobs.find((j) => j.id === selectedJobId) || null;
  })();

  const { data: statusData } = useQuery({
    queryKey: ['research-status', selectedJobId],
    queryFn: () =>
      decree<{ ok: boolean; job?: ResearchJob }>({
        action: 'research-status',
        target: selectedJobId!,
      }),
    enabled:
      !!selectedJobId &&
      (selectedJob?.status === 'running' || selectedJob?.status === 'synthesizing'),
    refetchInterval: 2000,
  });

  const detailedJob = statusData?.job || selectedJob;

  const { data: resultsData, isLoading: resultsLoading } = useQuery({
    queryKey: ['research-results', selectedJobId],
    queryFn: () =>
      decree<{ ok: boolean; results?: JobResults }>({
        action: 'research-results',
        target: selectedJobId!,
      }),
    enabled: !!selectedJobId && showResults,
  });

  /* ---- Mutations ---- */

  const submitJob = useMutation({
    mutationFn: (data: { topic: string; depth: string; domains: string[] }) =>
      decree({
        action: 'research',
        data: {
          topic: data.topic,
          config: { depth: data.depth, domains: data.domains },
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-jobs'] });
    },
  });

  const submitDeepJob = useMutation({
    mutationFn: (topic: string) =>
      decree({
        action: 'research-deep',
        data: { topic },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-jobs'] });
    },
  });

  const cancelJob = useMutation({
    mutationFn: (id: string) => decree({ action: 'research-cancel', target: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-jobs'] });
    },
  });

  /* ---- Derived data ---- */

  const allJobs: ResearchJob[] = [...(jobsData?.jobs || []), ...(jobsData?.queue || [])];

  const activeJobs = allJobs.filter((j) => j.status === 'running' || j.status === 'synthesizing');
  const queuedJobs = allJobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const completedJobs = allJobs.filter((j) => j.status === 'complete' || j.status === 'failed');

  const filteredJobs = (() => {
    switch (activeTab) {
      case 'active':
        return activeJobs;
      case 'queue':
        return queuedJobs;
      case 'completed':
        return completedJobs;
    }
  })();

  const displayJobs =
    statusFilter === 'all' ? filteredJobs : filteredJobs.filter((j) => j.status === statusFilter);

  /* ---- Auto-select first active job ---- */

  useEffect(() => {
    if (!selectedJobId && activeJobs.length > 0) {
      setSelectedJobId(activeJobs[0].id);
    }
  }, [activeJobs, selectedJobId]);

  /* ---- Render ---- */

  const tabs: { key: ViewTab; label: string; count: number; icon: React.ReactNode }[] = [
    {
      key: 'active',
      label: 'Active',
      count: activeJobs.length,
      icon: <Play className="w-3.5 h-3.5" />,
    },
    {
      key: 'queue',
      label: 'Queue',
      count: queuedJobs.length,
      icon: <Clock className="w-3.5 h-3.5" />,
    },
    {
      key: 'completed',
      label: 'Completed',
      count: completedJobs.length,
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div className={ds.pageContainer}>
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-neon-purple/20 flex items-center justify-center">
            <Microscope className="w-5 h-5 text-neon-purple" />
          </div>
          <div>
            <h1 className={ds.heading1}>Research Jobs</h1>
            <p className={ds.textMuted}>
              Autonomous research pipeline -- survey, analyze, ingest, synthesize
            </p>
          </div>
        </div>
        <button onClick={() => refetchJobs()} className={ds.btnGhost} title="Refresh">
          <RefreshCw className={cn('w-4 h-4', jobsLoading && 'animate-spin')} />
        </button>
      </header>

      {/* Stats row */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center justify-between">
            <Zap className="w-5 h-5 text-blue-400" />
            <span className="text-2xl font-bold text-white">{activeJobs.length}</span>
          </div>
          <p className={cn(ds.textMuted, 'mt-1')}>Running</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center justify-between">
            <Clock className="w-5 h-5 text-gray-400" />
            <span className="text-2xl font-bold text-white">{queuedJobs.length}</span>
          </div>
          <p className={cn(ds.textMuted, 'mt-1')}>Queued</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center justify-between">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <span className="text-2xl font-bold text-white">
              {completedJobs.filter((j) => j.status === 'complete').length}
            </span>
          </div>
          <p className={cn(ds.textMuted, 'mt-1')}>Complete</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center justify-between">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-2xl font-bold text-white">
              {completedJobs.filter((j) => j.status === 'failed').length}
            </span>
          </div>
          <p className={cn(ds.textMuted, 'mt-1')}>Failed</p>
        </div>
      </div>

      {/* Error state */}
      {jobsError && (
        <div className={cn(ds.panel, 'border-red-500/30 bg-red-500/5')}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-400 font-medium">Failed to load research jobs</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {(jobsErrorObj as Error)?.message || 'Unknown error'}
              </p>
            </div>
            <button onClick={() => refetchJobs()} className={ds.btnSecondary}>
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Job list */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tabs */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setStatusFilter('all');
                  }}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors',
                    activeTab === tab.key
                      ? 'bg-neon-blue/15 text-neon-blue'
                      : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-lattice-elevated font-mono">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Filter for completed tab */}
            {activeTab === 'completed' && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as JobStatus | 'all')}
                className={cn(ds.select, 'w-auto text-xs py-1.5')}
              >
                <option value="all">All</option>
                <option value="complete">Complete</option>
                <option value="failed">Failed</option>
              </select>
            )}
          </div>

          {/* Loading */}
          {jobsLoading && allJobs.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
              <span className="ml-2 text-sm text-gray-500">Loading research jobs...</span>
            </div>
          )}

          {/* Empty state */}
          {!jobsLoading && displayJobs.length === 0 && (
            <div className={cn(ds.panel, 'text-center py-12')}>
              <Microscope className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400 font-medium">
                {activeTab === 'active' && 'No active research jobs'}
                {activeTab === 'queue' && 'Research queue is empty'}
                {activeTab === 'completed' && 'No completed research jobs yet'}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Launch a new research job from the panel on the right.
              </p>
            </div>
          )}

          {/* Job cards */}
          <div className="space-y-3">
            {displayJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                isSelected={selectedJobId === job.id}
                onClick={() => {
                  setSelectedJobId(job.id);
                  setShowResults(false);
                }}
                onCancel={(id) => cancelJob.mutate(id)}
              />
            ))}
          </div>
        </div>

        {/* Right column: New job form + detail */}
        <div className="space-y-4">
          <NewJobForm
            onSubmit={(data) => submitJob.mutate(data)}
            onSubmitDeep={(topic) => submitDeepJob.mutate(topic)}
            isPending={submitJob.isPending || submitDeepJob.isPending}
          />

          {/* Selected job detail */}
          {detailedJob && !showResults && (
            <div className={cn(ds.panel, 'space-y-3')}>
              <div className="flex items-start justify-between gap-2">
                <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
                  <Eye className="w-4 h-4 text-neon-cyan" />
                  Job Detail
                </h3>
                <button onClick={() => setSelectedJobId(null)} className={cn(ds.btnGhost, 'p-1')}>
                  <XCircle className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Topic</span>
                  <span className="text-white text-right max-w-[200px] truncate">
                    {detailedJob.topic}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Status</span>
                  <StatusBadge status={detailedJob.status} />
                </div>
                {detailedJob.depth && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Depth</span>
                    <span className="text-white capitalize">{detailedJob.depth}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Created</span>
                  <span className="text-white">{formatTime(detailedJob.createdAt)}</span>
                </div>
                {detailedJob.completedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Completed</span>
                    <span className="text-white">{formatTime(detailedJob.completedAt)}</span>
                  </div>
                )}
              </div>

              {/* Progress for active */}
              {(detailedJob.status === 'running' || detailedJob.status === 'synthesizing') && (
                <ProgressSteps job={detailedJob} />
              )}

              {/* Error message */}
              {detailedJob.error && (
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-400">{detailedJob.error}</p>
                </div>
              )}

              {/* Ingest URLs */}
              {detailedJob.urls && detailedJob.urls.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    Fetched URLs ({detailedJob.urls.length})
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {detailedJob.urls.map((url, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-lattice-elevated text-[11px] text-gray-400 truncate"
                      >
                        <Globe className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{url}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Domain tags */}
              {detailedJob.domains && detailedJob.domains.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detailedJob.domains.map((d) => (
                    <span
                      key={d}
                      className="px-2 py-0.5 rounded-full text-[10px] bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                {detailedJob.status === 'complete' && (
                  <button
                    onClick={() => setShowResults(true)}
                    className={cn(ds.btnPrimary, 'flex-1 text-sm')}
                  >
                    <FileText className="w-4 h-4" />
                    View Results
                  </button>
                )}
                {(detailedJob.status === 'running' || detailedJob.status === 'synthesizing') && (
                  <button
                    onClick={() => cancelJob.mutate(detailedJob.id)}
                    disabled={cancelJob.isPending}
                    className={cn(ds.btnDanger, 'flex-1 text-sm')}
                  >
                    <Square className="w-4 h-4" />
                    {cancelJob.isPending ? 'Cancelling...' : 'Cancel Job'}
                  </button>
                )}
                {detailedJob.status === 'failed' && (
                  <button
                    onClick={() => {
                      submitJob.mutate({
                        topic: detailedJob.topic,
                        depth: detailedJob.depth || 'standard',
                        domains: detailedJob.domains || [],
                      });
                    }}
                    disabled={submitJob.isPending}
                    className={cn(ds.btnSecondary, 'flex-1 text-sm')}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Results view */}
          {showResults && selectedJobId && (
            <div className={cn(ds.panel)}>
              <JobResultsView
                results={resultsData?.results || null}
                isLoading={resultsLoading}
                onClose={() => setShowResults(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

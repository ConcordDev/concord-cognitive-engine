'use client';

import { useState, useCallback, useRef } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { IngestionRepos } from '@/components/ingest/IngestionRepos';
import { PipelinePanel } from '@/components/ingest/PipelinePanel';
import { LatticeSeedPanel } from '@/components/ingest/LatticeSeedPanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { motion } from 'framer-motion';
import { Upload, Settings2, CheckCircle2, AlertTriangle, Loader2, Clock, Database, FileUp, FileJson, FileText, Image as ImageIcon, Gauge, ArrowDownToLine, Activity, BarChart3, Search, List, Table2, KeyRound, ChevronDown, ChevronRight } from 'lucide-react';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import { showToast } from '@/components/common/Toasts';

interface ParseDocumentResult {
  format: string;
  lineCount: number;
  paragraphCount: number;
  sentenceCount: number;
  wordCount: number;
  sectionCount: number;
  sections: string[];
  avgWordsPerSentence: number;
  avgWordsPerParagraph: number;
}

interface ExtractEntitiesResult {
  emails: string[];
  urls: string[];
  dates: string[];
  phones: string[];
  numbers: string[];
  summary: { emailCount: number; urlCount: number; dateCount: number; phoneCount: number; numberCount: number };
}

interface ValidateSchemaResult {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  validationRate: number;
  issues: { row: number; valid: boolean; missingFields: string[]; extraFields: string[]; nullFields: string[]; field?: string; message?: string; count?: number }[];
}

interface DetectedField {
  field: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'null' | 'mixed' | 'object' | string;
  typeBreakdown: Record<string, number>;
  nullCount: number;
  nullablePct: number;
  nonNullCount: number;
  uniqueCount: number;
  uniquePct: number;
  likelyPrimaryKey: boolean;
  sampleValues: unknown[];
}

interface DetectSchemaResult {
  recordCount: number;
  fieldCount: number;
  fields: DetectedField[];
  primaryKeyCandidates: string[];
}

interface BatchStatusResult {
  totalItems: number;
  completed: number;
  pending: number;
  inProgress: number;
  failed: number;
  completionRate: number;
  statusBreakdown: Record<string, number>;
  recentErrors: { index: number; id: string; error: string }[];
  estimatedRemaining: number;
}

interface IngestJob {
  id: string;
  filename?: string;
  status: string;
  dtusCreated?: number;
  chunksProcessed?: number;
  totalChunks?: number;
  createdAt?: string;
  error?: string;
}

// File extensions we extract text from in batch ingest (binaries are skipped).
// Module-scoped so it's a stable reference (not re-created per render).
const TEXT_BATCH_EXT = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|xml|html)$/i;

// Ingest-analysis actions that read plain text (vs. a structured JSON array).
const TEXT_ANALYSIS_ACTIONS = new Set(['parseDocument', 'extractEntities']);

// Type-badge colors for the Detect Schema results table — one visual voice
// per inferred column type, "mixed" reads as a warning (genuinely ambiguous
// data), not a normal type.
const TYPE_BADGE_COLORS: Record<string, string> = {
  string: 'bg-gray-500/10 text-gray-300',
  integer: 'bg-neon-cyan/10 text-neon-cyan',
  number: 'bg-sky-500/10 text-sky-400',
  boolean: 'bg-neon-purple/10 text-neon-purple',
  date: 'bg-neon-green/10 text-neon-green',
  object: 'bg-amber-400/10 text-amber-400',
  null: 'bg-gray-600/10 text-gray-500',
  mixed: 'bg-red-500/10 text-red-400',
  default: 'bg-gray-500/10 text-gray-300',
};

export default function IngestLensPage() {
  useLensNav('ingest');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('ingest');

  const queryClient = useQueryClient();
  const [textInput, setTextInput] = useState('');
  const [chunkSize, setChunkSize] = useState(500);
  const [chunkOverlap, setChunkOverlap] = useState(50);
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [showIngestionRepos, setShowIngestionRepos] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // ── Ingest Analysis Actions — run the real ingest.* workbench macros on the
  // content in the main text area (or a pasted JSON array). These call the live
  // domain macros directly via lensRun(); the text/records the user supplies are
  // the macro's actual input (POST /api/lens/run builds a virtual artifact whose
  // .data IS the input body, so `artifact.data.text` === input.text here).
  const [analysisResult, setAnalysisResult] = useState<{ action: string; data: unknown } | null>(null);
  const [analysisPending, setAnalysisPending] = useState<string | null>(null);
  const [expectedFields, setExpectedFields] = useState('');

  const runAnalysis = useCallback(async (action: string) => {
    setAnalysisPending(action);
    // Optimistic: clear the prior result immediately so the panel reads as "working".
    setAnalysisResult(null);
    try {
      let input: Record<string, unknown>;
      if (TEXT_ANALYSIS_ACTIONS.has(action)) {
        input = { text: textInput };
      } else {
        // validateSchema / detectSchema / batchStatus operate on a JSON array of records/items.
        let parsed: unknown = null;
        try { parsed = JSON.parse(textInput); } catch { parsed = null; }
        if (!Array.isArray(parsed)) {
          setAnalysisResult({
            action,
            data: { message: `Paste a JSON array of ${action === 'batchStatus' ? 'items' : 'records'} into the text area, then run this action.` },
          });
          return;
        }
        input = action === 'validateSchema'
          ? { records: parsed, expectedFields: expectedFields.split(',').map((s) => s.trim()).filter(Boolean) }
          : action === 'detectSchema'
          ? { records: parsed }
          : { items: parsed };
      }
      const r = await lensRun('ingest', action, input);
      if (r.data.ok) setAnalysisResult({ action, data: r.data.result });
      else setAnalysisResult({ action, data: { error: r.data.error || 'Action failed' } });
    } finally {
      setAnalysisPending(null);
    }
  }, [textInput, expectedFields]);

  // Fetch past ingestions
  const { data: historyData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ingest-history'],
    queryFn: () => api.get('/api/dtus?limit=50').then(r => r.data).catch(() => ({ dtus: [] })),
    refetchInterval: 10000,
  });

  const history: IngestJob[] = (historyData?.ingestions || []);
  const recentDtus = historyData?.dtus || [];

  // Ingest text as DTU
  const ingestText = useMutation({
    mutationFn: async () => {
      const chunks = [];
      // Simple chunking by character count
      for (let i = 0; i < textInput.length; i += chunkSize - chunkOverlap) {
        chunks.push(textInput.slice(i, i + chunkSize));
      }

      const results: Record<string, unknown>[] = [];
      for (let ci = 0; ci < chunks.length; ci++) {
        const res = await api.post('/api/dtus', {
          title: title || `Ingested chunk ${ci + 1}`,
          content: chunks[ci],
          domain: domain || undefined,
          tags: ['ingested'],
        });
        results.push(res.data);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingest-history'] });
      setTextInput('');
      setTitle('');
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  // File upload handler
  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    setTextInput(text);
    setTitle(file.name.replace(/\.[^.]+$/, ''));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Batch-ingest: read each text file's content client-side (FileReader) and send it
  // to the real ingest.batch-ingest macro, which creates a DTU per text file. Binaries
  // (images) carry no extractable text here, so they're reported skipped — not faked.
  const handleBatchIngest = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.txt,.md,.json,.csv,.png,.jpg';
    input.onchange = async () => {
      const fileList = input.files;
      if (!fileList || fileList.length === 0) return;
      showToast('info', `Reading ${fileList.length} file(s)...`);
      const files = await Promise.all(
        Array.from(fileList).map(async (f) => ({
          name: f.name,
          mime: f.type || 'application/octet-stream',
          content: TEXT_BATCH_EXT.test(f.name) ? await f.text().catch(() => '') : '',
        }))
      );
      try {
        const res = await lensRun('ingest', 'batch-ingest', { files });
        if (!res.data.ok) {
          showToast('error', `Batch ingest failed${res.data.error ? `: ${res.data.error}` : ''}`);
          return;
        }
        const r = (res.data.result ?? {}) as { ingested?: number; skipped?: number };
        const ingested = r?.ingested ?? 0;
        const skipped = r?.skipped ?? 0;
        showToast('success', `Ingested ${ingested} file(s)${skipped ? `, skipped ${skipped}` : ''}`);
        queryClient.invalidateQueries({ queryKey: ['ingest-history'] });
      } catch {
        showToast('error', 'Batch ingest failed');
      }
    };
    input.click();
  }, [queryClient]);

  const chunkCount = textInput.length > 0 ? Math.ceil(textInput.length / (chunkSize - chunkOverlap)) : 0;

  // ── Ingest keyboard shortcuts (Airbyte / Fivetran idiom) ─────────
  // ⌘Enter ingests the current text; t focuses the title field;
  // c toggles config panel; r refetches history.
  useLensCommand(
    [
      { id: 'ingest-submit', keys: 'mod+enter', description: 'Ingest current text', category: 'actions',
        action: () => { if (textInput.trim() && !ingestText.isPending) ingestText.mutate(); }, global: true },
      { id: 'focus-title',   keys: 't', description: 'Focus title',          category: 'navigation', action: () => titleInputRef.current?.focus() },
      { id: 'toggle-config', keys: 'c', description: 'Toggle config panel',  category: 'view',       action: () => setShowConfig((v) => !v) },
      { id: 'refresh',       keys: 'r', description: 'Refresh history',      category: 'actions',    action: () => refetch() },
    ],
    { lensId: 'ingest' }
  );

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={(error as Error)?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <LensShell lensId="ingest" asMain={false}>
      <FirstRunTour lensId="ingest" />
      <ManifestActionBar />
      <DepthBadge lensId="ingest" size="sm" className="ml-2" />
    <div data-lens-theme="ingest" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Upload className="w-6 h-6 text-neon-cyan" />
        <div>
          <h1 className="text-xl font-bold">Ingest</h1>
          <p className="text-sm text-gray-400">
            Upload text and documents to create DTUs with configurable chunking
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="ingest" data={realtimeData || {}} compact />
        <VisionAnalyzeButton
          domain="ingest"
          prompt="Analyze this image and extract all text and structured data visible. Describe the content for ingestion as a DTU (Data Transfer Unit). Suggest a title, domain, and relevant tags."
          onResult={(res) => {
            setTextInput(res.analysis);
            if (res.suggestedTags?.length) setDomain(res.suggestedTags[0] || '');
          }}
        />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Upload, color: 'text-neon-cyan', value: history.length || recentDtus.length, label: 'Total Ingested' },
          { icon: Database, color: 'text-neon-purple', value: recentDtus.length, label: 'Recent DTUs' },
          { icon: Activity, color: 'text-neon-green', value: history.filter((j: IngestJob) => j.status === 'completed').length, label: 'Completed' },
          { icon: AlertTriangle, color: 'text-amber-400', value: history.filter((j: IngestJob) => j.status === 'failed').length, label: 'Failed' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Throughput Gauge & Pipeline Status */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="panel p-4"
      >
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-neon-cyan" />
          Ingestion Pipeline Status
        </h3>
        <div className="flex items-center gap-2 flex-wrap py-2">
          {[
            { stage: 'Queued', count: 0, color: 'bg-gray-500', textColor: 'text-gray-400' },
            { stage: 'Processing', count: ingestText.isPending ? 1 : 0, color: 'bg-neon-cyan', textColor: 'text-neon-cyan' },
            { stage: 'Complete', count: history.filter((j: IngestJob) => j.status === 'completed').length || (ingestText.isSuccess ? 1 : 0), color: 'bg-neon-green', textColor: 'text-neon-green' },
            { stage: 'Failed', count: history.filter((j: IngestJob) => j.status === 'failed').length, color: 'bg-red-500', textColor: 'text-red-400' },
          ].map((stage, i) => (
            <div key={stage.stage} className="flex items-center gap-2 flex-1">
              <div className="flex-1 bg-lattice-deep rounded-lg p-3 text-center border border-white/5">
                <p className={`text-xl font-bold font-mono ${stage.textColor}`}>{stage.count}</p>
                <p className="text-xs text-gray-400">{stage.stage}</p>
              </div>
              {i < 3 && <div className="w-4 h-px bg-white/20 flex-shrink-0" />}
            </div>
          ))}
        </div>
        {/* Source type badges */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="text-xs text-gray-400">Sources:</span>
          {[
            { label: '.txt', icon: FileText, color: 'text-neon-cyan bg-neon-cyan/10' },
            { label: '.json', icon: FileJson, color: 'text-neon-purple bg-neon-purple/10' },
            { label: '.csv', icon: Database, color: 'text-neon-green bg-neon-green/10' },
            { label: '.md', icon: FileUp, color: 'text-amber-400 bg-amber-400/10' },
          ].map((src) => (
            <span key={src.label} className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${src.color}`}>
              <src.icon className="w-3 h-3" />
              {src.label}
            </span>
          ))}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              'border-2 border-dashed rounded-xl p-8 text-center transition-colors',
              dragOver ? 'border-neon-cyan bg-neon-cyan/5' : 'border-lattice-border hover:border-gray-600'
            )}
          >
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-300">Drag & drop a text file here</p>
            <p className="text-xs text-gray-400 mt-1">or</p>
            <label className="inline-block mt-2 px-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-gray-300 hover:text-white hover:border-gray-500 cursor-pointer transition-colors">
              Browse files
              <input type="file" className="hidden" accept=".txt,.md,.csv,.json" onChange={handleFileInput} />
            </label>
          </div>

          {/* Title and domain */}
          <div className="flex gap-3">
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional · t to focus)"
              className="flex-1 px-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
            />
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain (optional)"
              className="w-40 px-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
            />
          </div>

          {/* Text area */}
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Paste or type text to ingest..."
            rows={12}
            className="w-full px-4 py-3 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan resize-y font-mono"
          />

          {/* Preview and actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span>{textInput.length.toLocaleString()} chars</span>
              <span>{chunkCount} chunk{chunkCount !== 1 ? 's' : ''}</span>
              <button
                onClick={() => setShowConfig(!showConfig)}
                className={cn('flex items-center gap-1 transition-colors', showConfig ? 'text-neon-cyan' : 'hover:text-gray-300')}
              >
                <Settings2 className="w-4 h-4" /> Config
              </button>
            </div>
            <button
              onClick={() => ingestText.mutate()}
              disabled={!textInput.trim() || ingestText.isPending}
              className="px-6 py-2 bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-sm font-medium text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {ingestText.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {ingestText.isPending ? 'Ingesting...' : 'Ingest'}
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-[10px] font-mono text-neon-cyan/70">⌘↵</kbd>
            </button>
          </div>

          {ingestText.isSuccess && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-400">
              <CheckCircle2 className="w-4 h-4" />
              Successfully ingested {chunkCount} chunk{chunkCount !== 1 ? 's' : ''} as DTUs
            </div>
          )}

          {ingestText.isError && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              <AlertTriangle className="w-4 h-4" />
              Failed to ingest: {(ingestText.error as Error)?.message || 'Unknown error'}
            </div>
          )}

          {/* Chunking config */}
          {showConfig && (
            <div className="panel p-4 space-y-3">
              <h3 className="text-sm font-medium text-white">Chunking Configuration</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Chunk size (chars): {chunkSize}</label>
                  <input type="range" min="100" max="2000" step="50" value={chunkSize}
                    onChange={(e) => setChunkSize(+e.target.value)} className="w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Overlap (chars): {chunkOverlap}</label>
                  <input type="range" min="0" max="200" step="10" value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(+e.target.value)} className="w-full" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* History sidebar */}
        <div className="space-y-4">
          <div className="panel p-4">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" /> Ingestion History
            </h2>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-lattice-deep animate-pulse rounded" />)}
              </div>
            ) : history.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {history.map(job => (
                  <div key={job.id} className="p-2 rounded bg-lattice-deep text-xs">
                    <div className="flex justify-between">
                      <span className="text-white truncate">{job.filename || job.id.slice(0, 8)}</span>
                      <span className={cn(
                        job.status === 'completed' ? 'text-green-400' :
                        job.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                      )}>{job.status}</span>
                    </div>
                    {job.dtusCreated != null && (
                      <span className="text-gray-400">{job.dtusCreated} DTUs created</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">No ingestion history yet</p>
            )}
          </div>

          <div className="panel p-4">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Database className="w-4 h-4 text-gray-400" /> Recent DTUs
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {recentDtus.slice(0, 10).map((d: Record<string, unknown>) => (
                <div key={d.id as string} className="p-2 rounded bg-lattice-deep text-xs">
                  <p className="text-white truncate">{(d.title as string) || (d.summary as string)?.slice(0, 40) || (d.id as string).slice(0, 8)}</p>
                  <p className="text-gray-400">{d.tier as string || 'regular'}</p>
                </div>
              ))}
              {recentDtus.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">No DTUs yet</p>
              )}
            </div>
          </div>
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="ingest"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Bulk Upload */}
      <div className="panel p-6 space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <ArrowDownToLine className="w-5 h-5 text-neon-cyan" />
          Bulk Upload
        </h2>
        <div className="bg-black/40 border-2 border-dashed border-white/10 rounded-xl p-6 text-center space-y-3 hover:border-neon-cyan/30 transition-colors">
          <FileUp className="w-10 h-10 text-neon-cyan mx-auto" />
          <p className="text-sm text-white font-semibold">Batch-ingest multiple files</p>
          <p className="text-xs text-gray-400">
            Drop multiple files or an entire folder to batch-ingest into the DTU pipeline.
          </p>
          <div className="flex items-center justify-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> .txt .md</span>
            <span className="flex items-center gap-1"><FileJson className="w-3 h-3" /> .json .csv</span>
            <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> .png .jpg</span>
          </div>
          <button onClick={() => void handleBatchIngest()} className="mt-2 px-6 py-2 bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-sm text-neon-cyan hover:bg-neon-cyan/30 transition-colors">
            Select Files for Batch Ingest
          </button>
        </div>
      </div>

      {/* ELT Pipeline — connectors, schedules, transforms, runs, dedup, OCR, webhook */}
      <PipelinePanel />

      {/* Recovered Auto-DTU + page-queue ingest scheduler (persisted, quota-gated) */}
      <LatticeSeedPanel />

      {/* Ingest Analysis Actions — profile & validate the content in the text area */}
      <div className="panel p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-cyan" />
            Ingest Analysis
          </h2>
          <span className="text-[11px] text-gray-500">
            Runs on the text above. Schema / batch expect a <span className="text-gray-300 font-mono">JSON array</span>.
          </span>
        </div>
        <p className="text-xs text-gray-400">
          Profile document structure, extract entities, and validate records before they become DTUs —
          the same checks a real ETL loader runs on inbound data.
        </p>
        {/* Expected-fields input drives validateSchema (comma-separated). */}
        <div className="flex items-center gap-2">
          <label htmlFor="ingest-expected-fields" className="text-xs text-gray-400 whitespace-nowrap">Expected fields</label>
          <input
            id="ingest-expected-fields"
            type="text"
            value={expectedFields}
            onChange={(e) => setExpectedFields(e.target.value)}
            placeholder="id, name, email  (for Validate Schema — optional)"
            className="flex-1 px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-neon-green font-mono"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { action: 'parseDocument', label: 'Parse Document', icon: FileText, color: 'text-neon-cyan', needsText: true },
            { action: 'extractEntities', label: 'Extract Entities', icon: Search, color: 'text-neon-purple', needsText: true },
            { action: 'validateSchema', label: 'Validate Schema', icon: CheckCircle2, color: 'text-neon-green', needsText: true },
            { action: 'detectSchema', label: 'Detect Schema', icon: Table2, color: 'text-sky-400', needsText: true },
            { action: 'batchStatus', label: 'Batch Status', icon: List, color: 'text-yellow-400', needsText: true },
          ].map(({ action, label, icon: Icon, color, needsText }) => {
            const disabled = analysisPending !== null || (needsText && !textInput.trim());
            return (
              <button
                key={action}
                onClick={() => void runAnalysis(action)}
                disabled={disabled}
                title={needsText && !textInput.trim() ? 'Add text above first' : undefined}
                className="flex items-center gap-2 px-4 py-3 bg-lattice-surface border border-lattice-border rounded-lg text-sm font-medium text-white hover:border-neon-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {analysisPending === action ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon className={`w-4 h-4 ${color}`} />
                )}
                {label}
              </button>
            );
          })}
        </div>

        {analysisResult && analysisPending === null && (() => {
          // Honest surface for empty-input / error returns (the macros return
          // { message } for missing input and { error } for a real failure).
          const meta = analysisResult.data as { message?: string; error?: string };
          if (meta?.error) {
            return (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                <AlertTriangle className="w-4 h-4" /> {meta.error}
              </div>
            );
          }
          if (meta?.message) {
            return (
              <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-300">
                <AlertTriangle className="w-4 h-4" /> {meta.message}
              </div>
            );
          }
          if (analysisResult.action === 'parseDocument') {
            const d = analysisResult.data as ParseDocumentResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-cyan">Document Parse — {d.format}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Words', value: (d.wordCount || 0).toLocaleString(), color: 'text-neon-cyan' },
                    { label: 'Sentences', value: (d.sentenceCount || 0).toLocaleString(), color: 'text-neon-purple' },
                    { label: 'Paragraphs', value: (d.paragraphCount || 0).toLocaleString(), color: 'text-neon-green' },
                    { label: 'Sections', value: (d.sectionCount || 0).toLocaleString(), color: 'text-yellow-400' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
                  <div>Avg words/sentence: <span className="text-white">{(d.avgWordsPerSentence || 0).toFixed(1)}</span></div>
                  <div>Avg words/paragraph: <span className="text-white">{(d.avgWordsPerParagraph || 0).toFixed(1)}</span></div>
                </div>
                {(d.sections || []).length > 0 && (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {d.sections.slice(0, 5).map((s, i) => (
                      <div key={i} className="flex items-center text-xs">
                        <span className="text-gray-300 truncate flex-1">{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (analysisResult.action === 'extractEntities') {
            const d = analysisResult.data as ExtractEntitiesResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-purple">Extracted Entities</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    { label: 'Emails', value: d.summary?.emailCount || 0, color: 'text-neon-cyan' },
                    { label: 'URLs', value: d.summary?.urlCount || 0, color: 'text-neon-purple' },
                    { label: 'Dates', value: d.summary?.dateCount || 0, color: 'text-neon-green' },
                    { label: 'Phones', value: d.summary?.phoneCount || 0, color: 'text-yellow-400' },
                    { label: 'Numbers', value: d.summary?.numberCount || 0, color: 'text-gray-300' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                {(d.emails || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-gray-400 mr-1">Emails:</span>
                    {d.emails.slice(0, 3).map((e, i) => <span key={i} className="text-xs px-2 py-0.5 bg-neon-cyan/10 text-neon-cyan rounded">{e}</span>)}
                  </div>
                )}
                {(d.urls || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-gray-400 mr-1">URLs:</span>
                    {d.urls.slice(0, 2).map((u, i) => <span key={i} className="text-xs px-2 py-0.5 bg-neon-purple/10 text-neon-purple rounded truncate max-w-32">{u}</span>)}
                  </div>
                )}
                {(d.dates || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-gray-400 mr-1">Dates:</span>
                    {d.dates.slice(0, 4).map((dt, i) => <span key={i} className="text-xs px-2 py-0.5 bg-neon-green/10 text-neon-green rounded">{dt}</span>)}
                  </div>
                )}
              </div>
            );
          }
          if (analysisResult.action === 'validateSchema') {
            const d = analysisResult.data as ValidateSchemaResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-green">Schema Validation</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total', value: (d.totalRecords || 0).toLocaleString(), color: 'text-gray-300' },
                    { label: 'Valid', value: (d.validRecords || 0).toLocaleString(), color: 'text-neon-green' },
                    { label: 'Invalid', value: (d.invalidRecords || 0).toLocaleString(), color: 'text-red-400' },
                    { label: 'Rate', value: `${(d.validationRate || 0).toFixed(1)}%`, color: 'text-neon-cyan' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                  <div className="h-full bg-neon-green rounded-full" style={{ width: `${(d.validationRate || 0)}%` }} />
                </div>
                {(d.issues || []).slice(0, 4).map((issue, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">Row {issue.row}</span>
                    <span className="text-red-400">{[...(issue.missingFields || []), ...(issue.extraFields || []), ...(issue.nullFields || [])].join(', ') || 'invalid'}</span>
                  </div>
                ))}
              </div>
            );
          }
          if (analysisResult.action === 'detectSchema') {
            const d = analysisResult.data as DetectSchemaResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-sky-400">Detected Schema</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Records sampled', value: (d.recordCount || 0).toLocaleString(), color: 'text-gray-300' },
                    { label: 'Fields', value: (d.fieldCount || 0).toLocaleString(), color: 'text-sky-400' },
                    { label: 'PK candidates', value: (d.primaryKeyCandidates || []).length, color: 'text-neon-green' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-lg border border-lattice-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 bg-lattice-deep/60">
                        <th className="py-2 px-3 font-medium">Field</th>
                        <th className="py-2 px-3 font-medium">Type</th>
                        <th className="py-2 px-3 font-medium">Nullable</th>
                        <th className="py-2 px-3 font-medium">Unique</th>
                        <th className="py-2 px-3 font-medium">Sample values</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(d.fields || []).map((f) => (
                        <tr key={f.field} className="border-t border-lattice-border/60 align-top">
                          <td className="py-2 px-3 text-white font-mono">{f.field}</td>
                          <td className="py-2 px-3">
                            <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-mono', TYPE_BADGE_COLORS[f.type] || TYPE_BADGE_COLORS.default)}>
                              {f.type}
                            </span>
                            {f.type === 'mixed' && f.typeBreakdown && (
                              <p className="text-[10px] text-gray-500 mt-1">
                                {Object.entries(f.typeBreakdown).map(([t, n]) => `${t}:${n}`).join(', ')}
                              </p>
                            )}
                          </td>
                          <td className="py-2 px-3 text-gray-300">{f.nullablePct}%</td>
                          <td className="py-2 px-3 text-gray-300">
                            {f.uniquePct}%
                            {f.likelyPrimaryKey && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-300">
                                <KeyRound className="w-2.5 h-2.5" /> likely PK
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-gray-400">
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {f.sampleValues.slice(0, 5).map((v, i) => (
                                <span key={i} className="px-1.5 py-0.5 rounded bg-lattice-deep border border-white/5 truncate max-w-[8rem]">
                                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }
          if (analysisResult.action === 'batchStatus') {
            const d = analysisResult.data as BatchStatusResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-yellow-400">Batch Status</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    { label: 'Total', value: d.totalItems || 0, color: 'text-gray-300' },
                    { label: 'Done', value: d.completed || 0, color: 'text-neon-green' },
                    { label: 'Pending', value: d.pending || 0, color: 'text-yellow-400' },
                    { label: 'Active', value: d.inProgress || 0, color: 'text-neon-cyan' },
                    { label: 'Failed', value: d.failed || 0, color: 'text-red-400' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">Completion</span>
                    <span className="text-neon-green">{((d.completionRate || 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                    <div className="h-full bg-neon-green rounded-full" style={{ width: `${(d.completionRate || 0) * 100}%` }} />
                  </div>
                </div>
                {d.estimatedRemaining && (
                  <p className="text-xs text-gray-400">Est. remaining: <span className="text-white">{d.estimatedRemaining}</span></p>
                )}
                {(d.recentErrors || []).length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Recent Errors</p>
                    {d.recentErrors.slice(0, 3).map((e, i) => (
                      <p key={i} className="text-xs text-red-400">[{e.index}] {e.id}: {e.error}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* ConnectiveTissueBar */}
      <ConnectiveTissueBar lensId="ingest" />

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowIngestionRepos(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Real-world ingestion tooling (external reference)</span>
          {showIngestionRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showIngestionRepos && (
          <div className="mt-3">
            <IngestionRepos />
          </div>
        )}
      </section>
    </div>
          <RecentMineCard domain="ingest" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="ingest" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="ingest" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

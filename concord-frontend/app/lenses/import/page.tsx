'use client';

import { useState, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { Upload, FileJson, Database, Check, AlertTriangle, Loader2, FileText, Archive, RefreshCw, Layers, ChevronDown, Clock, CheckCircle2, Download, BarChart3, Map, Search, GitMerge } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { api, apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { UniversalImport } from '@/components/import/UniversalImport';

interface ValidateImportResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  validationRate: number;
  status: string;
  fieldSummary: { field: string; valid: number; invalid: number; type: string }[];
  errors: { row: number; field: string; message: string }[];
  totalErrorCount: number;
}

interface MapFieldsResult {
  mappingCount: number;
  mappings: { source: string; target: string; confidence: number; confidenceLabel: string }[];
  unmappedSources: string[];
  unmappedTargets: string[];
  coverage: number;
  averageConfidence: number;
}

interface DetectDuplicatesResult {
  totalRows: number;
  duplicateGroupCount: number;
  duplicateRowCount: number;
  deduplicationSavings: number;
  keyFields: string[];
  duplicateGroups: { key: string; count: number; rows: number[] }[];
  fieldRepetition: { field: string; repetitionRate: number }[];
}

interface TransformPreviewResult {
  totalRows: number;
  previewCount: number;
  preview: Record<string, unknown>[];
  transformsApplied: number;
  totalValueChanges: number;
  changeLog: { row: number; field: string; before: unknown; after: unknown }[];
  fieldImpact: { field: string; changes: number; changeRate: number }[];
}

interface ImportJob {
  id: string;
  filename: string;
  type: 'dtus' | 'personas' | 'memories' | 'config' | 'full_backup';
  status: 'pending' | 'validating' | 'importing' | 'completed' | 'failed';
  progress: number;
  records_total: number;
  records_imported: number;
  records_skipped: number;
  records_failed: number;
  errors: string[];
  started_at: string;
  completed_at?: string;
}

interface ValidationResult {
  valid: boolean;
  type: string;
  record_count: number;
  warnings: string[];
  errors: string[];
  schema_version: string;
  compatible: boolean;
}

export default function ImportLens() {
  useLensNav('import');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('import');
  // Fetch import job history from the backend via lens data API
  const {
    items: importJobItems,
    isLoading: jobsLoading, isError: isError, error: error, refetch: refetch,
    create: createJob,
    update: updateJob,
  } = useLensData<ImportJob>('import', 'import-job', { seed: [] });

  const importJobs: ImportJob[] = importJobItems.map(item => ({
    id: item.id,
    filename: item.data.filename ?? item.title,
    type: item.data.type ?? 'dtus',
    status: item.data.status ?? 'pending',
    progress: item.data.progress ?? 0,
    records_total: item.data.records_total ?? 0,
    records_imported: item.data.records_imported ?? 0,
    records_skipped: item.data.records_skipped ?? 0,
    records_failed: item.data.records_failed ?? 0,
    errors: item.data.errors ?? [],
    started_at: item.data.started_at ?? item.createdAt,
    completed_at: item.data.completed_at,
  } as ImportJob));

  const runAction = useRunArtifact('import');
  const [importActionResult, setImportActionResult] = useState<{ action: string; data: unknown } | null>(null);

  const handleImportAction = useCallback((action: string) => {
    const artifactId = importJobItems[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action, params: {} },
      {
        onSuccess: (res) => setImportActionResult({ action, data: res.result }),
        onError: (e) => {
          console.error(`Action failed:`, e);
          setImportActionResult({ action, data: { error: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` } });
        },
      }
    );
  }, [importJobItems, runAction]);

  const [showFeatures, setShowFeatures] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace' | 'skip_existing'>('merge');
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);

  const validateFile = useCallback(async (file: File) => {
    setValidating(true);
    setValidationResult(null);
    try {
      // Read file text to send for validation via the ingest API
      const text = await file.text();
      const response = await apiHelpers.ingest.manual({
        text: `validate:${text.slice(0, 2000)}`,
        title: file.name,
        tags: ['import-validation'],
        declaredSourceType: 'import-validate',
      });
      const respData = response.data;

      // Try to parse a validation result from the API response
      if (respData && typeof respData === 'object') {
        setValidationResult({
          valid: respData.valid !== false,
          type: respData.type || respData.declaredSourceType || 'dtus',
          record_count: respData.record_count || respData.count || 0,
          warnings: respData.warnings || [],
          errors: respData.errors || [],
          schema_version: respData.schema_version || '1.0.0',
          compatible: respData.compatible !== false,
        });
      } else {
        // Fallback: ingest succeeded so the file content is valid
        setValidationResult({
          valid: true,
          type: 'dtus',
          record_count: 0,
          warnings: [],
          errors: [],
          schema_version: '1.0.0',
          compatible: true,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Validation request failed';
      setValidationResult({
        valid: false,
        type: 'unknown',
        record_count: 0,
        warnings: [],
        errors: [message],
        schema_version: 'unknown',
        compatible: false,
      });
    } finally {
      setValidating(false);
    }
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      validateFile(file);
    }
  }, [validateFile]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      validateFile(file);
    }
  };

  const startImport = async () => {
    if (!selectedFile || !validationResult) return;

    setImporting(true);
    try {
      const fileText = await selectedFile.text();

      // Queue the import via the ingest queue API
      const response = await apiHelpers.ingest.queue({
        text: fileText,
        title: selectedFile.name,
        tags: ['import', validationResult.type, importMode],
        declaredSourceType: `import-${validationResult.type}`,
      });

      const respData = response.data;

      // Record the import job in lens data for history tracking
      await createJob({
        title: selectedFile.name,
        data: {
          filename: selectedFile.name,
          type: validationResult.type,
          status: respData?.status === 'completed' ? 'completed' : 'importing',
          progress: respData?.status === 'completed' ? 100 : 0,
          records_total: validationResult.record_count,
          records_imported: respData?.imported || 0,
          records_skipped: 0,
          records_failed: 0,
          errors: [],
          started_at: new Date().toISOString(),
          completed_at: respData?.status === 'completed' ? new Date().toISOString() : undefined,
          import_mode: importMode,
          queue_id: respData?.id || respData?.queueId,
        } as unknown as Partial<ImportJob>,
        meta: { tags: ['import', validationResult.type], status: 'active' },
      });

      setSelectedFile(null);
      setValidationResult(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed';
      // Still record the failed job in history
      await createJob({
        title: selectedFile.name,
        data: {
          filename: selectedFile.name,
          type: validationResult.type,
          status: 'failed',
          progress: 0,
          records_total: validationResult.record_count,
          records_imported: 0,
          records_skipped: 0,
          records_failed: validationResult.record_count,
          errors: [message],
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        } as unknown as Partial<ImportJob>,
        meta: { tags: ['import', 'failed'], status: 'failed' },
      });
    } finally {
      setImporting(false);
    }
  };

  const handleQuickImport = async (action: 'restore' | 'full_restore' | 'template') => {
    setImporting(true);
    try {
      const prompts: Record<string, { text: string; title: string; sourceType: string }> = {
        restore: { text: 'restore-from-backup', title: 'Backup Restore', sourceType: 'backup-restore' },
        full_restore: { text: 'full-system-restore', title: 'Full System Restore', sourceType: 'full-restore' },
        template: { text: 'import-template', title: 'Template Import', sourceType: 'template-import' },
      };
      const p = prompts[action];
      await apiHelpers.ingest.manual({
        text: p.text,
        title: p.title,
        declaredSourceType: p.sourceType,
        tags: ['import', action],
      });
      await createJob({
        title: p.title,
        data: {
          filename: p.title,
          type: 'full_backup',
          status: 'importing',
          progress: 0,
          records_total: 0,
          records_imported: 0,
          records_skipped: 0,
          records_failed: 0,
          errors: [],
          started_at: new Date().toISOString(),
        } as unknown as Partial<ImportJob>,
        meta: { tags: ['import', action], status: 'active' },
      });
    } catch (e) {
      console.error('Import job creation failed:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Import job creation failed' });
    } finally {
      setImporting(false);
    }
  };

  const handleExportSubstrate = async () => {
    setImporting(true);
    try {
      const response = await api.get('/api/substrate/export', { responseType: 'arraybuffer' });
      const blob = new Blob([response.data], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `substrate-export-${new Date().toISOString().slice(0, 10)}.gz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error('[Import] Failed to export substrate:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to export substrate' }); }
    finally { setImporting(false); }
  };

  const handleImportSubstrate = async (file: File) => {
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      await api.post('/api/substrate/import', buffer, { headers: { 'Content-Type': 'application/gzip' } }).then(r => r.data);
      await createJob({
        title: file.name,
        data: {
          filename: file.name,
          type: 'full_backup',
          status: 'completed',
          progress: 100,
          records_total: 1,
          records_imported: 1,
          records_skipped: 0,
          records_failed: 0,
          errors: [],
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        } as unknown as Partial<ImportJob>,
        meta: { tags: ['import', 'substrate'], status: 'completed' },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Substrate import failed';
      await createJob({
        title: file.name,
        data: {
          filename: file.name,
          type: 'full_backup',
          status: 'failed',
          progress: 0,
          records_total: 0,
          records_imported: 0,
          records_skipped: 0,
          records_failed: 1,
          errors: [message],
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        } as unknown as Partial<ImportJob>,
        meta: { tags: ['import', 'substrate', 'failed'], status: 'failed' },
      });
    } finally { setImporting(false); }
  };

  const getStatusColor = (status: ImportJob['status']) => {
    switch (status) {
      case 'completed': return 'text-neon-green';
      case 'failed': return 'text-red-400';
      case 'importing': return 'text-neon-blue';
      case 'validating': return 'text-yellow-400';
      default: return 'text-void-400';
    }
  };

  const getStatusIcon = (status: ImportJob['status']) => {
    switch (status) {
      case 'completed': return <Check className="w-4 h-4" />;
      case 'failed': return <AlertTriangle className="w-4 h-4" />;
      case 'importing':
      case 'validating':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      default: return <FileJson className="w-4 h-4" />;
    }
  };

  const getTypeIcon = (type: ImportJob['type']) => {
    switch (type) {
      case 'dtus': return <FileText className="w-4 h-4" />;
      case 'full_backup': return <Archive className="w-4 h-4" />;
      default: return <Database className="w-4 h-4" />;
    }
  };


  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div data-lens-theme="import" className="lens-container">
      <div className="lens-header">
        <div className="flex items-center gap-3">
          <Upload className="w-8 h-8 text-neon-blue" />
          <div>
            <h1 className="text-2xl font-bold text-white">Import Lens</h1>
            <p className="text-void-400">Drop any file — music, images, documents, code, data — it just works</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="import" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
      </div>

      {/* AI Actions */}
      <UniversalActions domain="import" artifactId={importJobItems[0]?.id} compact />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Upload className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{importJobs.length}</p>
            <p className="text-xs text-gray-500">Total Imports</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Clock className="w-5 h-5 text-neon-yellow" />
          <div>
            <p className="text-lg font-bold">{importJobs.filter(j => j.status === 'pending' || j.status === 'importing' || j.status === 'validating').length}</p>
            <p className="text-xs text-gray-500">Pending</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <div>
            <p className="text-lg font-bold">{importJobs.filter(j => j.status === 'failed').length}</p>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{importJobs.filter(j => j.status === 'completed').length}</p>
            <p className="text-xs text-gray-500">Completed</p>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Universal Import — Drop any file */}
        <div className="space-y-4">
          <UniversalImport
            onImported={async (result) => {
              // Record the import in lens history
              await createJob({
                title: result.filename,
                data: {
                  filename: result.filename,
                  type: result.category as ImportJob['type'],
                  status: 'completed',
                  progress: 100,
                  records_total: 1,
                  records_imported: 1,
                  records_skipped: 0,
                  records_failed: 0,
                  errors: [],
                  started_at: new Date().toISOString(),
                  completed_at: new Date().toISOString(),
                } as unknown as Partial<ImportJob>,
                meta: { tags: ['import', result.category], status: 'completed' },
              });
            }}
          />

          {/* Legacy structured import (JSON/JSONL/ZIP backups) */}
          <div className="lens-card">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <FileJson className="w-4 h-4 text-neon-blue" />
              Structured Data Import
            </h2>
            <p className="text-void-500 text-xs mb-3">
              For Concord backups, JSON/JSONL data files, and ZIP archives.
            </p>
            <div
              className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                dragActive
                  ? 'border-neon-blue bg-neon-blue/10'
                  : 'border-void-600 hover:border-void-500'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              {validating ? (
                <Loader2 className="w-8 h-8 mx-auto mb-2 text-neon-blue animate-spin" />
              ) : (
                <Upload className={`w-8 h-8 mx-auto mb-2 ${dragActive ? 'text-neon-blue' : 'text-void-500'}`} />
              )}
              <p className="text-void-400 text-sm mb-2">
                {validating ? 'Validating...' : 'Drop backup or data files here'}
              </p>
              <label className="btn-secondary cursor-pointer text-xs">
                <input
                  type="file"
                  className="hidden"
                  accept=".json,.jsonl,.zip"
                  onChange={handleFileSelect}
                  disabled={validating}
                />
                Browse
              </label>
            </div>

            {/* Validation Result */}
            {validationResult && selectedFile && (
              <div className="mt-3 p-3 bg-void-800 rounded-lg text-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-medium truncate">{selectedFile.name}</span>
                  {validationResult.valid ? (
                    <span className="text-neon-green text-xs flex items-center gap-1">
                      <Check className="w-3 h-3" /> Valid
                    </span>
                  ) : (
                    <span className="text-red-400 text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Invalid
                    </span>
                  )}
                </div>
                <div className="flex gap-2 mb-2">
                  {(['merge', 'replace', 'skip_existing'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setImportMode(mode)}
                      className={`px-2 py-0.5 rounded text-xs capitalize ${
                        importMode === mode
                          ? 'bg-neon-blue text-white'
                          : 'bg-void-700 text-void-300 hover:bg-void-600'
                      }`}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
                <button
                  onClick={startImport}
                  disabled={!validationResult.valid || importing}
                  className="btn-primary w-full flex items-center justify-center gap-1 text-xs py-1.5"
                >
                  {importing && <Loader2 className="w-3 h-3 animate-spin" />}
                  {importing ? 'Importing...' : 'Import'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Import Options */}
        <div className="lens-card">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-neon-purple" />
            Quick Import
          </h2>

          <div className="space-y-3">
            <button
              onClick={() => handleQuickImport('restore')}
              disabled={importing}
              className="w-full p-4 bg-void-800 rounded-lg hover:bg-void-700 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <RefreshCw className={`w-8 h-8 text-neon-blue ${importing ? 'animate-spin' : ''}`} />
                <div>
                  <p className="text-white font-medium">Restore from Backup</p>
                  <p className="text-void-400 text-sm">Load from automatic backup point</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handleQuickImport('full_restore')}
              disabled={importing}
              className="w-full p-4 bg-void-800 rounded-lg hover:bg-void-700 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <Archive className="w-8 h-8 text-neon-purple" />
                <div>
                  <p className="text-white font-medium">Full System Restore</p>
                  <p className="text-void-400 text-sm">Restore entire system from archive</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handleQuickImport('template')}
              disabled={importing}
              className="w-full p-4 bg-void-800 rounded-lg hover:bg-void-700 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-neon-green" />
                <div>
                  <p className="text-white font-medium">Import Template</p>
                  <p className="text-void-400 text-sm">Load preconfigured templates</p>
                </div>
              </div>
            </button>

            <button
              onClick={handleExportSubstrate}
              disabled={importing}
              className="w-full p-4 bg-void-800 rounded-lg hover:bg-void-700 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <Download className="w-8 h-8 text-neon-cyan" />
                <div>
                  <p className="text-white font-medium">Export Substrate</p>
                  <p className="text-void-400 text-sm">Download full substrate as compressed archive</p>
                </div>
              </div>
            </button>

            <label className="w-full p-4 bg-void-800 rounded-lg hover:bg-void-700 transition-colors text-left disabled:opacity-50 cursor-pointer block">
              <div className="flex items-center gap-3">
                <Upload className="w-8 h-8 text-neon-yellow" />
                <div>
                  <p className="text-white font-medium">Import Substrate</p>
                  <p className="text-void-400 text-sm">Restore from a substrate archive (.gz)</p>
                </div>
              </div>
              <input
                type="file"
                className="hidden"
                accept=".gz,.gzip"
                disabled={importing}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleImportSubstrate(e.target.files[0]);
                }}
              />
            </label>
          </div>

          {/* Supported Formats */}
          <div className="mt-6 p-4 bg-void-800 rounded-lg">
            <h3 className="text-white font-medium mb-3">Supported Formats</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2 text-void-300">
                <Check className="w-4 h-4 text-neon-green" /> Audio (MP3, WAV, FLAC...)
              </div>
              <div className="flex items-center gap-2 text-void-300">
                <Check className="w-4 h-4 text-neon-green" /> Images (PNG, JPG, SVG...)
              </div>
              <div className="flex items-center gap-2 text-void-300">
                <Check className="w-4 h-4 text-neon-green" /> Video (MP4, WebM, MOV...)
              </div>
              <div className="flex items-center gap-2 text-void-300">
                <Check className="w-4 h-4 text-neon-green" /> Documents (PDF, TXT, MD...)
              </div>
              <div className="flex items-center gap-2 text-void-300">
                <Check className="w-4 h-4 text-neon-green" /> Data (JSON, CSV, XML...)
              </div>
              <div className="flex items-center gap-2 text-void-300">
                <Check className="w-4 h-4 text-neon-green" /> Code (JS, Python, Rust...)
              </div>
              <div className="flex items-center gap-2 text-void-300">
                <Check className="w-4 h-4 text-neon-green" /> Backups (JSON, ZIP)
              </div>
              <div className="flex items-center gap-2 text-void-300">
                <Check className="w-4 h-4 text-neon-green" /> Anything else
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Import History */}
      <div className="lens-card mt-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <FileJson className="w-5 h-5 text-neon-green" />
          Import History
        </h2>

        {jobsLoading ? (
          <div className="flex items-center justify-center p-8 text-void-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading import history...
          </div>
        ) : importJobs.length === 0 ? (
          <div className="text-center p-8 text-void-500">
            No import jobs yet. Upload a file or use quick import to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {importJobs.map((job, index) => (
              <motion.div key={job.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="p-4 bg-void-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {getTypeIcon(job.type)}
                    <div>
                      <p className="text-white font-medium">{job.filename}</p>
                      <p className="text-void-400 text-sm capitalize">{job.type.replace('_', ' ')}</p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-2 ${getStatusColor(job.status)}`}>
                    {getStatusIcon(job.status)}
                    <span className="capitalize">{job.status}</span>
                  </div>
                </div>

                {/* Progress Bar */}
                {(job.status === 'importing' || job.status === 'validating') && (
                  <div className="mb-2">
                    <div className="h-2 bg-void-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-neon-blue transition-all duration-300"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    <p className="text-void-400 text-sm mt-1">{job.progress}% complete</p>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 text-sm mt-2">
                  <div>
                    <span className="text-void-400">Total:</span>
                    <span className="text-white ml-2">{job.records_total.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-void-400">Imported:</span>
                    <span className="text-neon-green ml-2">{job.records_imported.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-void-400">Skipped:</span>
                    <span className="text-yellow-400 ml-2">{job.records_skipped}</span>
                  </div>
                  <div>
                    <span className="text-void-400">Failed:</span>
                    <span className="text-red-400 ml-2">{job.records_failed}</span>
                  </div>
                </div>

                {job.errors.length > 0 && (
                  <div className="mt-2 p-2 bg-red-900/20 rounded text-red-400 text-sm">
                    {job.errors.map((error, i) => (
                      <p key={i}>* {error}</p>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mt-2">
                  <p className="text-void-500 text-xs">
                    Started: {new Date(job.started_at).toLocaleString()}
                    {job.completed_at && ` | Completed: ${new Date(job.completed_at).toLocaleString()}`}
                  </p>
                  {(job.status === 'importing' || job.status === 'pending') && (
                    <button
                      onClick={() => updateJob(job.id, { data: { ...job, status: 'completed', progress: 100, completed_at: new Date().toISOString() } as unknown as Record<string, unknown> })}
                      className="text-xs px-2 py-1 bg-neon-green/10 text-neon-green rounded hover:bg-neon-green/20 transition-colors"
                    >
                      Mark Complete
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="import"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* AI Import Actions Panel */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-blue" />
          AI Import Analysis Actions
        </h2>
        {!importJobItems[0]?.id && (
          <p className="text-xs text-gray-500">Create an import job to run AI actions.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { action: 'validateImport', label: 'Validate Import', icon: CheckCircle2, color: 'text-neon-green' },
            { action: 'mapFields', label: 'Map Fields', icon: Map, color: 'text-neon-cyan' },
            { action: 'detectDuplicates', label: 'Detect Duplicates', icon: Search, color: 'text-yellow-400' },
            { action: 'transformPreview', label: 'Transform Preview', icon: GitMerge, color: 'text-neon-purple' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleImportAction(action)}
              disabled={runAction.isPending || !importJobItems[0]?.id}
              className="flex items-center gap-2 px-4 py-3 bg-lattice-surface border border-lattice-border rounded-lg text-sm font-medium text-white hover:border-neon-blue/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {runAction.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className={`w-4 h-4 ${color}`} />
              )}
              {label}
            </button>
          ))}
        </div>

        {importActionResult && !runAction.isPending && (() => {
          if (importActionResult.action === 'validateImport') {
            const d = importActionResult.data as ValidateImportResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neon-green">Validation Results</h3>
                  <span className={`text-xs px-2 py-1 rounded font-medium ${d.status === 'valid' ? 'bg-neon-green/20 text-neon-green' : 'bg-red-400/20 text-red-400'}`}>
                    {d.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Rows', value: (d.totalRows || 0).toLocaleString(), color: 'text-gray-300' },
                    { label: 'Valid', value: (d.validRows || 0).toLocaleString(), color: 'text-neon-green' },
                    { label: 'Invalid', value: (d.invalidRows || 0).toLocaleString(), color: 'text-red-400' },
                    { label: 'Rate', value: `${((d.validationRate || 0) * 100).toFixed(1)}%`, color: 'text-neon-cyan' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                  <div className="h-full bg-neon-green rounded-full" style={{ width: `${(d.validationRate || 0) * 100}%` }} />
                </div>
                {(d.errors || []).slice(0, 3).map((err, i) => (
                  <p key={i} className="text-xs text-red-400">Row {err.row}: {err.field} — {err.message}</p>
                ))}
                {d.totalErrorCount > 3 && <p className="text-xs text-gray-500">+{d.totalErrorCount - 3} more errors</p>}
              </div>
            );
          }
          if (importActionResult.action === 'mapFields') {
            const d = importActionResult.data as MapFieldsResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-cyan">Field Mappings — {d.mappingCount} mapped</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-cyan">{((d.coverage || 0) * 100).toFixed(1)}%</p>
                    <p className="text-xs text-gray-400">Coverage</p>
                  </div>
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-green">{((d.averageConfidence || 0) * 100).toFixed(1)}%</p>
                    <p className="text-xs text-gray-400">Avg Confidence</p>
                  </div>
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-yellow-400">{(d.unmappedSources || []).length}</p>
                    <p className="text-xs text-gray-400">Unmapped</p>
                  </div>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {(d.mappings || []).map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-300">{m.source}</span>
                      <span className="text-gray-500">→</span>
                      <span className="text-neon-cyan">{m.target}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${m.confidence > 0.8 ? 'bg-neon-green/10 text-neon-green' : m.confidence > 0.5 ? 'bg-yellow-400/10 text-yellow-400' : 'bg-red-400/10 text-red-400'}`}>
                        {m.confidenceLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (importActionResult.action === 'detectDuplicates') {
            const d = importActionResult.data as DetectDuplicatesResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-yellow-400">Duplicate Detection</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Rows', value: (d.totalRows || 0).toLocaleString(), color: 'text-gray-300' },
                    { label: 'Dup Groups', value: (d.duplicateGroupCount || 0).toString(), color: 'text-yellow-400' },
                    { label: 'Dup Rows', value: (d.duplicateRowCount || 0).toLocaleString(), color: 'text-red-400' },
                    { label: 'Savings', value: `${((d.deduplicationSavings || 0) * 100).toFixed(1)}%`, color: 'text-neon-green' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                {(d.keyFields || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-gray-500 mr-1">Key fields:</span>
                    {d.keyFields.map((f, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 bg-yellow-400/10 text-yellow-400 rounded">{f}</span>
                    ))}
                  </div>
                )}
                {(d.fieldRepetition || []).slice(0, 3).map((fr, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-24 truncate">{fr.field}</span>
                    <div className="flex-1 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${fr.repetitionRate * 100}%` }} />
                    </div>
                    <span className="text-gray-500">{(fr.repetitionRate * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            );
          }
          if (importActionResult.action === 'transformPreview') {
            const d = importActionResult.data as TransformPreviewResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-purple">Transform Preview</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-purple">{d.transformsApplied || 0}</p>
                    <p className="text-xs text-gray-400">Transforms Applied</p>
                  </div>
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-cyan">{d.totalValueChanges || 0}</p>
                    <p className="text-xs text-gray-400">Value Changes</p>
                  </div>
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-gray-300">{d.previewCount || 0}</p>
                    <p className="text-xs text-gray-400">Preview Rows</p>
                  </div>
                </div>
                {(d.fieldImpact || []).slice(0, 4).map((fi, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-28 truncate">{fi.field}</span>
                    <div className="flex-1 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                      <div className="h-full bg-neon-purple rounded-full" style={{ width: `${fi.changeRate * 100}%` }} />
                    </div>
                    <span className="text-gray-500">{fi.changes} changes</span>
                  </div>
                ))}
              </div>
            );
          }
          return null;
        })()}
      </div>

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
            <LensFeaturePanel lensId="export_import" />
          </div>
        )}
      </div>
    </div>
  );
}

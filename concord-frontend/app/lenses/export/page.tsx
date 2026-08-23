'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ExportFormatGallery } from '@/components/export/ExportFormatGallery';
import { ExportToolkit } from '@/components/export/ExportToolkit';
import { ObsidianVaultExport } from '@/components/export/ObsidianVaultExport';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery } from '@tanstack/react-query';
import { api, lensRun } from '@/lib/api/client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import {
  Download, FileJson, FileText, Database, Check, Package,
  FileCode, FileSpreadsheet, Hash, ArrowDownToLine,
  Loader2, Clock, Archive, X, ShieldCheck, Zap, GitCompare,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

type ExportFormat = 'json' | 'csv' | 'markdown' | 'text' | 'dtu';

const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; desc: string; ext: string }> = [
  { id: 'json', label: 'JSON', desc: 'Full data structure', ext: '.json' },
  { id: 'csv', label: 'CSV', desc: 'Spreadsheet format', ext: '.csv' },
  { id: 'markdown', label: 'Markdown', desc: 'Human readable', ext: '.md' },
  { id: 'text', label: 'Plain Text', desc: 'Simple text', ext: '.txt' },
  { id: 'dtu', label: '.dtu', desc: 'Concord portable container', ext: '.dtu' },
];

export default function ExportLensPage() {
  useLensNav('export');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('export');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('json');
  const [exporting, setExporting] = useState(false);
  const [exportingDtuId, setExportingDtuId] = useState<string | null>(null);
  const [singleExportFormat, setSingleExportFormat] = useState<ExportFormat>('json');
  const [showExportToolkit, setShowExportToolkit] = useState(false);
  const [showFormatGallery, setShowFormatGallery] = useState(false);

  // Format pickers via single-letter shortcut.
  useLensCommand(
    [
      { id: 'fmt-json', keys: 'j', description: 'JSON format', category: 'view', action: () => setSelectedFormat('json' as ExportFormat) },
      { id: 'fmt-csv',  keys: 'c', description: 'CSV format',  category: 'view', action: () => setSelectedFormat('csv'  as ExportFormat) },
      { id: 'fmt-pdf',  keys: 'p', description: 'PDF format',  category: 'view', action: () => setSelectedFormat('pdf'  as ExportFormat) },
    ],
    { lensId: 'export' }
  );

  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const { data: dtusData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dtus'],
    queryFn: () => api.get('/api/dtus').then((r) => r.data),
  });
  const liveDtus = (dtusData?.dtus || []) as Record<string, unknown>[];

  // Backend action wiring — every quick action below is fed the REAL current
  // DTU set (never a disconnected generic artifact), so the computed output
  // reflects what's actually about to be exported.
  const handleGeneratePackage = async () => {
    setIsRunning('generatePackage');
    try {
      const res = await lensRun('export', 'generatePackage', { items: liveDtus, format: selectedFormat, includeRelationships: true });
      setActionResult(res.data.ok === false
        ? { _action: 'generatePackage', message: `Action failed: ${res.data.error || 'Unknown error'}` }
        : { _action: 'generatePackage', ...(res.data.result as Record<string, unknown>) });
    } catch (e) { setActionResult({ _action: 'generatePackage', message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  const handleValidateExport = async () => {
    setIsRunning('validateExport');
    try {
      const res = await lensRun('export', 'validateExport', { items: liveDtus, schema: { requiredFields: ['id', 'title'] } });
      setActionResult(res.data.ok === false
        ? { _action: 'validateExport', message: `Action failed: ${res.data.error || 'Unknown error'}` }
        : { _action: 'validateExport', ...(res.data.result as Record<string, unknown>) });
    } catch (e) { setActionResult({ _action: 'validateExport', message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  // Diff the live DTU set against the last JSON export this browser ran
  // (pulled from the real export history log) — an honest "what's new since
  // I last exported" check, not a fabricated comparison.
  const handleDiffExport = async () => {
    setIsRunning('diffExport');
    try {
      const hist = await lensRun('export', 'history-list', { limit: 25 });
      const runs = ((hist.data.result as { runs?: Array<Record<string, unknown>> } | null)?.runs || [])
        .filter((r) => r.format === 'json' && r.hasPayload);
      if (runs.length === 0) {
        setActionResult({ _action: 'diffExport', message: 'No previous JSON export with a retained payload yet — run a JSON export below, then diff again.' });
        setIsRunning(null);
        return;
      }
      const dl = await lensRun('export', 'history-download', { id: runs[0].id });
      const payload = (dl.data.result as { payload?: string } | null)?.payload;
      let previous: unknown[] = [];
      try { previous = (JSON.parse(payload || '{}').dtus) || []; } catch { previous = []; }
      const res = await lensRun('export', 'diffExport', { current: liveDtus, previous });
      setActionResult(res.data.ok === false
        ? { _action: 'diffExport', message: `Action failed: ${res.data.error || 'Unknown error'}` }
        : { _action: 'diffExport', ...(res.data.result as Record<string, unknown>) });
    } catch (e) { setActionResult({ _action: 'diffExport', message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  // Bulk export handler
  const handleExport = async () => {
    setExporting(true);
    try {
      const data = { dtus: dtusData?.dtus || [] };

      if (selectedFormat === 'dtu') {
        // Export as .dtu binary via server
        const response = await api.post('/api/lens/export/export-dtu', {
          data,
          title: 'Full Concord Export',
          tags: ['export', 'bulk'],
        }, { responseType: 'blob' });
        const blob = new Blob([response.data], { type: 'application/octet-stream' });
        triggerDownload(blob, `concord-export-${Date.now()}.dtu`);
      } else {
        let content: string;
        let mimeType: string;
        let ext: string;

        switch (selectedFormat) {
          case 'csv': {
            const rows = (data.dtus as Record<string, unknown>[]).map((d) =>
              `"${String(d.title || '').replace(/"/g, '""')}","${String(d.tier || 'regular')}","${(d.tags as string[] || []).join('; ')}","${String(d.createdAt || d.timestamp || '')}"`
            );
            content = ['title,tier,tags,created_at', ...rows].join('\n');
            mimeType = 'text/csv';
            ext = '.csv';
            break;
          }
          case 'markdown': {
            const lines = ['# Concord Export\n'];
            for (const d of data.dtus as Record<string, unknown>[]) {
              lines.push(`## ${d.title || d.id}`);
              if (d.summary) lines.push(`> ${d.summary}\n`);
              if (d.tags) lines.push(`**Tags:** ${(d.tags as string[]).join(', ')}\n`);
              lines.push('---\n');
            }
            content = lines.join('\n');
            mimeType = 'text/markdown';
            ext = '.md';
            break;
          }
          case 'text': {
            const parts = data.dtus.map((d: Record<string, unknown>) =>
              `${d.title || d.id}\n${d.summary || d.content || ''}\nTags: ${(d.tags as string[] || []).join(', ')}\n`
            );
            content = parts.join('\n---\n\n');
            mimeType = 'text/plain';
            ext = '.txt';
            break;
          }
          default: {
            content = JSON.stringify(data, null, 2);
            mimeType = 'application/json';
            ext = '.json';
          }
        }

        const filename = `concord-export-${Date.now()}${ext}`;
        const blob = new Blob([content], { type: mimeType });
        triggerDownload(blob, filename);
        // Log the completed export so it appears in the history panel and
        // can be re-downloaded. Real metadata + retained payload only.
        try {
          await lensRun('export', 'record-run', {
            format: selectedFormat,
            itemCount: (data.dtus as unknown[]).length,
            byteLength: content.length,
            dataSources: ['dtus'],
            trigger: 'manual',
            filename,
            payload: content,
          });
        } catch { /* history logging is best-effort */ }
      }
    } finally {
      setExporting(false);
    }
  };

  // Single DTU export handler
  const handleSingleExport = async (dtuId: string, title: string) => {
    setExportingDtuId(dtuId);
    try {
      const response = await api.post('/api/export/universal', {
        dtuId,
        targetFormat: singleExportFormat,
        title,
      }, { responseType: 'blob' });

      const ext = EXPORT_FORMATS.find(f => f.id === singleExportFormat)?.ext || '.json';
      const safeTitle = (title || 'export').replace(/[^a-zA-Z0-9_\- ]/g, '_').slice(0, 80);
      const blob = new Blob([response.data]);
      triggerDownload(blob, `${safeTitle}${ext}`);
    } finally {
      setExportingDtuId(null);
    }
  };

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

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  const dtus = (dtusData?.dtus || []) as Array<Record<string, unknown>>;
  const importedDtus = dtus.filter((d) => (d.meta as Record<string, unknown>)?.origin === 'imported' || (d.tags as string[])?.includes('imported'));
  const localDtus = dtus.filter((d) => !((d.meta as Record<string, unknown>)?.origin === 'imported' || (d.tags as string[])?.includes('imported')));

  return (
    <LensShell lensId="export" asMain={false}>
      <FirstRunTour lensId="export" />
      <ManifestActionBar />
      <DepthBadge lensId="export" size="sm" className="ml-2" />
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <SvgIcon name="export-package" size={28} className="text-neon-green" />
        <div>
          <h1 className="text-xl font-bold">Export Lens</h1>
          <p className="text-sm text-gray-400">
            Export as DTU, JSON, CSV, Markdown, or plain text — your data, your format
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="export" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      {/* Action Panel — every action below runs against the REAL, currently-loaded
          DTU set (never a disconnected placeholder artifact). Schedule Export
          lives in the Export Toolkit below (a real persisted scheduler), so it
          isn't duplicated here as a one-shot dead click. */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-cyan" />
          Export Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {[
            { action: 'generatePackage', label: 'Generate Package', desc: 'Dry-run size + format preview', icon: Package, color: 'text-neon-green', onClick: handleGeneratePackage },
            { action: 'validateExport',  label: 'Validate Export',  desc: 'Check every DTU has id + title', icon: ShieldCheck, color: 'text-neon-cyan', onClick: handleValidateExport },
            { action: 'diffExport',      label: 'Diff vs Last Export', desc: 'Changed since your last JSON export', icon: GitCompare, color: 'text-neon-purple', onClick: handleDiffExport },
          ].map(({ action, label, desc, icon: Icon, color, onClick }) => (
            <button
              key={action}
              onClick={onClick}
              disabled={!!isRunning}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-sm hover:border-white/20 disabled:opacity-40 transition-colors text-left"
            >
              {isRunning === action ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Icon className={`w-4 h-4 shrink-0 ${color}`} />}
              <span className="min-w-0">
                <span className="block truncate">{label}</span>
                <span className="block truncate text-[10px] text-gray-400 font-normal">{desc}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Action Results */}
        {actionResult && (
          <div className="mt-3 rounded-lg bg-black/30 border border-white/10 p-4 relative">
            <button onClick={() => setActionResult(null)} className="absolute top-3 right-3 text-gray-400 hover:text-white" aria-label="Close">
              <X className="w-4 h-4" />
            </button>

            {/* generatePackage */}
            {actionResult._action === 'generatePackage' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Package Ready</p>
                {actionResult.message ? (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Format', value: String(actionResult.format || '').toUpperCase() },
                        { label: 'Items', value: String(actionResult.itemCount ?? 0) },
                        { label: 'Size', value: String(actionResult.estimatedSizeHuman ?? '—') },
                        { label: 'Status', value: String(actionResult.status ?? '—') },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className="text-lg font-bold text-white">{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400">MIME: {actionResult.mimeType as string} &nbsp;|&nbsp; Ext: {actionResult.extension as string}</p>
                  </>
                )}
              </div>
            )}

            {/* validateExport */}
            {actionResult._action === 'validateExport' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Validation Report</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Total', value: String(actionResult.totalItems ?? 0), color: 'text-white' },
                    { label: 'Valid', value: String(actionResult.valid ?? 0), color: 'text-neon-green' },
                    { label: 'Invalid', value: String(actionResult.invalid ?? 0), color: 'text-red-400' },
                    { label: 'Ready', value: actionResult.exportReady ? 'Yes' : 'No', color: actionResult.exportReady ? 'text-neon-green' : 'text-red-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                      <p className={`text-lg font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                {Array.isArray(actionResult.errors) && (actionResult.errors as Array<Record<string,unknown>>).length > 0 && (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {(actionResult.errors as Array<Record<string,unknown>>).map((e, i) => (
                      <p key={i} className="text-xs text-red-400">Row {e.index as number}: {e.error as string}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* diffExport */}
            {actionResult._action === 'diffExport' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Export Diff</p>
                {actionResult.message ? (
                  <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Added', value: String(actionResult.added ?? 0), color: 'text-neon-green' },
                        { label: 'Removed', value: String(actionResult.removed ?? 0), color: 'text-red-400' },
                        { label: 'Modified', value: String(actionResult.modified ?? 0), color: 'text-yellow-400' },
                        { label: 'Unchanged', value: String(actionResult.unchanged ?? 0), color: 'text-gray-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className={`text-xl font-bold ${color}`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <span>Current: {actionResult.totalCurrent as number} items</span>
                      <span>Previous: {actionResult.totalPrevious as number} items</span>
                      <span className="text-yellow-400">Change: {actionResult.changePercent as number}%</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }} className="lens-card">
          <Database className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{dtus.length}</p>
          <p className="text-sm text-gray-400">Total DTUs</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="lens-card">
          <Clock className="w-5 h-5 text-yellow-400 mb-2" />
          <p className="text-2xl font-bold">{localDtus.length}</p>
          <p className="text-sm text-gray-400">Pending</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="lens-card">
          <Archive className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{importedDtus.length}</p>
          <p className="text-sm text-gray-400">Imported</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="lens-card">
          <FileJson className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{EXPORT_FORMATS.length}</p>
          <p className="text-sm text-gray-400">Formats</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lens-card">
          <Check className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">Ready</p>
          <p className="text-sm text-gray-400">Status</p>
        </motion.div>
      </div>

      {/* Bulk Export */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-neon-blue" />
          Bulk Export
        </h2>

        {/* Data source — the DTU knowledge base is the only real bulk-exportable
            source today; no fabricated "Events"/"Settings" counts. */}
        <div className="lens-card flex items-center gap-3 mb-4 border-neon-green ring-1 ring-neon-green">
          <Database className="w-5 h-5 text-neon-green shrink-0" />
          <div>
            <p className="font-semibold">DTUs</p>
            <p className="text-sm text-gray-400">{dtus.length.toLocaleString()} item{dtus.length === 1 ? '' : 's'} will be exported</p>
          </div>
          <Check className="w-4 h-4 text-neon-green ml-auto" />
        </div>

        {/* Format Selection */}
        <div className="flex gap-3 mb-4">
          {EXPORT_FORMATS.map((fmt) => (
            <button
              key={fmt.id}
              onClick={() => setSelectedFormat(fmt.id)}
              className={`flex-1 lens-card text-center ${
                selectedFormat === fmt.id ? 'border-neon-purple ring-1 ring-neon-purple' : ''
              }`}
            >
              <p className="font-semibold text-sm">{fmt.label}</p>
              <p className="text-[10px] text-gray-400">{fmt.desc}</p>
            </button>
          ))}
        </div>

        <button
          onClick={handleExport}
          disabled={dtus.length === 0 || exporting}
          className="btn-neon green w-full py-3 text-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {exporting ? 'Exporting...' : `Export ${dtus.length} DTU${dtus.length === 1 ? '' : 's'} as ${selectedFormat.toUpperCase()}`}
        </button>
      </div>

      {/* Obsidian Vault Export — real multi-file .md zip, client-built via fflate */}
      <ObsidianVaultExport />

      {/* Per-DTU Export */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <ArrowDownToLine className="w-4 h-4 text-neon-purple" />
            Export Individual DTUs
          </h2>
          <div className="flex gap-1">
            {EXPORT_FORMATS.map((fmt) => (
              <button
                key={fmt.id}
                onClick={() => setSingleExportFormat(fmt.id)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  singleExportFormat === fmt.id
                    ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                    : 'bg-lattice-deep text-gray-400 hover:text-gray-300'
                }`}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        {dtus.length === 0 ? (
          <p className="text-center text-gray-400 py-6">No DTUs to export</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {/* Imported DTUs section */}
            {importedDtus.length > 0 && (
              <>
                <p className="text-xs text-gray-400 uppercase tracking-wider pt-2 pb-1 sticky top-0 bg-lattice-surface">
                  Imported ({importedDtus.length})
                </p>
                {importedDtus.map((dtu) => (
                  <DTUExportRow
                    key={dtu.id as string}
                    dtu={dtu}
                    format={singleExportFormat}
                    exporting={exportingDtuId === (dtu.id as string)}
                    onExport={() => handleSingleExport(dtu.id as string, dtu.title as string)}
                  />
                ))}
              </>
            )}

            {/* Local DTUs section */}
            {localDtus.length > 0 && (
              <>
                <p className="text-xs text-gray-400 uppercase tracking-wider pt-2 pb-1 sticky top-0 bg-lattice-surface">
                  Local ({localDtus.length})
                </p>
                {localDtus.slice(0, 50).map((dtu) => (
                  <DTUExportRow
                    key={dtu.id as string}
                    dtu={dtu}
                    format={singleExportFormat}
                    exporting={exportingDtuId === (dtu.id as string)}
                    onExport={() => handleSingleExport(dtu.id as string, dtu.title as string)}
                  />
                ))}
                {localDtus.length > 50 && (
                  <p className="text-xs text-gray-400 text-center py-2">
                    +{localDtus.length - 50} more — use bulk export for all
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Data sovereignty notice */}
      <div className="panel p-4 border-l-4 border-sovereignty-locked">
        <h3 className="font-semibold text-sovereignty-locked mb-2">Your Data, Your Control</h3>
        <p className="text-sm text-gray-400">
          As per the OWNER_CONTROL invariant, you can export all your data at any time
          in any format. Exports are complete and unredacted.
        </p>
        {realtimeData && (
          <RealtimeDataPanel
            domain="export"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
      </div>

      {/* Export Format Reference */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <ArrowDownToLine className="w-4 h-4 text-neon-purple" />
          Format Reference
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormatCard icon={FileJson} color="neon-cyan" label="JSON" type="Structured Data"
            desc="Full hierarchical data export preserving all relationships, metadata, and DTU provenance chains."
            size="~2.4 MB" mime="application/json" />
          <FormatCard icon={FileSpreadsheet} color="neon-green" label="CSV" type="Tabular Data"
            desc="Flat spreadsheet format compatible with Excel, Google Sheets, and data analysis tools."
            size="~1.8 MB" mime="text/csv" />
          <FormatCard icon={Hash} color="blue-400" label="Markdown" type="Documentation"
            desc="Clean markdown output ideal for documentation, wikis, and version-controlled knowledge bases."
            size="~0.9 MB" mime="text/markdown" />
          <FormatCard icon={FileText} color="gray-400" label="Plain Text" type="Simple Export"
            desc="Raw text content stripped of formatting. Universal compatibility."
            size="~0.5 MB" mime="text/plain" />
          <FormatCard icon={FileCode} color="neon-purple" label=".dtu" type="Concord Container"
            desc="Self-verifying knowledge container with metadata, layers, and artifacts. Import back into any Concord instance."
            size="~3.0 MB" mime="application/vnd.concord.dtu" />
        </div>
      </div>

      {/* Advanced export toolkit — scheduled runs, cloud delivery, PDF,
          delta exports, history, encryption, field selection. */}
      <section className="panel p-4">
        <button
          type="button"
          onClick={() => setShowExportToolkit(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Advanced export toolkit</span>
          {showExportToolkit ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showExportToolkit && (
          <div className="mt-3">
            <ExportToolkit />
          </div>
        )}
      </section>

      <ConnectiveTissueBar lensId="export_import" />

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowFormatGallery(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Export tooling gallery (external reference)</span>
          {showFormatGallery ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showFormatGallery && (
          <div className="mt-3">
            <ExportFormatGallery />
          </div>
        )}
      </section>
    </div>
          <RecentMineCard domain="export" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="export" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="export" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

// ── Helper Components ────────────────────────────────────────────────────

function DTUExportRow({ dtu, format, exporting, onExport }: {
  dtu: Record<string, unknown>;
  format: ExportFormat;
  exporting: boolean;
  onExport: () => void;
}) {
  const isImported = (dtu.meta as Record<string, unknown>)?.origin === 'imported' || (dtu.tags as string[])?.includes('imported');

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-black/20 border border-white/5 hover:border-white/10 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{dtu.title as string || dtu.id as string}</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">{(dtu.tier as string) || 'regular'}</span>
          {isImported && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan">imported</span>
          )}
          {((dtu.tags as string[]) || []).slice(0, 3).map((tag) => (
            <span key={tag} className="text-[10px] text-gray-400">#{tag}</span>
          ))}
        </div>
      </div>
      <button
        onClick={onExport}
        disabled={exporting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-lattice-deep border border-lattice-border text-gray-300 hover:text-white hover:border-neon-purple/30 transition-colors disabled:opacity-30"
      >
        {exporting ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Download className="w-3 h-3" />
        )}
        {format.toUpperCase()}
      </button>
    </div>
  );
}

function FormatCard({ icon: Icon, color, label, type, desc, size, mime }: {
  icon: typeof FileJson;
  color: string;
  label: string;
  type: string;
  desc: string;
  size: string;
  mime: string;
}) {
  return (
    <div data-lens-theme="export" className={`bg-black/40 border border-white/10 rounded-lg p-4 hover:border-${color}/30 transition-all group`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-3 bg-${color}/10 rounded-lg group-hover:bg-${color}/20 transition-colors`}>
          <Icon className={`w-6 h-6 text-${color}`} />
        </div>
        <div>
          <h3 className="font-medium text-white">{label}</h3>
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">{type}</span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">{desc}</p>
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        <span className="text-[10px] text-gray-400">{size} estimated</span>
        <span className={`text-[10px] text-${color}`}>{mime}</span>
      </div>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

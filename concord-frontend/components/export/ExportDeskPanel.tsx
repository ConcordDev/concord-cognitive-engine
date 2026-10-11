'use client';

/**
 * ExportDeskPanel — one action: export the signed-in user's DTUs.
 *
 * The list is the same "My Vault" cut as the DTU browser
 * (GET /api/dtus/paginated?scope=mine). The shared library is an explicit
 * opt-in (scope=all), never the default. Package, validate, diff, record-run
 * and per-DTU export stay available under the secondary disclosures.
 */

import { useQuery } from '@tanstack/react-query';
import { api, lensRun } from '@/lib/api/client';
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensCommand } from '@/hooks/useLensCommand';

type ExportFormat = 'json' | 'csv' | 'markdown' | 'text' | 'dtu';

const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; ext: string }> = [
  { id: 'json', label: 'JSON', ext: '.json' },
  { id: 'csv', label: 'CSV', ext: '.csv' },
  { id: 'markdown', label: 'Markdown', ext: '.md' },
  { id: 'text', label: 'Plain text', ext: '.txt' },
  { id: 'dtu', label: '.dtu', ext: '.dtu' },
];

const PAGE_SIZE = 100;
const MAX_EXPORT = 5000;

interface DtuRow {
  id?: string;
  title?: string;
  tier?: string;
  tags?: string[];
  summary?: string;
  content?: string;
  createdAt?: string;
  timestamp?: string;
}

interface PageBody {
  items?: DtuRow[];
  pagination?: { total?: number };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function renderBody(rows: DtuRow[], format: ExportFormat): { content: string; mimeType: string; ext: string } {
  switch (format) {
    case 'csv': {
      const lines = rows.map((d) =>
        `"${String(d.title || '').replace(/"/g, '""')}","${String(d.tier || 'regular')}","${(d.tags || []).join('; ')}","${String(d.createdAt || d.timestamp || '')}"`
      );
      return { content: ['title,tier,tags,created_at', ...lines].join('\n'), mimeType: 'text/csv', ext: '.csv' };
    }
    case 'markdown': {
      const lines = ['# Concord Export\n'];
      for (const d of rows) {
        lines.push(`## ${d.title || d.id}`);
        if (d.summary) lines.push(`> ${d.summary}\n`);
        if (d.tags) lines.push(`**Tags:** ${d.tags.join(', ')}\n`);
        lines.push('---\n');
      }
      return { content: lines.join('\n'), mimeType: 'text/markdown', ext: '.md' };
    }
    case 'text': {
      const parts = rows.map((d) =>
        `${d.title || d.id}\n${d.summary || d.content || ''}\nTags: ${(d.tags || []).join(', ')}\n`
      );
      return { content: parts.join('\n---\n\n'), mimeType: 'text/plain', ext: '.txt' };
    }
    default:
      return { content: JSON.stringify({ dtus: rows }, null, 2), mimeType: 'application/json', ext: '.json' };
  }
}

async function loadOwnedPage(scope: 'mine' | 'all', offset: number): Promise<{ items: DtuRow[]; total: number }> {
  const res = await api.get<PageBody>('/api/dtus/paginated', {
    params: { scope, limit: PAGE_SIZE, offset },
  });
  const items = res.data?.items ?? [];
  const total = res.data?.pagination?.total ?? items.length;
  return { items, total };
}

async function loadAllOwned(scope: 'mine' | 'all'): Promise<DtuRow[]> {
  const all: DtuRow[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < MAX_EXPORT && offset < total) {
    const page = await loadOwnedPage(scope, offset);
    total = page.total;
    all.push(...page.items);
    if (page.items.length < PAGE_SIZE) break;
    offset += page.items.length;
  }
  return all;
}

export function ExportDeskPanel() {
  const [library, setLibrary] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('json');
  const [singleFormat, setSingleFormat] = useState<ExportFormat>('json');
  const [exporting, setExporting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const scope: 'mine' | 'all' = library ? 'all' : 'mine';

  useLensCommand(
    [
      { id: 'fmt-json', keys: 'j', description: 'JSON format', category: 'view', action: () => setSelectedFormat('json') },
      { id: 'fmt-csv', keys: 'c', description: 'CSV format', category: 'view', action: () => setSelectedFormat('csv') },
      { id: 'fmt-md', keys: 'm', description: 'Markdown format', category: 'view', action: () => setSelectedFormat('markdown') },
    ],
    { lensId: 'export' },
  );

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['export-desk-dtus', scope],
    queryFn: () => loadOwnedPage(scope, 0),
  });

  const preview = data?.items ?? [];
  const total = data?.total ?? preview.length;

  const handleExport = async () => {
    setExporting(true);
    setErrorText(null);
    setSaved(null);
    try {
      const rows = await loadAllOwned(scope);
      if (selectedFormat === 'dtu') {
        const response = await api.post('/api/lens/export/export-dtu', {
          data: { dtus: rows },
          title: 'My Concord DTUs',
          tags: ['export', 'mine'],
        }, { responseType: 'blob' });
        triggerDownload(new Blob([response.data], { type: 'application/octet-stream' }), `concord-export-${Date.now()}.dtu`);
      } else {
        const rendered = renderBody(rows, selectedFormat);
        const filename = `concord-export-${Date.now()}${rendered.ext}`;
        triggerDownload(new Blob([rendered.content], { type: rendered.mimeType }), filename);
        try {
          await lensRun('export', 'record-run', {
            format: selectedFormat,
            itemCount: rows.length,
            byteLength: rendered.content.length,
            dataSources: ['dtus'],
            trigger: 'manual',
            filename,
            payload: rendered.content,
          });
        } catch { /* history logging is best-effort */ }
      }
      setSaved(rows.length === 1 ? '1 DTU' : `${rows.length} DTUs`);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const runAction = async (name: string, fn: () => Promise<Record<string, unknown>>) => {
    setRunning(name);
    try {
      setActionResult(await fn());
    } catch (e) {
      setActionResult({ _action: name, message: e instanceof Error ? e.message : 'Action failed' });
    } finally {
      setRunning(null);
    }
  };

  const handleGeneratePackage = () => runAction('generatePackage', async () => {
    const rows = await loadAllOwned(scope);
    const res = await lensRun('export', 'generatePackage', { items: rows, format: selectedFormat, includeRelationships: true });
    if (res.data.ok === false) return { _action: 'generatePackage', message: res.data.error || 'Action failed' };
    return { _action: 'generatePackage', ...(res.data.result as Record<string, unknown>) };
  });

  const handleValidateExport = () => runAction('validateExport', async () => {
    const rows = await loadAllOwned(scope);
    const res = await lensRun('export', 'validateExport', { items: rows, schema: { requiredFields: ['id', 'title'] } });
    if (res.data.ok === false) return { _action: 'validateExport', message: res.data.error || 'Action failed' };
    return { _action: 'validateExport', ...(res.data.result as Record<string, unknown>) };
  });

  const handleDiffExport = () => runAction('diffExport', async () => {
    const rows = await loadAllOwned(scope);
    const hist = await lensRun('export', 'history-list', { limit: 25 });
    const runs = ((hist.data.result as { runs?: Array<Record<string, unknown>> } | null)?.runs || [])
      .filter((r) => r.format === 'json' && r.hasPayload);
    if (runs.length === 0) {
      return { _action: 'diffExport', message: 'No previous JSON export with a retained payload yet.' };
    }
    const dl = await lensRun('export', 'history-download', { id: runs[0].id });
    const payload = (dl.data.result as { payload?: string } | null)?.payload;
    let previous: unknown[] = [];
    try { previous = (JSON.parse(payload || '{}').dtus) || []; } catch { previous = []; }
    const res = await lensRun('export', 'diffExport', { current: rows, previous });
    if (res.data.ok === false) return { _action: 'diffExport', message: res.data.error || 'Action failed' };
    return { _action: 'diffExport', ...(res.data.result as Record<string, unknown>) };
  });

  const handleSingleExport = async (dtuId: string, title: string) => {
    setExportingId(dtuId);
    try {
      const response = await api.post('/api/export/universal', {
        dtuId,
        targetFormat: singleFormat,
        title,
      }, { responseType: 'blob' });
      const ext = EXPORT_FORMATS.find((f) => f.id === singleFormat)?.ext || '.json';
      const safeTitle = (title || 'export').replace(/[^a-zA-Z0-9_\- ]/g, '_').slice(0, 80);
      triggerDownload(new Blob([response.data]), `${safeTitle}${ext}`);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportingId(null);
    }
  };

  if (isLoading) {
    return <p className="p-6 text-sm text-zinc-400">Loading your vault…</p>;
  }

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState error={(error as Error | null)?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <p className="text-sm text-zinc-400">
          {total === 0
            ? 'Nothing in your vault yet.'
            : `${total.toLocaleString()} DTU${total === 1 ? '' : 's'} in ${library ? 'the shared library' : 'your vault'}.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Export format">
          {EXPORT_FORMATS.map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              onClick={() => setSelectedFormat(fmt.id)}
              aria-pressed={selectedFormat === fmt.id}
              className={`rounded-full px-3 py-1 text-xs ${selectedFormat === fmt.id ? 'bg-teal-400 text-black' : 'bg-white/5 text-zinc-300'}`}
            >
              {fmt.label}
            </button>
          ))}
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            className="mt-1 accent-teal-400"
            checked={library}
            onChange={(e) => setLibrary(e.target.checked)}
          />
          <span>
            Include the shared library
            <span className="mt-0.5 block text-xs text-zinc-500">
              Adds system and unowned DTUs. Your vault stays the default.
            </span>
          </span>
        </label>
        <button
          type="button"
          onClick={handleExport}
          disabled={total === 0 || exporting}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-teal-400 px-5 py-2.5 text-sm font-medium text-black hover:bg-teal-300 disabled:opacity-40"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export my DTUs
        </button>
        {errorText && <p className="mt-3 text-xs text-rose-400">{errorText}</p>}
        {saved && <p className="mt-3 text-xs text-zinc-400">Saved {saved}.</p>}
      </section>

      <details className="rounded-xl border border-white/10 px-4 py-3">
        <summary className="cursor-pointer text-sm text-zinc-300">Check this export</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={handleValidateExport} disabled={!!running} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200">
            {running === 'validateExport' ? 'Checking…' : 'Validate export'}
          </button>
          <button type="button" onClick={handleGeneratePackage} disabled={!!running} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200">
            {running === 'generatePackage' ? 'Previewing…' : 'Preview package'}
          </button>
          <button type="button" onClick={handleDiffExport} disabled={!!running} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200">
            {running === 'diffExport' ? 'Comparing…' : 'Diff last export'}
          </button>
        </div>
        {actionResult?.message != null && (
          <p className="mt-3 text-xs text-zinc-400">{String(actionResult.message)}</p>
        )}
        {actionResult?._action === 'validateExport' && actionResult.message == null && (
          <p className="mt-3 text-xs text-zinc-300">
            {String(actionResult.valid ?? 0)} valid, {String(actionResult.invalid ?? 0)} invalid.
            {actionResult.exportReady ? ' Ready.' : ''}
          </p>
        )}
        {actionResult?._action === 'generatePackage' && actionResult.message == null && (
          <p className="mt-3 text-xs text-zinc-300">
            {String(actionResult.itemCount ?? 0)} items · {String(actionResult.format || selectedFormat)}
          </p>
        )}
        {actionResult?._action === 'diffExport' && actionResult.message == null && (
          <p className="mt-3 text-xs text-zinc-300">
            Added {String(actionResult.added ?? 0)}, removed {String(actionResult.removed ?? 0)}, modified {String(actionResult.modified ?? 0)}.
          </p>
        )}
      </details>

      <details className="rounded-xl border border-white/10 px-4 py-3">
        <summary className="cursor-pointer text-sm text-zinc-300">Export one DTU</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXPORT_FORMATS.map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              onClick={() => setSingleFormat(fmt.id)}
              aria-pressed={singleFormat === fmt.id}
              className={`rounded-full px-2 py-0.5 text-[11px] ${singleFormat === fmt.id ? 'bg-white/15 text-white' : 'text-zinc-500'}`}
            >
              {fmt.label}
            </button>
          ))}
        </div>
        {preview.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">No DTU on this page to export alone.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {preview.slice(0, 20).map((dtu) => (
              <li key={String(dtu.id)} className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-zinc-200">{dtu.title || dtu.id}</span>
                <button
                  type="button"
                  disabled={exportingId === dtu.id}
                  onClick={() => dtu.id && handleSingleExport(dtu.id, dtu.title || dtu.id)}
                  className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300"
                >
                  {exportingId === dtu.id ? 'Exporting…' : 'Export this DTU'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

interface DTUExportButtonProps {
  domain: string;
  data: unknown;
  title?: string;
  tags?: string[];
  compact?: boolean;
  className?: string;
  /** Loaded at click time. When set, this payload is what the file contains. */
  prepare?: () => Promise<unknown>;
}

export function DTUExportButton({
  domain,
  data,
  title,
  tags,
  compact,
  className = '',
  prepare,
}: DTUExportButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const addToast = useUIStore((s) => s.addToast);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      let payload = prepare ? await prepare() : data;
      // Q16: an empty payload must never be wrapped in a .dtu and
      // presented as an export. Dozens of call sites pass data={{}}
      // with no prepare; when the resolved payload is empty, load the
      // lens's real export rows (Q79's export read) and export those —
      // and if the lens genuinely has no data, refuse honestly instead
      // of downloading an empty file.
      const isEmpty = payload == null || (typeof payload === 'object' && Object.keys(payload).length === 0);
      if (isEmpty) {
        try {
          const res = await api.get(`/api/lens/${domain}/export`, { params: { limit: 1000 } });
          const rows = Array.isArray(res.data?.artifacts) ? res.data.artifacts : [];
          if (rows.length === 0) {
            addToast({ type: 'error', message: 'Nothing to export yet — this lens has no saved data.' });
            return;
          }
          payload = { source: 'lens-export', domain, exportedAt: new Date().toISOString(), items: rows };
        } catch {
          addToast({ type: 'error', message: 'Export failed — could not load this lens\u2019s data.' });
          return;
        }
      }
      // F14: the whole payload rides one POST, and a large lens state
      // died at the server's body limit as a raw "status code 413"
      // toast. Guard BEFORE the post: if the serialized payload is
      // oversized and carries an items array (the lens-export shape
      // built above), trim it progressively and MARK the export as
      // partial with both counts — an honest partial .dtu beats a
      // dead click.
      let outPayload: unknown = payload;
      try {
        const items = (payload as { items?: unknown[] })?.items;
        if (Array.isArray(items) && items.length > 0) {
          let size = JSON.stringify(payload).length;
          let kept = items.length;
          while (size > 900_000 && kept > 1) {
            kept = Math.floor(kept / 2);
            outPayload = { ...(payload as Record<string, unknown>), items: items.slice(0, kept), truncated: true, exportedCount: kept, totalCount: items.length };
            size = JSON.stringify(outPayload).length;
          }
          if ((outPayload as { truncated?: boolean })?.truncated) {
            addToast({ type: 'info', message: `Large export — packaging the first ${kept} of ${items.length} items so the file stays within the size limit.` });
          }
        }
      } catch { /* sizing is best-effort; the post below still runs */ }
      const response = await api.post(
        `/api/lens/${domain}/export-dtu`,
        { data: outPayload, title: title || `${domain} export`, tags: tags || [domain, 'export'] },
        { responseType: 'blob' }
      );

      // A9 (export genus): inspect what came back before calling it
      // an export. A 200 carrying a JSON error body (a misroute, an
      // intermediary) used to download AS a ".dtu" file and still
      // earn the checkmark — success declared without inspecting the
      // blob, the F10 mechanism. An empty or JSON-typed body is a
      // failure in words, never a download.
      const received = response.data as Blob;
      if (!received || typeof received.size !== 'number' || received.size === 0 || /json/i.test(received.type || '')) {
        addToast({ type: 'error', message: 'Export failed — the server did not return a DTU file.' });
        return;
      }

      // Trigger browser download
      const blob = new Blob([received], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${domain}-${Date.now()}.dtu`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch (e) {
      // Errors reach the user in user language — never a raw HTTP
      // status line ("Request failed with status code 413").
      const status = (e as { response?: { status?: number } })?.response?.status;
      const message =
        status === 413 ? 'Export too large — this lens’s data is bigger than a single .dtu file can hold. The JSON export (Export menu) has no such limit.'
        : status === 401 || status === 403 ? 'Export needs you signed in — sign in and try again.'
        : status !== undefined ? `Export failed — the server answered with an error (${status}). Nothing was downloaded.`
        : 'Export failed — could not reach the server. Nothing was downloaded.';
      addToast({ type: 'error', message });
    } finally {
      setExporting(false);
    }
  };

  if (compact) {
    return (
      <button
        onClick={handleExport}
        disabled={exporting}
        className={`text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 transition-colors disabled:opacity-50 ${className}`}
        title="Export as .dtu"
        aria-label={`Export ${domain} data as .dtu`}
      >
        {exported ? '✓' : exporting ? '...' : '↓ .dtu'}
      </button>
    );
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
        bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {exported ? (
        <span className="text-green-400">Exported</span>
      ) : exporting ? (
        <span>Exporting...</span>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export .dtu
        </>
      )}
    </button>
  );
}

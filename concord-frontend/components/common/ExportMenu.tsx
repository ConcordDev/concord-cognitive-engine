'use client';

import { useState, useEffect, useRef } from 'react';
import { Download, FileJson, FileSpreadsheet, ChevronDown, X } from 'lucide-react';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import { shouldIgnoreLensHotkey } from '@/lib/a11y/editable-target';
import { downloadFile, downloadFromUrl } from '@/lib/utils';
import { buildConkayExport, conkayExportCsv, getConkayCurrentModel, type ConkayExportModel } from '@/lib/conkay/model-export';

export const EMPTY_EXPORT_NOTICE =
  'Nothing to export yet. This menu exports saved lens items, and there are none here. Records kept in this lens\u2019s own panels aren\u2019t included in this export yet, so nothing was downloaded.';

export const EMPTY_EXPORT_NOTICE_STATE_BACKED =
  'Nothing to export yet. This lens has no saved items or records, so nothing was downloaded.';

export const CONKAY_EMPTY_EXPORT_NOTICE =
  'Nothing to export yet. Save a model or open a study first — nothing was downloaded.';

/**
 * GET /api/lens/:domain returns `{ artifacts, total }` (no `items` key).
 * Prefer that shape; keep a legacy `items` fallback for older mocks.
 */
export function lensListExportRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as { artifacts?: unknown; items?: unknown };
  const rows = Array.isArray(d.artifacts)
    ? d.artifacts
    : Array.isArray(d.items)
      ? d.items
      : [];
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}

interface ExportMenuProps {
  domain: string;
}

export function ExportMenu({ domain }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  // Set when there is nothing real to export. We never download an empty
  // "[]" / "No data" file and call it an export.
  const [notice, setNotice] = useState<string | null>(null);
  // Set after a file was handed to the browser. The menu closes on success, so
  // without this a delivered export had NO visible response at all (and a
  // browser that silently drops the programmatic download looked identical to
  // a dead button). Lives outside the dropdown so it survives the menu closing;
  // `url` backs a real "Save again" link a user gesture can follow.
  const [delivered, setDelivered] = useState<{ filename: string; count: number; url: string | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const deliveredUrlRef = useRef<string | null>(null);

  const clearDelivered = () => {
    if (deliveredUrlRef.current) {
      try { URL.revokeObjectURL(deliveredUrlRef.current); } catch { /* best-effort */ }
      deliveredUrlRef.current = null;
    }
    setDelivered(null);
  };
  useEffect(() => () => {
    if (deliveredUrlRef.current) {
      try { URL.revokeObjectURL(deliveredUrlRef.current); } catch { /* best-effort */ }
    }
  }, []);

  // Server path: navigate to the attachment endpoint (real HTTP download), and
  // offer that same URL as the user-gesture fallback. Nothing client-built, so
  // nothing to revoke. We can only say the download was STARTED — the page
  // cannot observe the browser's downloads.
  const deliverFromServer = (url: string, filename: string, count: number) => {
    downloadFromUrl(url);
    if (deliveredUrlRef.current) {
      try { URL.revokeObjectURL(deliveredUrlRef.current); } catch { /* best-effort */ }
      deliveredUrlRef.current = null;
    }
    setDelivered({ filename, count, url });
  };

  // Client-built path (ConKay's composite document has no server route): hand
  // the blob to the browser, then say so visibly with a manual fallback link.
  const deliver = (content: string, filename: string, mimeType: string, count: number) => {
    downloadFile(content, filename, mimeType);
    let url: string | null = null;
    try { url = URL.createObjectURL(new Blob([content], { type: mimeType })); } catch { url = null; }
    if (deliveredUrlRef.current) {
      try { URL.revokeObjectURL(deliveredUrlRef.current); } catch { /* best-effort */ }
    }
    deliveredUrlRef.current = url;
    setDelivered({ filename, count, url });
  };

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + E
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'e' || e.key === 'E')) {
        // Same rule as lens hotkeys: Ctrl+E belongs to the field while typing.
        if (shouldIgnoreLensHotkey(e)) return;
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const exportConkay = async (format: 'json' | 'csv') => {
    let lensItems: unknown[] = [];
    let lensItemsError: string | null = null;
    try {
      const response = await apiHelpers.lens.list(domain, { limit: 1000 });
      lensItems = lensListExportRows(response.data);
    } catch (err) {
      lensItemsError = err instanceof Error ? err.message : 'Could not list lens items.';
    }
    const listed = await lensRun<{ parts: ConkayExportModel[] }>('engineering', 'listParts', {});
    if (listed.data?.ok === false || !listed.data?.result) {
      setNotice(listed.data?.error || 'Could not load saved models — nothing was downloaded.');
      return false;
    }
    const parts = Array.isArray(listed.data.result.parts) ? listed.data.result.parts : [];
    const current = getConkayCurrentModel();
    if (parts.length === 0 && !current && lensItems.length === 0) {
      setNotice(lensItemsError ? 'Export failed — nothing was downloaded.' : CONKAY_EMPTY_EXPORT_NOTICE);
      return false;
    }
    const doc = buildConkayExport({ parts, current, lensItems, lensItemsError });
    const stamp = new Date().toISOString().slice(0, 10);
    const count = parts.length + (current ? 1 : 0) + lensItems.length;
    if (format === 'json') {
      deliver(JSON.stringify(doc, null, 2), `conkay-models-${stamp}.json`, 'application/json', count);
    } else {
      deliver(conkayExportCsv(doc), `conkay-models-${stamp}.csv`, 'text/csv', count);
    }
    return true;
  };

  const exportAs = async (format: 'json' | 'csv') => {
    setExporting(format);
    setNotice(null);
    clearDelivered();
    let keepOpen = false;
    try {
      if (domain === 'conkay') {
        const downloaded = await exportConkay(format);
        if (!downloaded) keepOpen = true;
        return;
      }
      const response = await apiHelpers.lens.exportList(domain, { limit: 1000 });
      const items = lensListExportRows(response.data);
      if (items.length === 0) {
        keepOpen = true;
        setNotice(
          (response.data as { stateBacked?: boolean } | null)?.stateBacked
            ? EMPTY_EXPORT_NOTICE_STATE_BACKED
            : EMPTY_EXPORT_NOTICE,
        );
        return;
      }

      const extension = format;
      const filename = `${domain}-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
      // The server streams the same rows as an attachment (Content-Disposition).
      deliverFromServer(
        `/api/lens/${encodeURIComponent(domain)}/export/download?format=${format}&limit=1000`,
        filename,
        items.length,
      );
    } catch (err) {
      console.error('Export failed:', err);
      keepOpen = true;
      setNotice('Export failed — nothing was downloaded.');
    } finally {
      setExporting(null);
      if (!keepOpen) setIsOpen(false);
    }
  };

  // FIX-engineering-015 (menu leg): ArrowDown / ArrowUp move between the
  // menu's options — the menu opened with no keyboard travel at all.
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
      .filter((b) => !b.classList.contains('sr-only'));
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown'
      ? items[(idx + 1) % items.length]
      : items[(idx - 1 + items.length) % items.length];
    next?.focus();
  };

  const options = domain === 'conkay'
    ? [
        { id: 'json', label: 'Export as JSON', icon: FileJson, desc: 'Saved models and the current study' },
        { id: 'csv', label: 'Export as CSV', icon: FileSpreadsheet, desc: 'One row per model' },
      ]
    : [
        { id: 'json', label: 'Export as JSON', icon: FileJson, desc: 'Full DTU bundle' },
        { id: 'csv', label: 'Export as CSV', icon: FileSpreadsheet, desc: 'Tabular data' },
      ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => { setIsOpen(!isOpen); }}
        className="flex min-h-11 items-center gap-1.5 px-2.5 py-1.5 md:min-h-0 rounded-lg text-gray-400 hover:text-white hover:bg-lattice-surface transition-colors text-sm"
        title="Export (Ctrl+E)"
      >
        <Download className="w-4 h-4" />
        <span className="hidden md:inline">Export</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            role="dialog"
            aria-modal="true"
            aria-label="Export"
            onKeyDown={onMenuKeyDown}
            className="absolute right-0 top-full mt-1 w-56 bg-lattice-bg border border-lattice-border rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="p-1">
              <button type="button" className="sr-only" aria-label="Close" onClick={() => setIsOpen(false)}>Close</button>
              {options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => exportAs(opt.id as 'json' | 'csv')}
                  disabled={exporting !== null}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm hover:bg-lattice-surface transition-colors disabled:opacity-50"
                >
                  <opt.icon className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-gray-200">{opt.label}</p>
                    <p className="text-xs text-gray-400">{opt.desc}</p>
                  </div>
                  {exporting === opt.id && (
                    <div className="ml-auto w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
                  )}
                </button>
              ))}
              {notice && (
                <p role="status" data-testid="export-menu-notice" className="px-3 py-2 text-xs text-amber-300">
                  {notice}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {delivered && (
        <div
          role="status"
          data-testid="export-menu-delivered"
          className="absolute right-0 top-full z-40 mt-1 flex w-72 items-start gap-2 rounded-lg border border-emerald-500/30 bg-lattice-bg px-3 py-2 text-xs text-emerald-300 shadow-2xl"
        >
          <p className="flex-1">
            Download started: {delivered.count} item{delivered.count === 1 ? '' : 's'} as <span className="font-mono">{delivered.filename}</span>.
            {' '}If it doesn’t appear in your downloads,{' '}
            {delivered.url ? (
              <a href={delivered.url} download={delivered.filename} data-testid="export-menu-save-again" className="underline">download it again</a>
            ) : (
              'try again'
            )}.
          </p>
          <button type="button" onClick={clearDelivered} aria-label="Dismiss export message" className="text-emerald-300/70 hover:text-emerald-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

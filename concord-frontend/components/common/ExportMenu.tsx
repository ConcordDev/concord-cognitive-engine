'use client';

import { useState, useEffect, useRef } from 'react';
import { Download, FileJson, FileSpreadsheet, ChevronDown } from 'lucide-react';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import { downloadFile } from '@/lib/utils';
import { buildConkayExport, conkayExportCsv, getConkayCurrentModel, type ConkayExportModel } from '@/lib/conkay/model-export';

export const EMPTY_EXPORT_NOTICE =
  'Nothing to export yet. This menu exports saved lens items, and there are none here. Records kept in this lens\u2019s own panels aren\u2019t included in this export yet, so nothing was downloaded.';

export const CONKAY_EMPTY_EXPORT_NOTICE =
  'Nothing to export yet. Save a model or open a study first — nothing was downloaded.';

interface ExportMenuProps {
  domain: string;
}

export function ExportMenu({ domain }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  // Set when there is nothing real to export. We never download an empty
  // "[]" / "No data" file and call it an export.
  const [notice, setNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
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
      lensItems = Array.isArray(response.data?.items) ? response.data.items : [];
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
    if (format === 'json') {
      downloadFile(JSON.stringify(doc, null, 2), `conkay-models-${stamp}.json`, 'application/json');
    } else {
      downloadFile(conkayExportCsv(doc), `conkay-models-${stamp}.csv`, 'text/csv');
    }
    return true;
  };

  const exportAs = async (format: 'json' | 'csv') => {
    setExporting(format);
    setNotice(null);
    let keepOpen = false;
    try {
      if (domain === 'conkay') {
        const downloaded = await exportConkay(format);
        if (!downloaded) keepOpen = true;
        return;
      }
      const response = await apiHelpers.lens.list(domain, { limit: 1000 });
      const items = response.data?.items || [];
      if (items.length === 0) {
        keepOpen = true;
        setNotice(EMPTY_EXPORT_NOTICE);
        return;
      }

      let content: string;
      let mimeType: string;
      let extension: string;

      if (format === 'json') {
        content = JSON.stringify(items, null, 2);
        mimeType = 'application/json';
        extension = 'json';
      } else {
        // CSV export
        const headers = ['id', 'title', 'type', 'createdAt', 'updatedAt'];
        const rows = items.map((item: Record<string, unknown>) =>
          headers.map(h => JSON.stringify(item[h] ?? '')).join(',')
        );
        content = [headers.join(','), ...rows].join('\n');
        mimeType = 'text/csv';
        extension = 'csv';
      }

      downloadFile(content, `${domain}-export-${new Date().toISOString().slice(0, 10)}.${extension}`, mimeType);
    } catch (err) {
      console.error('Export failed:', err);
      keepOpen = true;
      setNotice('Export failed — nothing was downloaded.');
    } finally {
      setExporting(null);
      if (!keepOpen) setIsOpen(false);
    }
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
        onClick={() => { setNotice(null); setIsOpen(!isOpen); }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-lattice-surface transition-colors text-sm"
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
            className="absolute right-0 top-full mt-1 w-56 bg-lattice-bg border border-lattice-border rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="p-1">
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
    </div>
  );
}

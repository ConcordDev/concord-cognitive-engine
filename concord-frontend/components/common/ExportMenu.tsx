'use client';

import { useState, useEffect, useRef } from 'react';
import { Download, FileJson, FileSpreadsheet, ChevronDown } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import { downloadFile } from '@/lib/utils';

interface ExportMenuProps {
  domain: string;
}

export function ExportMenu({ domain }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
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

  const exportAs = async (format: 'json' | 'csv') => {
    setExporting(format);
    try {
      const response = await apiHelpers.lens.list(domain, { limit: 1000 });
      const items = response.data?.items || [];

      let content: string;
      let mimeType: string;
      let extension: string;

      if (format === 'json') {
        content = JSON.stringify(items, null, 2);
        mimeType = 'application/json';
        extension = 'json';
      } else {
        // CSV export
        if (items.length === 0) {
          content = 'No data';
        } else {
          const headers = ['id', 'title', 'type', 'createdAt', 'updatedAt'];
          const rows = items.map((item: Record<string, unknown>) =>
            headers.map(h => JSON.stringify(item[h] ?? '')).join(',')
          );
          content = [headers.join(','), ...rows].join('\n');
        }
        mimeType = 'text/csv';
        extension = 'csv';
      }

      downloadFile(content, `${domain}-export-${new Date().toISOString().slice(0, 10)}.${extension}`, mimeType);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(null);
      setIsOpen(false);
    }
  };

  const options = [
    { id: 'json', label: 'Export as JSON', icon: FileJson, desc: 'Full DTU bundle' },
    { id: 'csv', label: 'Export as CSV', icon: FileSpreadsheet, desc: 'Tabular data' },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

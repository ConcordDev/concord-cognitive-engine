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
      const payload = prepare ? await prepare() : data;
      const response = await api.post(
        `/api/lens/${domain}/export-dtu`,
        { data: payload, title: title || `${domain} export`, tags: tags || [domain, 'export'] },
        { responseType: 'blob' }
      );

      // Trigger browser download
      const blob = new Blob([response.data], { type: 'application/octet-stream' });
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
      const message = e instanceof Error && e.message ? e.message : 'Export failed.';
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

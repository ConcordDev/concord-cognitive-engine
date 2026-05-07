'use client';

import { useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api/client';

interface DTUImportZoneProps {
  domain: string;
  onImport?: (result: { dtuId: string; metadata: Record<string, unknown> }) => void;
  compact?: boolean;
  className?: string;
}

export function DTUImportZone({
  domain,
  onImport,
  compact,
  className = '',
}: DTUImportZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.dtu')) {
      setResult('Only .dtu, .mega.dtu, and .hyper.dtu files are supported');
      setTimeout(() => setResult(null), 3000);
      return;
    }
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const response = await api.post(
        `/api/lens/${domain}/import-dtu`,
        buffer,
        { headers: { 'Content-Type': 'application/octet-stream' } }
      );
      const data = response.data;
      if (data.ok) {
        setResult(`Imported: ${data.metadata?.title || data.dtuId}`);
        onImport?.({ dtuId: data.dtuId, metadata: data.metadata });
      } else {
        setResult(`Import failed: ${data.error}`);
      }
    } catch (e) {
      setResult('Import failed');
      console.error('DTU import failed:', e);
    } finally {
      setImporting(false);
      setTimeout(() => setResult(null), 3000);
    }
  }, [domain, onImport]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const handleClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (compact) {
    return (
      <>
        <button
          onClick={handleClick}
          disabled={importing}
          className={`text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 transition-colors disabled:opacity-50 ${className}`}
          title="Import .dtu file"
        >
          {result || (importing ? '...' : '↑ Import')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dtu,.mega.dtu,.hyper.dtu"
          onChange={handleInputChange}
          className="hidden"
        />
      </>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
        ${dragging ? 'border-blue-400 bg-blue-900/20' : 'border-zinc-600 hover:border-zinc-500 bg-zinc-800/30'}
        ${className}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".dtu,.mega.dtu,.hyper.dtu"
        onChange={handleInputChange}
        className="hidden"
      />
      {result ? (
        <p className="text-sm text-zinc-300">{result}</p>
      ) : importing ? (
        <p className="text-sm text-zinc-400">Importing...</p>
      ) : (
        <div className="space-y-1">
          <svg className="w-6 h-6 mx-auto text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-xs text-zinc-400">Drop .dtu / .mega.dtu / .hyper.dtu file or click to import</p>
        </div>
      )}
    </div>
  );
}

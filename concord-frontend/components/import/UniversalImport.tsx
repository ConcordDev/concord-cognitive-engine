'use client';

/**
 * UniversalImport — Zero-friction file import.
 *
 * Drop ANY file. It becomes a DTU instantly. No forms, no friction.
 * Users don't even realize they made a DTU — they just imported their file.
 *
 * Supports:
 * - Drag and drop (single or multiple)
 * - Click to browse
 * - Auto-detection of file type, category, and target domain
 * - Optional destination hint (e.g., "artistry", "marketplace", "music")
 * - Batch import up to 20 files
 */

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Music,
  Image as ImageIcon,
  Video,
  FileText,
  Code,
  Database,
  File,
  Package,
  X,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────

interface ImportedFile {
  id: string;
  file: File;
  status: 'pending' | 'importing' | 'done' | 'error';
  dtuId?: string;
  category?: string;
  error?: string;
}

interface UniversalImportProps {
  /** Target lens/domain hint (e.g., "artistry", "music", "marketplace") */
  destination?: string;
  /** Callback when a file is successfully imported */
  onImported?: (result: { dtuId: string; filename: string; category: string }) => void;
  /** Compact mode for dashboard widget */
  compact?: boolean;
  /** Additional class names */
  className?: string;
}

// ── Category Icons ───────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, typeof File> = {
  audio: Music,
  video: Video,
  image: ImageIcon,
  document: FileText,
  code: Code,
  data: Database,
  archive: Package,
  '3d': Package,
};

const CATEGORY_COLORS: Record<string, string> = {
  audio: 'text-neon-cyan',
  video: 'text-neon-purple',
  image: 'text-neon-pink',
  document: 'text-neon-blue',
  code: 'text-neon-green',
  data: 'text-yellow-400',
  archive: 'text-orange-400',
  '3d': 'text-red-400',
};

function detectCategory(file: File): string {
  const type = file.type.toLowerCase();
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || type === 'application/epub+zip') return 'document';
  if (type.startsWith('text/markdown') || type === 'text/plain') return 'document';
  if (type === 'application/json' || type === 'text/csv' || type.includes('xml') || type.includes('yaml')) return 'data';
  if (type.includes('javascript') || type.includes('typescript') || type.includes('python')) return 'code';
  if (type.includes('zip') || type.includes('gzip') || type.includes('tar')) return 'archive';

  // Fallback by extension
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const extMap: Record<string, string> = {
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio',
    mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', avi: 'video',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
    pdf: 'document', txt: 'document', md: 'document', doc: 'document', docx: 'document', epub: 'document',
    json: 'data', csv: 'data', xml: 'data', yaml: 'data', yml: 'data', toml: 'data',
    js: 'code', ts: 'code', py: 'code', rs: 'code', go: 'code', java: 'code',
    c: 'code', cpp: 'code', rb: 'code', php: 'code', swift: 'code', sql: 'code',
    zip: 'archive', gz: 'archive', tar: 'archive', rar: 'archive',
    glb: '3d', gltf: '3d', obj: '3d', fbx: '3d',
  };
  return extMap[ext] || 'document';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix to get pure base64
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let fileIdCounter = 0;

// ── Component ────────────────────────────────────────────────────────────

export function UniversalImport({
  destination,
  onImported,
  compact = false,
  className,
}: UniversalImportProps) {
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importFile = useCallback(async (importedFile: ImportedFile) => {
    setFiles(prev => prev.map(f =>
      f.id === importedFile.id ? { ...f, status: 'importing' } : f
    ));

    try {
      const base64 = await fileToBase64(importedFile.file);
      const category = detectCategory(importedFile.file);

      const response = await api.post('/api/import/universal', {
        filename: importedFile.file.name,
        mimeType: importedFile.file.type,
        data: base64,
        domain: destination,
        destination,
        tags: destination ? [destination] : [],
      });

      const result = response.data;

      setFiles(prev => prev.map(f =>
        f.id === importedFile.id
          ? { ...f, status: 'done', dtuId: result.dtuId, category: result.category || category }
          : f
      ));

      onImported?.({
        dtuId: result.dtuId,
        filename: importedFile.file.name,
        category: result.category || category,
      });
    } catch (err) {
      setFiles(prev => prev.map(f =>
        f.id === importedFile.id
          ? { ...f, status: 'error', error: err instanceof Error ? err.message : 'Import failed' }
          : f
      ));
    }
  }, [destination, onImported]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const toAdd: ImportedFile[] = Array.from(newFiles).slice(0, 20).map(file => ({
      id: `import_${++fileIdCounter}`,
      file,
      status: 'pending' as const,
      category: detectCategory(file),
    }));

    setFiles(prev => [...prev, ...toAdd]);

    // Auto-import each file immediately
    for (const f of toAdd) {
      importFile(f);
    }
  }, [importFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [addFiles]);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setFiles(prev => prev.filter(f => f.status !== 'done'));
  }, []);

  const doneCount = files.filter(f => f.status === 'done').length;
  const activeCount = files.filter(f => f.status === 'importing').length;

  return (
    <div className={cn('rounded-xl bg-lattice-surface border border-lattice-border overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <h2 className={cn('font-semibold text-white flex items-center gap-2', compact ? 'text-sm' : 'text-lg')}>
          <Upload className="w-4 h-4 text-neon-cyan" />
          {compact ? 'Import' : 'Import Anything'}
        </h2>
        {doneCount > 0 && (
          <button
            onClick={clearCompleted}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear completed
          </button>
        )}
      </div>

      <div className={cn('p-4', compact ? 'space-y-3' : 'space-y-4')}>
        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'relative border-2 border-dashed rounded-xl text-center cursor-pointer transition-all',
            compact ? 'p-5' : 'p-8',
            isDragOver
              ? 'border-neon-cyan bg-neon-cyan/5 scale-[1.01]'
              : 'border-lattice-border hover:border-gray-500 hover:bg-lattice-deep/30'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          <motion.div
            animate={isDragOver ? { scale: 1.05, y: -3 } : { scale: 1, y: 0 }}
            className="space-y-2"
          >
            <Upload className={cn(
              'mx-auto',
              compact ? 'w-6 h-6' : 'w-8 h-8',
              isDragOver ? 'text-neon-cyan' : 'text-gray-500'
            )} />
            <div>
              <p className={cn('text-white font-medium', compact ? 'text-sm' : '')}>
                {isDragOver ? 'Drop to import' : 'Drop any file here'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Music, images, documents, code, data — anything goes
              </p>
            </div>
          </motion.div>
        </div>

        {/* File list */}
        <AnimatePresence mode="popLayout">
          {files.map(f => {
            const Icon = CATEGORY_ICONS[f.category || 'document'] || File;
            const color = CATEGORY_COLORS[f.category || 'document'] || 'text-gray-400';

            return (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border"
              >
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {f.status === 'importing' ? (
                    <Loader2 className="w-4 h-4 text-neon-cyan animate-spin" />
                  ) : f.status === 'done' ? (
                    <CheckCircle2 className="w-4 h-4 text-neon-green" />
                  ) : f.status === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <Icon className={cn('w-4 h-4', color)} />
                  )}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{f.file.name}</p>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[10px] uppercase tracking-wider', color)}>
                      {f.category || detectCategory(f.file)}
                    </span>
                    <span className="text-[10px] text-gray-600">{formatBytes(f.file.size)}</span>
                    {f.status === 'error' && (
                      <span className="text-[10px] text-red-400 truncate">{f.error}</span>
                    )}
                  </div>
                </div>

                {/* Remove button */}
                {f.status !== 'importing' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                    className="flex-shrink-0 p-1 text-gray-500 hover:text-gray-300 transition-colors"
                  aria-label="Close">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Summary bar */}
        {files.length > 0 && (
          <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
            <span>
              {doneCount} imported
              {activeCount > 0 && `, ${activeCount} processing`}
              {files.filter(f => f.status === 'error').length > 0 && (
                <span className="text-red-400">
                  , {files.filter(f => f.status === 'error').length} failed
                </span>
              )}
            </span>
            <span className="text-gray-600">
              {files.length} file{files.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default UniversalImport;

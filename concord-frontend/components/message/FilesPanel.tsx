'use client';

/**
 * FilesPanel — per-channel file sharing + browser (Slack file parity).
 * Wires message.file-{upload,list,delete}. Real files are read with the
 * FileReader API and uploaded as data URLs — no mock entries.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Trash2, FileText, Image as ImageIcon, Film, Music, File as FileIcon, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface FileEntry {
  id: string;
  channelId: string;
  name: string;
  ext: string;
  fileKind: 'image' | 'video' | 'audio' | 'document' | 'file';
  sizeBytes: number;
  mimeType: string;
  dataUrl: string | null;
  url: string | null;
  uploadedBy: string;
  uploadedAt: string;
}

const KIND_ICON: Record<string, typeof FileText> = {
  image: ImageIcon, video: Film, audio: Music, document: FileText, file: FileIcon,
};

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesPanel({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>('');
  const [totalBytes, setTotalBytes] = useState(0);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('message', 'file-list', { channelId, fileKind: kindFilter || undefined });
      if (r.data?.ok) {
        setFiles((r.data.result?.files as FileEntry[]) ?? []);
        setTotalBytes((r.data.result?.totalBytes as number) ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [channelId, kindFilter]);

  useEffect(() => { void load(); }, [load]);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of Array.from(list)) {
        if (f.size > 1024 * 1024 * 1024) { setError(`${f.name} exceeds 1 GB limit`); continue; }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(new Error('read failed'));
          fr.readAsDataURL(f);
        });
        const r = await lensRun('message', 'file-upload', {
          channelId, name: f.name, sizeBytes: f.size, mimeType: f.type, dataUrl,
        });
        if (!r.data?.ok) setError(r.data?.error ?? 'upload failed');
      }
      await load();
    } catch {
      setError('upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(f: FileEntry) {
    await lensRun('message', 'file-delete', { channelId, id: f.id });
    if (preview?.id === f.id) setPreview(null);
    await load();
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-200">Files · #{channelName}</h2>
        <span className="text-[10px] text-gray-500">{files.length} files · {fmtBytes(totalBytes)}</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-300"
          >
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="document">Documents</option>
            <option value="file">Other</option>
          </select>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="px-2.5 py-1 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Upload
          </button>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        </div>
      </div>

      {error && <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1">{error}</div>}

      {loading ? (
        <p className="text-xs text-gray-500 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-gray-600">No files shared yet. Use Upload to add one.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {files.map((f) => {
            const Icon = KIND_ICON[f.fileKind] ?? FileIcon;
            return (
              <div key={f.id} className="group rounded border border-white/10 bg-white/[0.03] p-2">
                <button
                  onClick={() => setPreview(f)}
                  className="w-full h-20 rounded bg-black/40 flex items-center justify-center overflow-hidden mb-1"
                >
                  {f.fileKind === 'image' && f.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.dataUrl} alt={f.name} className="object-cover w-full h-full" />
                  ) : (
                    <Icon className="w-7 h-7 text-gray-500" />
                  )}
                </button>
                <div className="flex items-start gap-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-gray-200 truncate" title={f.name}>{f.name}</div>
                    <div className="text-[9px] text-gray-500">{fmtBytes(f.sizeBytes)} · {f.uploadedBy}</div>
                  </div>
                  <button onClick={() => remove(f)} className="opacity-0 group-hover:opacity-100 text-rose-300" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <div className="bg-[#0d1117] border border-white/10 rounded-lg p-4 max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-gray-200 truncate">{preview.name}</span>
              <button onClick={() => setPreview(null)} className="ml-auto text-gray-400 text-lg">×</button>
            </div>
            {preview.fileKind === 'image' && preview.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.dataUrl} alt={preview.name} className="max-h-[60vh] mx-auto rounded" />
            ) : preview.fileKind === 'video' && preview.dataUrl ? (
              <video src={preview.dataUrl} controls className="max-h-[60vh] mx-auto rounded" />
            ) : preview.fileKind === 'audio' && preview.dataUrl ? (
              <audio src={preview.dataUrl} controls className="w-full" />
            ) : (
              <p className="text-xs text-gray-400 py-6 text-center">No inline preview for {preview.ext || 'this'} files.</p>
            )}
            <div className="text-[10px] text-gray-500 mt-2">
              {fmtBytes(preview.sizeBytes)} · uploaded {new Date(preview.uploadedAt).toLocaleString()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FilesPanel;

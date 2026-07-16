'use client';

/**
 * TravelDocsPanel — travel documents (passport, visa, insurance, …)
 * with expiry-status flags.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Loader2, Plus, FileText, AlertTriangle, Paperclip, FileDown, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn, formatBytes } from '@/lib/utils';

interface TravelDocAttachment {
  id: string; fileName: string; mimeType: string; bytes: number; createdAt: string;
}

interface TravelDoc {
  id: string; title: string; kind: string; number: string | null;
  expiryDate: string | null; expiryStatus: string;
  attachments?: TravelDocAttachment[]; attachmentCount?: number;
}

const KINDS = ['passport', 'visa', 'insurance', 'ticket', 'reservation', 'vaccination', 'other'];
const STATUS_COLOR: Record<string, string> = {
  expired: 'text-rose-400', expiring_soon: 'text-amber-400', valid: 'text-emerald-400', none: 'text-zinc-400',
};

export function TravelDocsPanel() {
  const [docs, setDocs] = useState<TravelDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', kind: 'passport', number: '', expiryDate: '' });
  // Attachment upload/download state — honest: nothing here is set to a
  // "success" shape until the backend macro actually confirms it.
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingDocIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('travel', 'travel-doc-list', {});
    setDocs(r.data?.result?.documents || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.title.trim()) { setError('Document title is required.'); return; }
    const r = await lensRun('travel', 'travel-doc-add', {
      title: form.title.trim(), kind: form.kind, number: form.number.trim(), expiryDate: form.expiryDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', kind: 'passport', number: '', expiryDate: '' });
    setError(null);
    await refresh();
  };

  // Opens the hidden file picker scoped to a specific document.
  const requestAttach = (docId: string) => {
    pendingDocIdRef.current = docId;
    fileInputRef.current?.click();
  };

  // Reads the selected file as base64 (same FileReader.readAsDataURL
  // idiom used by PjTaskDetail.tsx's uploadFile / attachment-upload) and
  // uploads it via travel-doc-attachment-upload. Nothing renders as
  // "attached" until the macro call itself returns ok:true — a failed
  // read or a rejected upload (oversized/malformed) surfaces as an
  // honest error, never a fabricated success.
  const onFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const docId = pendingDocIdRef.current;
    if (!file || !docId) return;
    setUploadError(null);
    if (file.size > 5 * 1024 * 1024) { setUploadError('File exceeds the 5 MB limit.'); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    setUploadingDocId(docId);
    try {
      const data: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const r = await lensRun('travel', 'travel-doc-attachment-upload', {
        docId, fileName: file.name, mimeType: file.type || 'application/octet-stream', data,
      });
      if (r.data?.ok === false) setUploadError(r.data?.error || 'Upload failed.');
      else await refresh();
    } catch {
      setUploadError('Could not read the file.');
    }
    setUploadingDocId(null);
    pendingDocIdRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Fetches a binary attachment's base64 payload and triggers a browser
  // download via an in-memory Blob (no fabricated intermediate state —
  // the anchor only exists after the macro call resolves with data).
  const downloadAttachment = async (id: string, fileName: string) => {
    const r = await lensRun<{ id: string; fileName: string; mimeType: string; bytes: number; data: string }>(
      'travel', 'travel-doc-attachment-download', { id });
    const res = r.data?.result;
    if (!r.data?.ok || !res) { setUploadError(r.data?.error || 'Download failed.'); return; }
    const binary = atob(res.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: res.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = res.fileName || fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const deleteAttachment = async (id: string) => {
    const r = await lensRun('travel', 'travel-doc-attachment-delete', { id });
    if (r.data?.ok === false) { setUploadError(r.data?.error || 'Delete failed.'); return; }
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { void onFileSelected(e); }} />
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      {uploadError && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{uploadError}</div>}

      <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Document title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input placeholder="Number / reference" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" title="Expiry" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={add}
          className="col-span-2 flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add document
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No travel documents. Track passports, visas and insurance with expiry alerts.
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => {
            const attachments = d.attachments || [];
            const isUploading = uploadingDocId === d.id;
            return (
              <li key={d.id} className={cn('bg-zinc-900/70 border rounded-xl p-3 space-y-2',
                d.expiryStatus === 'expired' ? 'border-rose-900/60' : 'border-zinc-800')}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-sky-400" />
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{d.title}</p>
                      <p className="text-[11px] text-zinc-400 capitalize">
                        {d.kind}{d.number ? ` · ${d.number}` : ''}{d.expiryDate ? ` · expires ${d.expiryDate}` : ''}
                      </p>
                    </div>
                  </div>
                  {d.expiryStatus !== 'none' && (
                    <span className={cn('flex items-center gap-1 text-[10px] capitalize', STATUS_COLOR[d.expiryStatus])}>
                      {d.expiryStatus !== 'valid' && <AlertTriangle className="w-3 h-3" />}
                      {d.expiryStatus.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                {/* Binary attachments — scans, boarding passes, QR codes. */}
                <div className="pl-6 space-y-1">
                  {attachments.length > 0 && (
                    <ul className="space-y-1">
                      {attachments.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 text-[11px]">
                          <FileDown className="w-3 h-3 text-emerald-400 shrink-0" />
                          <button type="button" onClick={() => downloadAttachment(a.id, a.fileName)}
                            className="flex-1 truncate text-emerald-400 hover:underline text-left">{a.fileName}</button>
                          <span className="text-[9px] text-zinc-500">{formatBytes(a.bytes)}</span>
                          <button aria-label="Delete attachment" type="button" onClick={() => deleteAttachment(a.id)}
                            className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" onClick={() => requestAttach(d.id)} disabled={isUploading}
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-sky-400 disabled:opacity-50">
                    {isUploading
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
                      : <><Paperclip className="w-3 h-3" /> {attachments.length > 0 ? 'Attach another file' : 'Attach file (scan, boarding pass, QR code)'}</>}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

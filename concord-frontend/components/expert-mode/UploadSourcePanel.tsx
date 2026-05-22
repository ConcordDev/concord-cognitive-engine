'use client';

/**
 * UploadSourcePanel — paste file / PDF text as a query source, list
 * stored uploads, and pick one to ground an answer in. Wires
 * expert_mode.upload_source / upload_list / upload_delete.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { FileUp, Trash2, Loader2, Paperclip, X } from 'lucide-react';

export interface UploadDoc {
  id: string;
  name: string;
  kind: string;
  chars: number;
  createdAt: number;
}

export function UploadSourcePanel({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [uploads, setUploads] = useState<UploadDoc[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ uploads: UploadDoc[] }>('expert_mode', 'upload_list', {});
    if (r.data.ok && r.data.result?.uploads) setUploads(r.data.result.uploads);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(async () => {
    if (!text.trim()) { setErr('Paste document text first.'); return; }
    setBusy(true);
    setErr(null);
    const r = await lensRun<{ upload: UploadDoc }>('expert_mode', 'upload_source', {
      name: name.trim() || 'Untitled document',
      text,
      kind: 'text',
    });
    setBusy(false);
    if (r.data.ok && r.data.result?.upload) {
      setName('');
      setText('');
      setOpen(false);
      await refresh();
      onSelect(r.data.result.upload.id);
    } else {
      setErr(r.data.error || 'Upload failed.');
    }
  }, [name, text, refresh, onSelect]);

  const remove = useCallback(async (id: string) => {
    await lensRun('expert_mode', 'upload_delete', { uploadId: id });
    if (selectedId === id) onSelect(null);
    await refresh();
  }, [selectedId, onSelect, refresh]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Paperclip className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-zinc-200">Document sources</h3>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-sky-600 hover:bg-sky-500 text-sky-50 font-medium"
        >
          <FileUp className="w-3.5 h-3.5" /> {open ? 'Cancel' : 'Add'}
        </button>
      </div>

      {open && (
        <div className="space-y-2 mb-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Document name (e.g. report.pdf)"
            className="w-full px-2.5 py-1.5 rounded bg-zinc-950 text-zinc-100 text-[12px] ring-1 ring-zinc-800 focus:ring-sky-500 focus:outline-none"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the extracted PDF / file text here…"
            rows={5}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-950 text-zinc-100 text-[12px] ring-1 ring-zinc-800 focus:ring-sky-500 focus:outline-none resize-y"
          />
          {err && <p className="text-[11px] text-red-400">{err}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={busy || !text.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-sky-50 text-[12px] font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
            Store as source
          </button>
        </div>
      )}

      {uploads.length === 0 ? (
        <p className="text-[11px] text-zinc-600">No documents yet. Add one to ground an answer in your own file.</p>
      ) : (
        <ul className="space-y-1">
          {uploads.map((u) => {
            const active = u.id === selectedId;
            return (
              <li
                key={u.id}
                className={
                  'flex items-center gap-2 px-2 py-1.5 rounded text-[11px] border ' +
                  (active ? 'border-sky-500 bg-sky-500/10' : 'border-zinc-800 bg-zinc-950/50')
                }
              >
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : u.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <span className={active ? 'text-sky-300 font-medium' : 'text-zinc-300'}>{u.name}</span>
                  <span className="text-zinc-600 ml-1.5">{u.chars.toLocaleString()} chars</span>
                </button>
                {active && (
                  <button type="button" onClick={() => onSelect(null)} title="Deselect" className="text-sky-400 hover:text-sky-200">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => remove(u.id)} title="Delete" className="text-zinc-600 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selectedId && (
        <p className="mt-2 text-[10px] text-sky-400">
          Next question will be grounded in the selected document (cited as [U]).
        </p>
      )}
    </div>
  );
}

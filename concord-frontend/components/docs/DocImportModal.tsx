'use client';

import { useState, useCallback, useRef } from 'react';
import { callDocsMacro } from '@/lib/api/docs';
import { X, Upload, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (id: string) => void;
}

export function DocImportModal({ open, onClose, onImported }: Props) {
  const [markdown, setMarkdown] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMd = useCallback(async () => {
    if (!markdown.trim()) return;
    setBusy(true);
    try {
      const r = await callDocsMacro<{ id?: string }>('import_md', {
        markdown, title: title || undefined,
      });
      if (r?.ok && r.id) onImported(r.id);
    } catch (e) { console.error('import_md', e); }
    finally { setBusy(false); }
  }, [markdown, title, onImported]);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setMarkdown(text);
    setTitle(f.name.replace(/\.md$/i, ''));
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-2xl flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4" /> Import Markdown
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional — first H1 will be used if blank)"
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40"
          />
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white/80 text-sm flex items-center gap-2"
            >
              <Upload className="w-3.5 h-3.5" /> Choose .md file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              onChange={onFile}
              className="hidden"
            />
          </div>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="…or paste markdown here"
            rows={14}
            className="w-full px-2 py-1.5 text-sm font-mono bg-black/40 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40 resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={importMd}
            disabled={busy || !markdown.trim()}
            className="px-4 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useCallback, useEffect } from 'react';
import { callTasksMacro } from '@/lib/api/tasks';
import { X, Loader2, FolderPlus } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; onCreated: (id: string) => void; }

export function ProjectCreateModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📋');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setName(''); setKey(''); setDescription(''); setIcon('📋'); setError(null); setBusy(false); }
  }, [open]);

  // Auto-derive key from name on first edit
  useEffect(() => {
    if (!key && name) {
      const guess = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (guess.length >= 2) setKey(guess);
    }
  }, [name, key]);

  const submit = useCallback(async () => {
    if (!name.trim() || !key.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await callTasksMacro<{ id?: string; reason?: string }>('project_create', {
        name, key, description: description || undefined, icon,
      });
      if (r.ok && r.id) onCreated(r.id);
      else setError(r.reason || 'create_failed');
    } catch (e: unknown) {
      setError((e as Error)?.message || 'create_failed');
    } finally { setBusy(false); }
  }, [name, key, description, icon, onCreated]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-md">
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-cyan-400" /> New project
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Project name"
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          />
          <div className="flex gap-2">
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 3))}
              placeholder="📋"
              className="w-16 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white text-center"
            />
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().slice(0, 10))}
              placeholder="KEY"
              className="flex-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white font-mono"
            />
          </div>
          <p className="text-xs text-white/40">Key drives task IDs (e.g. {key || 'WEB'}-42). Uppercase letters + digits, 2–10 chars.</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Description (optional)"
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white resize-none"
          />
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-white/10">
          <button onClick={onClose} className="px-3 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !name.trim() || !key.trim()}
            className="px-4 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

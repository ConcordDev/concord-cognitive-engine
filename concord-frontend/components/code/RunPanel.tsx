'use client';

/**
 * RunPanel — VS Code Run & Debug side panel. Manages named run
 * configurations (the tasks.json equivalent) and code bookmarks.
 */

import { useCallback, useEffect, useState } from 'react';
import { Play, Plus, Trash2, Loader2, Bookmark } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface RunConfig { id: string; name: string; command: string; kind: string }
interface BookmarkRow { id: string; path: string; line: number; label: string }

export function RunPanel({
  projectId, onOpen,
}: { projectId: string | null; onOpen: (path: string, line: number) => void }) {
  const [configs, setConfigs] = useState<RunConfig[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', command: '' });

  const refresh = useCallback(async () => {
    if (!projectId) { setConfigs([]); setBookmarks([]); return; }
    setLoading(true);
    try {
      const [c, b] = await Promise.all([
        lensRun({ domain: 'code', action: 'run-config-list', input: { projectId } }),
        lensRun({ domain: 'code', action: 'bookmark-list', input: { projectId } }),
      ]);
      setConfigs((c.data?.result?.configs || []) as RunConfig[]);
      setBookmarks((b.data?.result?.bookmarks || []) as BookmarkRow[]);
    } catch (e) { console.error('[Run] failed', e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addConfig() {
    if (!projectId || !form.name.trim() || !form.command.trim()) return;
    await lensRun({ domain: 'code', action: 'run-config-save', input: { projectId, name: form.name.trim(), command: form.command.trim() } });
    setForm({ name: '', command: '' });
    await refresh();
  }
  async function delConfig(id: string) {
    if (!projectId) return;
    await lensRun({ domain: 'code', action: 'run-config-delete', input: { projectId, id } });
    await refresh();
  }
  async function delBookmark(id: string) {
    if (!projectId) return;
    await lensRun({ domain: 'code', action: 'bookmark-delete', input: { projectId, id } });
    await refresh();
  }

  if (!projectId) return <div className="p-3 text-xs text-gray-400 italic">Open a project to manage run configs.</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <Play className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Run &amp; Bookmarks</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</div>
        ) : (
          <>
            <div className="p-2 border-b border-white/10 space-y-1.5">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Config name (e.g. Run tests)"
                className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <div className="flex items-center gap-1">
                <input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder="command — e.g. npm test"
                  className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                <button aria-label="Add" type="button" onClick={addConfig} className="p-1 text-blue-300 hover:text-blue-200"><Plus className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-gray-400 font-semibold bg-white/[0.02]">
              Run configurations · {configs.length}
            </div>
            {configs.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-gray-400 italic">No run configurations yet.</div>
            ) : configs.map((c) => (
              <div key={c.id} className="px-3 py-1.5 flex items-center gap-2 hover:bg-white/[0.03] group">
                <Play className="w-3 h-3 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-white truncate">{c.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono truncate">{c.command}</div>
                </div>
                <button aria-label="Delete" type="button" onClick={() => delConfig(c.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-300">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}

            <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-gray-400 font-semibold bg-white/[0.02]">
              Bookmarks · {bookmarks.length}
            </div>
            {bookmarks.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-gray-400 italic">No bookmarks. Add them from the editor gutter.</div>
            ) : bookmarks.map((b) => (
              <div key={b.id} className="px-3 py-1.5 flex items-center gap-2 hover:bg-white/[0.03] group">
                <Bookmark className="w-3 h-3 text-amber-400 shrink-0" />
                <button type="button" onClick={() => onOpen(b.path, b.line)} className="flex-1 min-w-0 text-left">
                  <div className="text-[11px] text-white truncate">{b.label || b.path.split('/').pop()}</div>
                  <div className="text-[10px] text-blue-300 font-mono truncate">{b.path}:{b.line}</div>
                </button>
                <button aria-label="Delete" type="button" onClick={() => delBookmark(b.id)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-300">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default RunPanel;

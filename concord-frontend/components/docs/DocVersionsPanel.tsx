'use client';

import { useState, useEffect, useCallback } from 'react';
import { callDocsMacro } from '@/lib/api/docs';
import { Clock, RotateCcw, Loader2 } from 'lucide-react';

interface Version {
  id: number;
  author_id: string;
  label?: string | null;
  reason: string;
  word_count: number;
  created_at: number;
}

interface Props { documentId: string; onRestore: () => void; }

export function DocVersionsPanel({ documentId, onRestore }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callDocsMacro<{ versions?: Version[] }>('versions', { id: documentId, limit: 100 });
      setVersions(r?.versions || []);
    } catch (e) { console.error('versions', e); }
    finally { setLoading(false); }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  const restore = useCallback(async (versionId: number) => {
    if (!confirm('Restore this version? A pre-restore snapshot will be created first.')) return;
    setRestoring(versionId);
    try {
      await callDocsMacro('restore_version', { id: documentId, versionId });
      onRestore();
      load();
    } catch (e) { console.error('restore_version', e); }
    finally { setRestoring(null); }
  }, [documentId, onRestore, load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-white/40">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      {versions.length === 0 ? (
        <div className="text-center text-white/40 text-sm py-8">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No versions yet. Snapshots are created automatically as you edit.
        </div>
      ) : (
        versions.map((v, idx) => (
          <div
            key={v.id}
            className="group p-2 rounded hover:bg-white/5 border border-transparent hover:border-white/10"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white/90 truncate">
                  {v.label || `${v.reason} snapshot`}
                </div>
                <div className="text-xs text-white/40 mt-0.5">
                  {new Date(v.created_at * 1000).toLocaleString()} · {v.word_count} words
                  {idx === 0 && <span className="ml-2 text-cyan-400">current</span>}
                </div>
              </div>
              {idx > 0 && (
                <button
                  onClick={() => restore(v.id)}
                  disabled={restoring === v.id}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-cyan-500/20 text-cyan-300"
                  title="Restore this version"
                >
                  {restoring === v.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RotateCcw className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

'use client';

// Projects (S11): a "project" in this lens is one of YOUR workspace
// connections with its datasets — the tab previously rendered a GitHub
// topic search borrowed from the Repos lens (star-sorted strangers'
// repositories), which had nothing to do with the user's databases.
import { useEffect, useState } from 'react';
import { FolderGit2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useWorkspaceTables } from './use-workspace-tables';
import { formatBytes } from './db-utils';

interface ConnLite { id: string; name: string; engine: string; readOnly: boolean }

export function ProjectsPanel() {
  const { tables } = useWorkspaceTables();
  const [conns, setConns] = useState<ConnLite[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await lensRun<{ connections: ConnLite[] }>('database', 'connection-list', {});
      if (live && r.data.ok && r.data.result) setConns(r.data.result.connections);
    })();
    return () => { live = false; };
  }, []);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <FolderGit2 className="w-4 h-4 text-neon-cyan" /> Your Projects
      </h3>
      {conns.length === 0 ? (
        <p className="text-xs text-gray-400">
          No projects yet. A project is a workspace connection and the datasets inside it — create one in the Live Client and it will appear here.
        </p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {conns.map((c) => {
            const mine = tables.filter((t) => t.connectionId === c.id);
            const rows = mine.reduce((n, t) => n + t.rowCount, 0);
            const bytes = mine.reduce((n, t) => n + (t.sizeBytes || 0), 0);
            return (
              <div key={c.id} className="bg-lattice-surface border border-lattice-border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-100">{c.name}</span>
                  <span className="text-[10px] text-gray-500">{c.engine}</span>
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${c.readOnly ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                    {c.readOnly ? 'read-only' : 'writable'}
                  </span>
                </div>
                {mine.length === 0 ? (
                  <p className="text-[11px] text-gray-500">No datasets in this project yet.</p>
                ) : (
                  <div className="space-y-1">
                    {mine.map((t) => (
                      <p key={t.datasetId} className="text-[11px] text-gray-300 flex items-center gap-2">
                        <span className="font-mono font-medium">{t.name}</span>
                        <span className="text-gray-500">{t.columns.length} columns · {t.rowCount} rows · {formatBytes(t.sizeBytes || 0)}</span>
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-gray-500 mt-2">{mine.length} dataset(s) · {rows} row(s) total</p>
                {bytes > 0 && <p className="text-[10px] text-gray-600">{formatBytes(bytes)} of row data</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

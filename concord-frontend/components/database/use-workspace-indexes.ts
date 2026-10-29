'use client';

/**
 * useWorkspaceIndexes — real index objects from the workspace store
 * (S8): per-connection indexes created over dataset columns, listed
 * across every connection, deletable. Sizes are the server's measured
 * key payloads.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface WsIndex {
  id: string;
  name: string;
  dataset: string;
  columns: string[];
  unique: boolean;
  type: string;
  sizeBytes: number;
  connectionId: string;
  connectionName: string;
}

export interface WsTableOption {
  connectionId: string;
  connectionName: string;
  dataset: string;
  columns: string[];
}

export function useWorkspaceIndexes() {
  const [indexes, setIndexes] = useState<WsIndex[]>([]);
  const [tables, setTables] = useState<WsTableOption[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const cr = await lensRun<{ connections: { id: string; name: string }[] }>('database', 'connection-list', {});
    const conns = cr.data.ok && cr.data.result ? cr.data.result.connections : [];
    const allIdx: WsIndex[] = [];
    const allTables: WsTableOption[] = [];
    for (const c of conns) {
      const dr = await lensRun<{
        datasets: { name: string; columns: { name: string }[] }[];
        indexes?: Omit<WsIndex, 'connectionId' | 'connectionName'>[];
      }>('database', 'dataset-list', { connectionId: c.id });
      if (!dr.data.ok || !dr.data.result) continue;
      for (const d of dr.data.result.datasets) {
        allTables.push({ connectionId: c.id, connectionName: c.name, dataset: d.name, columns: d.columns.map((x) => x.name) });
      }
      for (const x of dr.data.result.indexes || []) {
        allIdx.push({ ...x, connectionId: c.id, connectionName: c.name });
      }
    }
    setIndexes(allIdx);
    setTables(allTables);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const createIndex = useCallback(async (connectionId: string, dataset: string, column: string) => {
    setBusy(true);
    const r = await lensRun('database', 'index-create', { connectionId, dataset, column });
    setBusy(false);
    if (r.data.ok) await reload();
    return r;
  }, [reload]);

  const deleteIndex = useCallback(async (connectionId: string, indexId: string) => {
    setBusy(true);
    const r = await lensRun('database', 'index-delete', { connectionId, indexId });
    setBusy(false);
    if (r.data.ok) await reload();
    return r;
  }, [reload]);

  return { indexes, tables, createIndex, deleteIndex, busy, reload };
}

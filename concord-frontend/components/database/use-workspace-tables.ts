'use client';

/**
 * useWorkspaceTables — the Database lens's one store (S6/F8).
 *
 * Table Browser, Schema Map and Indexes previously read a generic
 * lens-data bucket that nothing in the lens ever wrote, so they showed
 * zeros while data existed. Every panel now reads the same workspace
 * store the Live Client writes: connection-list → dataset-list per
 * connection, mapped to the shared TableInfo shape. Foreign keys come
 * from the connection's real relations (S4); sizes are the server's
 * measured row payload, not estimates.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { TableInfo } from './db-utils';

interface WsDataset {
  id: string;
  name: string;
  columns: { name: string; type: string; pk?: boolean }[];
  rowCount: number;
  sizeBytes: number;
}
interface WsRelation { fromDataset: string; fromColumn: string; toDataset: string; toColumn: string }

export interface WorkspaceTable extends TableInfo {
  connectionId: string;
  datasetId: string;
}

export function useWorkspaceTables() {
  const [tables, setTables] = useState<WorkspaceTable[]>([]);
  const [connectionCount, setConnectionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const cr = await lensRun<{ connections: { id: string; name: string }[] }>('database', 'connection-list', {});
    const conns = cr.data.ok && cr.data.result ? cr.data.result.connections : [];
    setConnectionCount(conns.length);
    const all: WorkspaceTable[] = [];
    for (const c of conns) {
      const dr = await lensRun<{ datasets: WsDataset[]; relations?: WsRelation[] }>('database', 'dataset-list', { connectionId: c.id });
      if (!dr.data.ok || !dr.data.result) continue;
      const rels = dr.data.result.relations || [];
      for (const d of dr.data.result.datasets) {
        all.push({
          name: d.name,
          schema: c.name,
          rowCount: d.rowCount,
          sizeBytes: d.sizeBytes || 0,
          connectionId: c.id,
          datasetId: d.id,
          columns: d.columns.map((col) => {
            const rel = rels.find((r) => r.fromDataset === d.name && r.fromColumn === col.name);
            return {
              name: col.name,
              type: col.type,
              nullable: true,
              defaultValue: null,
              isPrimary: col.pk === true,
              isForeign: !!rel,
              ...(rel ? { references: { table: rel.toDataset, column: rel.toColumn } } : {}),
            };
          }),
        });
      }
    }
    setTables(all);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { tables, connectionCount, loading, reload };
}

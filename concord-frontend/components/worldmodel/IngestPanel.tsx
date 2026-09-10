'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import {
  type WmEntity, type WmIngestEvent,
  btn, card, input, invalidateWorldModel, wmRun, WM_QUERY_KEYS,
} from '@/components/worldmodel/wm-shared';

// ─── Ingest tab ─────────────────────────────────────────────────────────
export function IngestPanel() {
  const qc = useQueryClient();
  const entitiesQ = useQuery({
    queryKey: WM_QUERY_KEYS.entities,
    queryFn: () => wmRun<{ entities: WmEntity[] }>('wm_list_entities'),
  });
  const entities = entitiesQ.data?.entities ?? [];
  const onIngested = () => invalidateWorldModel(qc);
    const [entityId, setEntityId] = useState('');
  const [attribute, setAttribute] = useState('value');
  const [mode, setMode] = useState<'set' | 'increment'>('set');
  const [value, setValue] = useState('0');
  const [source, setSource] = useState('manual');

  const log = useQuery({
    queryKey: WM_QUERY_KEYS.ingestLog,
    queryFn: () => wmRun<{ events: WmIngestEvent[] }>('ingest_log', { limit: 50 }),
  });
  const ingest = useMutation({
    mutationFn: () => wmRun('ingest', { entityId, attribute, mode, value: Number(value) || 0, source }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: WM_QUERY_KEYS.ingestLog }); onIngested(); },
  });

  const events = log.data?.events ?? [];

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Ingest an observation</h3>
        {entities.length === 0 ? (
          <p className="text-xs text-emerald-700">Create entities before ingesting data.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select className={input} aria-label="Target entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">entity…</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input className={`${input} w-28`} placeholder="attribute" aria-label="Attribute"
              value={attribute} onChange={(e) => setAttribute(e.target.value)} />
            <select className={input} aria-label="Ingest mode" value={mode} onChange={(e) => setMode(e.target.value as 'set' | 'increment')}>
              <option value="set">set</option>
              <option value="increment">increment</option>
            </select>
            <input className={`${input} w-24`} type="number" placeholder="value" aria-label="Value"
              value={value} onChange={(e) => setValue(e.target.value)} />
            <input className={`${input} w-28`} placeholder="source" aria-label="Source"
              value={source} onChange={(e) => setSource(e.target.value)} />
            <button className={btn} disabled={!entityId || ingest.isPending} onClick={() => ingest.mutate()}>
              {ingest.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Ingest
            </button>
          </div>
        )}
        {ingest.isError && <p className="mt-2 text-xs text-rose-400">{(ingest.error as Error).message}</p>}
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Ingestion log</h3>
        {events.length === 0 ? (
          <p className="text-xs text-emerald-700">No ingestion events yet.</p>
        ) : (
          <ul className="space-y-1">
            {events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-3 rounded border border-emerald-900/30 bg-black/30 px-3 py-2 text-xs">
                <Upload className="h-3 w-3 text-emerald-500" aria-hidden />
                <span className="text-emerald-100">{ev.entityName}</span>
                <span className="font-mono text-emerald-600">{ev.attribute}</span>
                <span className="rounded bg-emerald-800/30 px-1.5 py-0.5 text-[10px]">{ev.mode}</span>
                <span className="font-mono text-emerald-400">{ev.from} → {ev.to}</span>
                <span className="text-emerald-700">via {ev.source}</span>
                <span className="ml-auto text-[10px] text-emerald-800">{new Date(ev.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}


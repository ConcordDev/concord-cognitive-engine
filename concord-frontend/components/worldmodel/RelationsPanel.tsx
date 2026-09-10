'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitFork, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import {
  type WmEntity, type WmRelation,
  btn, btnGhost, card, input, invalidateWorldModel, wmRun, WM_QUERY_KEYS,
} from '@/components/worldmodel/wm-shared';

// ─── Relations tab ──────────────────────────────────────────────────────
export function RelationsPanel() {
  const qc = useQueryClient();
  const entitiesQ = useQuery({
    queryKey: WM_QUERY_KEYS.entities,
    queryFn: () => wmRun<{ entities: WmEntity[] }>('wm_list_entities'),
  });
  const relationsQ = useQuery({
    queryKey: WM_QUERY_KEYS.relations,
    queryFn: () => wmRun<{ relations: WmRelation[] }>('wm_list_relations'),
  });
  const entities = entitiesQ.data?.entities ?? [];
  const relations = relationsQ.data?.relations ?? [];
  const loading = relationsQ.isLoading;
  const entityName = (id: string) => entities.find((e) => e.id === id)?.name ?? id;
  const onChanged = () => invalidateWorldModel(qc);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('relates_to');
  const [weight, setWeight] = useState(0.5);
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => wmRun('create_relation_typed', { from, to, type, weight }),
    onSuccess: () => { setErr(null); onChanged(); },
    onError: (e) => setErr((e as Error).message),
  });
  const update = useMutation({
    mutationFn: (p: { id: string; type: string; weight: number }) => wmRun('update_relation', p),
    onSuccess: onChanged,
  });
  const del = useMutation({
    mutationFn: (id: string) => wmRun('delete_relation', { id }),
    onSuccess: onChanged,
  });

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Create relation</h3>
        {entities.length < 2 ? (
          <p className="text-xs text-emerald-700">Create at least two entities first.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select className={input} aria-label="From entity" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">from…</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input className={`${input} w-32`} placeholder="type" aria-label="Relation type"
              value={type} onChange={(e) => setType(e.target.value)} />
            <select className={input} aria-label="To entity" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">to…</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-emerald-600">
              weight {weight.toFixed(2)}
              <input type="range" min={0} max={1} step={0.05} value={weight}
                onChange={(e) => setWeight(Number(e.target.value))} aria-label="Relation weight" />
            </label>
            <button className={btn} disabled={!from || !to || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
            </button>
          </div>
        )}
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
      </div>

      {loading && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
      {!loading && relations.length === 0 && <p className="text-xs text-emerald-700">No relations yet.</p>}
      <ul className="space-y-1">
        {relations.map((r) => (
          <RelationRow key={r.id} relation={r} entityName={entityName}
            onUpdate={(p) => update.mutate(p)} onDelete={() => del.mutate(r.id)} />
        ))}
      </ul>
    </div>
  );
}

function RelationRow({
  relation, entityName, onUpdate, onDelete,
}: {
  relation: WmRelation; entityName: (id: string) => string;
  onUpdate: (p: { id: string; type: string; weight: number }) => void; onDelete: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [type, setType] = useState(relation.type);
  const [weight, setWeight] = useState(relation.weight ?? 0.5);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-emerald-900/30 bg-emerald-950/10 px-3 py-2 text-xs">
      <GitFork className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
      <span className="font-mono text-emerald-300">{entityName(relation.from)}</span>
      {edit ? (
        <input className={`${input} w-28`} aria-label="Relation type" value={type} onChange={(e) => setType(e.target.value)} />
      ) : (
        <span className="rounded bg-emerald-700/30 px-1.5 py-0.5 text-[10px]">{relation.type}</span>
      )}
      <span className="font-mono text-emerald-300">{entityName(relation.to)}</span>
      {edit ? (
        <label className="flex items-center gap-1 text-[10px] text-emerald-600">
          {weight.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={weight}
            onChange={(e) => setWeight(Number(e.target.value))} aria-label="Relation weight" />
        </label>
      ) : (
        <span className="text-emerald-600">w={relation.weight ?? 0.5}</span>
      )}
      {edit ? (
        <>
          <button className={`${btnGhost} ml-auto`} onClick={() => { onUpdate({ id: relation.id, type, weight }); setEdit(false); }}>
            <Save className="h-3 w-3" /> save
          </button>
          <button className={btnGhost} onClick={() => setEdit(false)}>cancel</button>
        </>
      ) : (
        <>
          <button aria-label="Edit" className={`${btnGhost} ml-auto`} onClick={() => setEdit(true)}><Pencil className="h-3 w-3" /></button>
          <button aria-label="Delete" className={btnGhost} onClick={onDelete}><Trash2 className="h-3 w-3" /></button>
        </>
      )}
    </li>
  );
}


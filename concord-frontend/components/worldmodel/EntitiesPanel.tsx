'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, FileSearch, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import type { DTU } from '@/lib/api/generated-types';
import {
  type WmEntity, type WmType, type WmTypeField,
  btn, btnGhost, card, input, invalidateWorldModel, wmRun, WM_QUERY_KEYS,
} from '@/components/worldmodel/wm-shared';

// ─── Entities tab ───────────────────────────────────────────────────────
export function EntitiesPanel() {
  const qc = useQueryClient();
  const entitiesQ = useQuery({
    queryKey: WM_QUERY_KEYS.entities,
    queryFn: () => wmRun<{ entities: WmEntity[] }>('wm_list_entities'),
  });
  const typesQ = useQuery({
    queryKey: WM_QUERY_KEYS.types,
    queryFn: () => wmRun<{ types: WmType[] }>('list_entity_types'),
  });
  const entities = entitiesQ.data?.entities ?? [];
  const types = typesQ.data?.types ?? [];
  const loading = entitiesQ.isLoading;
  const onChanged = () => invalidateWorldModel(qc);
  const [name, setName] = useState('');
  const [type, setType] = useState('concept');
  const [value, setValue] = useState('100');
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);

  // typed schema builder
  const [typeName, setTypeName] = useState('');
  const [typeFields, setTypeFields] = useState<WmTypeField[]>([{ key: 'value', kind: 'number', label: 'Value' }]);

  const create = useMutation({
    mutationFn: () => wmRun('wm_create_entity', {
      name, type, attributes: { value: Number(value) || 0 },
    }),
    onSuccess: () => { setName(''); setValue('100'); setErr(null); onChanged(); },
    onError: (e) => setErr((e as Error).message),
  });
  const extractFromDtu = useMutation({
    mutationFn: (dtu: DTU) => wmRun<{ entity: WmEntity; created: boolean; alreadyLinked: boolean }>('wm_extract_from_dtu', {
      dtuId: dtu.id, title: dtu.title, tags: dtu.tags, summary: dtu.summary,
    }),
    onSuccess: (r) => {
      setExtractNote(r.created ? `Grounded new entity "${r.entity.name}" in this DTU.` : r.alreadyLinked ? `Already grounded — refreshed "${r.entity.name}".` : `Linked this DTU as evidence for "${r.entity.name}".`);
      onChanged();
    },
    onError: (e) => setErr((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: string) => wmRun('wm_delete_entity', { id }),
    onSuccess: onChanged,
  });
  const defineType = useMutation({
    mutationFn: () => wmRun('define_entity_type', { name: typeName, fields: typeFields }),
    onSuccess: () => { setTypeName(''); onChanged(); },
  });
  const delType = useMutation({
    mutationFn: (n: string) => wmRun('delete_entity_type', { name: n }),
    onSuccess: onChanged,
  });

  const editEntity = entities.find((e) => e.id === editId) ?? null;

  return (
    <div className="space-y-5">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Create entity</h3>
        <div className="flex flex-wrap gap-2">
          <input className={`${input} flex-1 min-w-32`} placeholder="Entity name" aria-label="Entity name"
            value={name} onChange={(e) => setName(e.target.value)} />
          <select className={input} aria-label="Entity type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="concept">concept</option>
            {types.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          <input className={`${input} w-28`} type="number" placeholder="value" aria-label="Initial value"
            value={value} onChange={(e) => setValue(e.target.value)} />
          <button className={btn} disabled={!name || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
          </button>
          <button className={btnGhost} disabled={extractFromDtu.isPending} onClick={() => { setExtractNote(null); setPickerOpen(true); }}>
            {extractFromDtu.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSearch className="h-3 w-3" />} Extract from DTU
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-emerald-700">Entities carry a numeric <code>value</code> attribute that simulations propagate. &quot;Extract from DTU&quot; grounds a node in a real DTU from your archive instead of typing one by hand.</p>
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
        {extractNote && <p className="mt-2 text-xs text-emerald-400">{extractNote}</p>}
        {pickerOpen && (
          <DTUPickerModal
            lens="worldmodel"
            title="Extract entity from DTU"
            onClose={() => setPickerOpen(false)}
            onSelect={(dtu) => extractFromDtu.mutate(dtu)}
          />
        )}
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Typed entity schemas</h3>
        <div className="flex flex-wrap items-end gap-2">
          <input className={`${input} w-40`} placeholder="Type name" aria-label="New type name"
            value={typeName} onChange={(e) => setTypeName(e.target.value)} />
          <button className={btn} disabled={!typeName || defineType.isPending} onClick={() => defineType.mutate()}>
            <Save className="h-3 w-3" /> Define type
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          {typeFields.map((f, i) => (
            <div key={i} className="flex flex-wrap gap-1.5">
              <input className={`${input} w-32`} placeholder="field key" aria-label="Field key"
                value={f.key} onChange={(e) => setTypeFields((fs) => fs.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
              <select className={input} aria-label="Field kind" value={f.kind}
                onChange={(e) => setTypeFields((fs) => fs.map((x, j) => j === i ? { ...x, kind: e.target.value as WmTypeField['kind'] } : x))}>
                <option value="number">number</option>
                <option value="string">string</option>
                <option value="boolean">boolean</option>
              </select>
              <button aria-label="Delete" className={btnGhost} onClick={() => setTypeFields((fs) => fs.filter((_, j) => j !== i))}>
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button className={btnGhost} onClick={() => setTypeFields((fs) => [...fs, { key: '', kind: 'string' }])}>
            <Plus className="h-3 w-3" /> Add field
          </button>
        </div>
        {types.length > 0 && (
          <ul className="mt-3 space-y-1">
            {types.map((t) => (
              <li key={t.name} className="flex items-center gap-2 rounded border border-emerald-900/30 bg-black/30 px-2 py-1.5 text-xs">
                <span className="font-mono text-emerald-300">{t.name}</span>
                <span className="text-emerald-700">{t.fields.map((f) => `${f.key}:${f.kind}`).join(', ') || 'no fields'}</span>
                <button aria-label="Delete" className={`${btnGhost} ml-auto`} onClick={() => delType.mutate(t.name)}><Trash2 className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
      {!loading && entities.length === 0 && <p className="text-xs text-emerald-700">No entities yet — create one above.</p>}
      <ul className="space-y-1">
        {entities.map((e) => (
          <li key={e.id} className="rounded border border-emerald-900/30 bg-emerald-950/10">
            <div className="flex items-center gap-3 px-3 py-2 text-xs">
              <Boxes className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
              <span className="text-emerald-100">{e.name}</span>
              <span className="rounded bg-emerald-800/30 px-1.5 py-0.5 text-[10px] text-emerald-300">{e.type}</span>
              <span className="font-mono text-emerald-600">value={Number(e.attributes?.value ?? 0)}</span>
              {Array.isArray(e.attributes?.sourceDtuIds) && (e.attributes!.sourceDtuIds as string[]).length > 0 && (
                <span className="flex items-center gap-1 rounded bg-sky-900/30 px-1.5 py-0.5 text-[10px] text-sky-300" title="Grounded in real DTU evidence">
                  <FileSearch className="h-2.5 w-2.5" aria-hidden /> {(e.attributes!.sourceDtuIds as string[]).length} DTU{(e.attributes!.sourceDtuIds as string[]).length === 1 ? '' : 's'}
                </span>
              )}
              <button className={`${btnGhost} ml-auto`} onClick={() => setEditId(editId === e.id ? null : e.id)}>
                <Pencil className="h-3 w-3" /> attrs
              </button>
              <button aria-label="Delete" className={btnGhost} onClick={() => del.mutate(e.id)}><Trash2 className="h-3 w-3" /></button>
            </div>
            {editId === e.id && editEntity && (
              <AttrEditor entity={editEntity} types={types} onSaved={() => { setEditId(null); onChanged(); }} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttrEditor({ entity, types, onSaved }: { entity: WmEntity; types: WmType[]; onSaved: () => void }) {
  const schema = types.find((t) => t.name === entity.type);
  const initial: Record<string, string> = {};
  const fieldKeys = schema
    ? schema.fields.map((f) => f.key)
    : Object.keys(entity.attributes ?? { value: 0 });
  for (const k of fieldKeys) initial[k] = String((entity.attributes ?? {})[k] ?? '');
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [nm, setNm] = useState(entity.name);

  const save = useMutation({
    mutationFn: () => {
      const attributes: Record<string, unknown> = {};
      for (const k of fieldKeys) {
        const f = schema?.fields.find((x) => x.key === k);
        const raw = vals[k] ?? '';
        if (f?.kind === 'number') attributes[k] = Number(raw) || 0;
        else if (f?.kind === 'boolean') attributes[k] = raw === 'true';
        else attributes[k] = raw;
      }
      if (!schema) attributes.value = Number(vals.value) || 0;
      return wmRun('update_entity_attrs', { id: entity.id, name: nm, attributes });
    },
    onSuccess: onSaved,
  });

  return (
    <div className="border-t border-emerald-900/30 bg-black/30 p-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${input} w-44`} aria-label="Entity name" value={nm} onChange={(e) => setNm(e.target.value)} />
        {fieldKeys.map((k) => {
          const f = schema?.fields.find((x) => x.key === k);
          return (
            <label key={k} className="flex items-center gap-1 text-[11px] text-emerald-600">
              {k}
              {f?.kind === 'boolean' ? (
                <select className={input} aria-label={k} value={vals[k] ?? 'false'}
                  onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input className={`${input} w-24`} type={f?.kind === 'number' ? 'number' : 'text'} aria-label={k}
                  value={vals[k] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
              )}
            </label>
          );
        })}
        <button className={btn} disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
      </div>
      {schema && <p className="mt-1.5 text-[10px] text-emerald-700">Coerced against typed schema &quot;{schema.name}&quot;.</p>}
    </div>
  );
}


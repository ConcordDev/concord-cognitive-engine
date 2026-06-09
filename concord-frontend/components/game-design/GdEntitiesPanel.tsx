'use client';

/**
 * GdEntitiesPanel — the game's entity roster with combat stats,
 * LDtk-style typed custom fields, project enums, and a balance report.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Heart, Swords, Wind, ChevronDown, ChevronRight, BarChart3, Tag } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Field { key: string; type: string; value: string | number | boolean }
interface Entity {
  id: string; name: string; kind: string; health: number; damage: number;
  speed: number; description: string | null; fields?: Field[];
}
interface EnumDef { id: string; name: string; values: string[] }
interface Balance {
  entities: number;
  byKind: Record<string, { count: number; health: { min: number; max: number; avg: number } }>;
  combatHealth: { min: number; max: number; avg: number };
  combatDamage: { min: number; max: number; avg: number };
  outliers: string[]; difficultyBand: string; verdict: string;
}

const KINDS = ['player', 'enemy', 'boss', 'npc', 'item', 'prop'];
const FIELD_TYPES = ['int', 'float', 'string', 'bool', 'enum', 'color'];
const KIND_COLOR: Record<string, string> = {
  player: 'text-lime-400', enemy: 'text-rose-400', boss: 'text-red-500',
  npc: 'text-sky-400', item: 'text-amber-400', prop: 'text-zinc-400',
};

export function GdEntitiesPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [enums, setEnums] = useState<EnumDef[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'enemy', health: '', damage: '', speed: '', description: '' });
  const [enumForm, setEnumForm] = useState({ name: '', values: '' });
  const [showEnums, setShowEnums] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<Record<string, { key: string; type: string; value: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, en] = await Promise.all([
      lensRun('game-design', 'game-get', { id: gameId }),
      lensRun('game-design', 'enum-list', { gameId }),
    ]);
    setEntities(g.data?.result?.entities || []);
    setEnums(en.data?.result?.enums || []);
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadBalance = async () => {
    const r = await lensRun('game-design', 'balance-report', { gameId });
    setBalance((r.data?.result?.entities ? r.data.result : null) as Balance | null);
  };

  const addEntity = async () => {
    if (!form.name.trim()) { setError('Entity name is required.'); return; }
    const r = await lensRun('game-design', 'entity-add', {
      gameId, name: form.name.trim(), kind: form.kind,
      health: Number(form.health) || 0, damage: Number(form.damage) || 0, speed: Number(form.speed) || 0,
      description: form.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', kind: 'enemy', health: '', damage: '', speed: '', description: '' });
    setError(null);
    await refresh();
  };

  const delEntity = async (id: string) => {
    await lensRun('game-design', 'entity-delete', { id });
    await refresh();
  };

  const addEnum = async () => {
    if (!enumForm.name.trim()) return;
    await lensRun('game-design', 'enum-create', {
      gameId, name: enumForm.name.trim(),
      values: enumForm.values.split(',').map((v) => v.trim()).filter(Boolean),
    });
    setEnumForm({ name: '', values: '' });
    await refresh();
  };

  const delEnum = async (id: string) => {
    await lensRun('game-design', 'enum-delete', { id });
    await refresh();
  };

  const setField = async (entityId: string) => {
    const d = fieldDraft[entityId];
    if (!d?.key?.trim()) return;
    await lensRun('game-design', 'entity-field-set', {
      entityId, key: d.key.trim(), type: d.type, value: d.value,
    });
    setFieldDraft({ ...fieldDraft, [entityId]: { key: '', type: 'string', value: '' } });
    await refresh();
  };

  const delField = async (entityId: string, key: string) => {
    await lensRun('game-design', 'entity-field-delete', { entityId, key });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="HP" inputMode="numeric" value={form.health}
            onChange={(e) => setForm({ ...form, health: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="DMG" inputMode="numeric" value={form.damage}
            onChange={(e) => setForm({ ...form, damage: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="SPD" inputMode="numeric" value={form.speed}
            onChange={(e) => setForm({ ...form, speed: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addEntity}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Entity
          </button>
        </div>
      </section>

      {/* Enums */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl">
        <button type="button" onClick={() => setShowEnums(!showEnums)}
          className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-semibold text-zinc-300">
          {showEnums ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Tag className="w-3.5 h-3.5 text-lime-400" /> Enums ({enums.length})
        </button>
        {showEnums && (
          <div className="px-3 pb-3 space-y-2">
            <div className="flex items-center gap-2">
              <input placeholder="Enum name (e.g. ItemType)" value={enumForm.name}
                onChange={(e) => setEnumForm({ ...enumForm, name: e.target.value })}
                className="w-40 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
              <input placeholder="values, comma, separated" value={enumForm.values}
                onChange={(e) => setEnumForm({ ...enumForm, values: e.target.value })}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
              <button type="button" onClick={addEnum}
                className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">+ Enum</button>
            </div>
            {enums.map((e) => (
              <div key={e.id} className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-[11px]">
                <span className="font-semibold text-zinc-200">{e.name}</span>
                <span className="flex-1 text-zinc-400">{e.values.join(' · ')}</span>
                <button aria-label="Delete" type="button" onClick={() => delEnum(e.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Balance report */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <BarChart3 className="w-3.5 h-3.5 text-lime-400" /> Balance report
          </h3>
          <button type="button" onClick={loadBalance}
            className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Run</button>
        </div>
        {balance && (
          <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
            <p>Combat HP — min {balance.combatHealth.min} · avg {balance.combatHealth.avg} · max {balance.combatHealth.max}</p>
            <p>Combat DMG — min {balance.combatDamage.min} · avg {balance.combatDamage.avg} · max {balance.combatDamage.max}</p>
            <p>Difficulty band: <span className="text-zinc-200">{balance.difficultyBand}</span></p>
            <p className={balance.outliers.length === 0 ? 'text-emerald-400' : 'text-amber-400'}>
              {balance.verdict}{balance.outliers.length > 0 && ` — ${balance.outliers.join(', ')}`}
            </p>
          </div>
        )}
      </section>

      {entities.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No entities yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {entities.map((e) => {
            const isOpen = expanded === e.id;
            const d = fieldDraft[e.id] || { key: '', type: 'string', value: '' };
            return (
              <li key={e.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setExpanded(isOpen ? null : e.id)} className="text-zinc-400 hover:text-zinc-300">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                  <span className="text-sm font-semibold text-zinc-100">{e.name}</span>
                  <span className={cn('text-[10px] uppercase', KIND_COLOR[e.kind])}>{e.kind}</span>
                  {e.fields && e.fields.length > 0 && (
                    <span className="text-[9px] text-lime-400/70">{e.fields.length} field{e.fields.length === 1 ? '' : 's'}</span>
                  )}
                  <div className="flex-1" />
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400"><Heart className="w-3 h-3 text-rose-400" />{e.health}</span>
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400"><Swords className="w-3 h-3 text-amber-400" />{e.damage}</span>
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400"><Wind className="w-3 h-3 text-sky-400" />{e.speed}</span>
                  <button aria-label="Delete" type="button" onClick={() => delEntity(e.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {e.description && <p className="text-[11px] text-zinc-400 mt-1">{e.description}</p>}

                {isOpen && (
                  <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1.5">
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase">Custom fields</p>
                    {(e.fields || []).map((f) => (
                      <div key={f.key} className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2 py-1 text-[11px]">
                        <span className="font-medium text-zinc-200">{f.key}</span>
                        <span className="text-[9px] text-zinc-400 uppercase">{f.type}</span>
                        <span className="flex-1 text-zinc-400 truncate">{String(f.value)}</span>
                        <button aria-label="Delete" type="button" onClick={() => delField(e.id, f.key)} className="text-zinc-600 hover:text-rose-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5">
                      <input placeholder="key" value={d.key}
                        onChange={(ev) => setFieldDraft({ ...fieldDraft, [e.id]: { ...d, key: ev.target.value } })}
                        className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                      <select value={d.type}
                        onChange={(ev) => setFieldDraft({ ...fieldDraft, [e.id]: { ...d, type: ev.target.value } })}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-1.5 py-1 text-[11px] text-zinc-100">
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      {d.type === 'bool' ? (
                        <select value={d.value}
                          onChange={(ev) => setFieldDraft({ ...fieldDraft, [e.id]: { ...d, value: ev.target.value } })}
                          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : d.type === 'enum' ? (
                        <select value={d.value}
                          onChange={(ev) => setFieldDraft({ ...fieldDraft, [e.id]: { ...d, value: ev.target.value } })}
                          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
                          <option value="">— value —</option>
                          {enums.flatMap((en) => en.values).map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : d.type === 'color' ? (
                        <input type="color" value={d.value || '#94a3b8'}
                          onChange={(ev) => setFieldDraft({ ...fieldDraft, [e.id]: { ...d, value: ev.target.value } })}
                          className="w-10 h-7 bg-zinc-950 border border-zinc-700 rounded" />
                      ) : (
                        <input placeholder="value" value={d.value}
                          inputMode={d.type === 'int' || d.type === 'float' ? 'numeric' : 'text'}
                          onChange={(ev) => setFieldDraft({ ...fieldDraft, [e.id]: { ...d, value: ev.target.value } })}
                          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                      )}
                      <button type="button" onClick={() => setField(e.id)}
                        className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Set</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

'use client';

/**
 * GdBehaviorPanel — visual scripting for entity behavior. A behavior is
 * a GDevelop / Construct shape "event sheet": an ordered list of
 * trigger -> action rules. The runtime walks these rules deterministically.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Zap, ArrowRight, Power } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Rule {
  id: string; trigger: string; action: string;
  triggerParam: string | null; params: Record<string, unknown>; enabled: boolean;
}
interface Behavior { id: string; name: string; entityId: string | null; rules: Rule[] }
interface EntityLite { id: string; name: string; kind: string }

const TRIGGER_LABEL: Record<string, string> = {
  'on-spawn': 'When spawned', 'on-tick': 'Every frame', 'on-collide': 'On collision',
  'on-key': 'On key press', 'on-timer': 'On timer', 'on-damage': 'When damaged',
  'on-death': 'When destroyed', 'on-trigger-zone': 'Enter trigger zone',
};
const ACTION_LABEL: Record<string, string> = {
  move: 'Move', jump: 'Jump', 'set-velocity': 'Set velocity', 'spawn-entity': 'Spawn entity',
  'destroy-self': 'Destroy self', 'apply-damage': 'Apply damage', 'set-variable': 'Set variable',
  'play-animation': 'Play animation', 'emit-event': 'Emit event', wait: 'Wait',
};

export function GdBehaviorPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [entities, setEntities] = useState<EntityLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', entityId: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState({ trigger: 'on-tick', action: 'move', triggerParam: '', value: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, g] = await Promise.all([
      lensRun('game-design', 'behavior-list', { gameId }),
      lensRun('game-design', 'game-get', { id: gameId }),
    ]);
    setBehaviors(b.data?.result?.behaviors || []);
    setTriggers(b.data?.result?.triggers || []);
    setActions(b.data?.result?.actions || []);
    setEntities(g.data?.result?.entities || []);
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const active = behaviors.find((b) => b.id === selected) || null;

  const createBehavior = async () => {
    if (!form.name.trim()) { setError('Behavior name is required.'); return; }
    const r = await lensRun('game-design', 'behavior-create', {
      gameId, name: form.name.trim(), entityId: form.entityId || null,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', entityId: '' });
    setError(null);
    await refresh();
    setSelected(r.data?.result?.behavior?.id || null);
  };

  const delBehavior = async (id: string) => {
    await lensRun('game-design', 'behavior-delete', { id });
    if (selected === id) setSelected(null);
    await refresh();
  };

  const bindEntity = async (id: string, entityId: string) => {
    await lensRun('game-design', 'behavior-update', { id, entityId: entityId || null });
    await refresh();
  };

  const addRule = async () => {
    if (!active) return;
    const params: Record<string, unknown> = {};
    if (ruleDraft.value.trim()) params.value = ruleDraft.value.trim();
    const r = await lensRun('game-design', 'behavior-rule-add', {
      behaviorId: active.id, trigger: ruleDraft.trigger, action: ruleDraft.action,
      triggerParam: ruleDraft.triggerParam.trim() || null, params,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRuleDraft({ trigger: 'on-tick', action: 'move', triggerParam: '', value: '' });
    setError(null);
    await refresh();
  };

  const delRule = async (ruleId: string) => {
    if (!active) return;
    await lensRun('game-design', 'behavior-rule-delete', { behaviorId: active.id, ruleId });
    await refresh();
  };

  const toggleRule = async (rule: Rule) => {
    if (!active) return;
    await lensRun('game-design', 'behavior-rule-update', { behaviorId: active.id, ruleId: rule.id, enabled: !rule.enabled });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const entName = (id: string | null) => (id ? entities.find((e) => e.id === id)?.name || 'unknown' : null);

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
        <input placeholder="Behavior name (e.g. Patrol AI)" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">No entity</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button type="button" onClick={createBehavior}
          className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Behavior
        </button>
      </section>

      {behaviors.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No entity behaviors yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {behaviors.map((b) => (
            <span key={b.id} className={cn('flex items-center gap-1.5 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
              selected === b.id ? 'bg-lime-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
              <button type="button" onClick={() => setSelected(b.id)} className="flex items-center gap-1">
                <Zap className="w-3 h-3" /> {b.name} <span className="opacity-60">({b.rules.length})</span>
              </button>
              <button type="button" onClick={() => delBehavior(b.id)} className="text-zinc-300/70 hover:text-rose-200">×</button>
            </span>
          ))}
        </div>
      )}

      {active && (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">{active.name}</span>
            <span className="text-[11px] text-zinc-400">bound to</span>
            <select value={active.entityId || ''} onChange={(e) => bindEntity(active.id, e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
              <option value="">no entity</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {entName(active.entityId) && <span className="text-[10px] text-lime-400">{entName(active.entityId)}</span>}
          </div>

          {/* Event sheet */}
          {active.rules.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic py-3 text-center">No rules — add a trigger -&gt; action below.</p>
          ) : (
            <ul className="space-y-1.5">
              {active.rules.map((r) => (
                <li key={r.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
                  r.enabled ? 'border-zinc-800 bg-zinc-950/60' : 'border-zinc-800/50 bg-zinc-950/30 opacity-55')}>
                  <button type="button" onClick={() => toggleRule(r)}
                    className={cn('shrink-0', r.enabled ? 'text-lime-400' : 'text-zinc-600')} aria-label="Toggle rule">
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-1.5 py-0.5 rounded bg-sky-950/50 text-sky-300">
                    {TRIGGER_LABEL[r.trigger] || r.trigger}{r.triggerParam ? ` [${r.triggerParam}]` : ''}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-300">
                    {ACTION_LABEL[r.action] || r.action}
                  </span>
                  {typeof r.params?.value === 'string' && r.params.value && (
                    <span className="text-zinc-400 font-mono">= {r.params.value}</span>
                  )}
                  <div className="flex-1" />
                  <button aria-label="Delete" type="button" onClick={() => delRule(r.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* New rule */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
            <select value={ruleDraft.trigger} onChange={(e) => setRuleDraft({ ...ruleDraft, trigger: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
              {triggers.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t] || t}</option>)}
            </select>
            <input placeholder="trigger param" value={ruleDraft.triggerParam}
              onChange={(e) => setRuleDraft({ ...ruleDraft, triggerParam: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
            <select value={ruleDraft.action} onChange={(e) => setRuleDraft({ ...ruleDraft, action: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
              {actions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a] || a}</option>)}
            </select>
            <input placeholder="action value" value={ruleDraft.value}
              onChange={(e) => setRuleDraft({ ...ruleDraft, value: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
            <button type="button" onClick={addRule}
              className="flex items-center justify-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] rounded-lg">
              <Plus className="w-3.5 h-3.5" /> Rule
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

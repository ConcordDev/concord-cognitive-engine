'use client';

// v2.0: three-tab create flow for personal recipe DTUs.
// Each authored recipe defaults to scope='personal' (server-enforced via
// the personal_dtus_never_leak sovereignty invariant). Users can later
// publish via POST /api/personal-locker/dtus/:id/list-on-marketplace.

import { useState } from 'react';
import { api } from '@/lib/api/client';

type RecipeKind = 'fighting_style_recipe' | 'spell_recipe' | 'blueprint';

const TAB_DEFS: Array<{ kind: RecipeKind; label: string; hint: string }> = [
  { kind: 'fighting_style_recipe', label: 'Fighting Style', hint: 'Sequence of combos with a stance.' },
  { kind: 'spell_recipe',          label: 'Spell',          hint: 'Formula + costs + range + target type.' },
  { kind: 'blueprint',             label: 'Blueprint',      hint: 'Building / vehicle / weapon plan with materials.' },
];

const CONTROL_SCHEMES = ['bare_hands', 'boxer', 'karate', 'firearm_pistol', 'firearm_rifle', 'blade', 'magic_channel', 'stealth'] as const;
const TARGET_TYPES   = ['single', 'aoe', 'self'] as const;
const RANGES         = ['melee', 'close', 'mid', 'long'] as const;
const BLUEPRINT_KINDS = ['building', 'vehicle', 'weapon'] as const;

interface Props {
  onPublished?: (dtuId: string) => void;
  onClose?: () => void;
}

export default function RecipeAuthorPanel({ onPublished, onClose }: Props) {
  const [tab, setTab] = useState<RecipeKind>('fighting_style_recipe');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);

  // Fighting style state
  const [moves, setMoves] = useState<string>('combo_1, combo_2');
  const [stance, setStance] = useState<string>('boxer');
  const [controlScheme, setControlScheme] = useState<typeof CONTROL_SCHEMES[number]>('boxer');

  // Spell state
  const [formula, setFormula] = useState<string>('fire+arcane');
  const [mana, setMana] = useState<number>(30);
  const [stamina, setStamina] = useState<number>(0);
  const [ap, setAp] = useState<number>(0);
  const [range, setRange] = useState<typeof RANGES[number]>('mid');
  const [targetType, setTargetType] = useState<typeof TARGET_TYPES[number]>('single');

  // Blueprint state
  const [bpKind, setBpKind] = useState<typeof BLUEPRINT_KINDS[number]>('building');
  const [bpDim, setBpDim] = useState<{ x: number; y: number; z: number }>({ x: 4, y: 3, z: 4 });
  const [bpMaterials, setBpMaterials] = useState<string>('wood:50, iron:10');

  function buildMeta(): Record<string, unknown> {
    if (tab === 'fighting_style_recipe') {
      return {
        type: 'fighting_style_recipe',
        moves: moves.split(',').map(s => s.trim()).filter(Boolean).map(comboId => ({ comboId })),
        stance: stance.trim(),
        controlScheme,
      };
    }
    if (tab === 'spell_recipe') {
      const costs: Record<string, number> = {};
      if (mana > 0) costs.mana = mana;
      if (stamina > 0) costs.stamina = stamina;
      if (ap > 0) costs.ap = ap;
      return {
        type: 'spell_recipe',
        formula: formula.trim(),
        costs,
        range,
        targetType,
      };
    }
    // blueprint
    const materials = bpMaterials.split(',').map((s) => {
      const [resource, qtyStr] = s.split(':').map(t => t.trim());
      const qty = Number(qtyStr);
      return { resource, qty };
    }).filter(m => m.resource && Number.isFinite(m.qty) && m.qty > 0);
    return {
      type: 'blueprint',
      kind: bpKind,
      dimensions: bpDim,
      materials,
    };
  }

  async function handleSubmit() {
    setError(null);
    if (!title.trim()) { setError('Title required'); return; }
    setSubmitting(true);
    try {
      const meta = buildMeta();
      const body = {
        title: title.trim(),
        content: `Personal ${tab.replace(/_/g, ' ')}`,
        tags: [tab, 'concordia'],
        scope: 'personal',
        meta,
      };
      const res = await api.post('/api/dtus', body);
      const dtuId = res.data?.dtu?.id || res.data?.id;
      if (!dtuId) {
        setError('Created but no DTU id returned');
        return;
      }
      setLastCreatedId(dtuId);
      onPublished?.(dtuId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Create failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-black/85 border border-amber-500/30 rounded-2xl p-5 max-w-xl w-full text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Author Personal Recipe</h2>
        {onClose && (
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white">close</button>
        )}
      </div>

      <div className="flex gap-2 mb-4 border-b border-white/10 pb-3">
        {TAB_DEFS.map(t => (
          <button
            key={t.kind}
            onClick={() => setTab(t.kind)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              tab === t.kind ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/5 hover:bg-white/10 text-white/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-white/50 mb-4">{TAB_DEFS.find(t => t.kind === tab)?.hint}</p>

      <label className="block text-xs text-white/70 mb-1">Title</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Iron Stance Combo"
        className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm mb-4 outline-none focus:border-amber-500/40"
      />

      {tab === 'fighting_style_recipe' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/70 mb-1">Moves (comma-separated combo IDs)</label>
            <input
              value={moves}
              onChange={(e) => setMoves(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-amber-500/40"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/70 mb-1">Stance</label>
              <input
                value={stance}
                onChange={(e) => setStance(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white/70 mb-1">Control scheme</label>
              <select
                value={controlScheme}
                onChange={(e) => setControlScheme(e.target.value as typeof CONTROL_SCHEMES[number])}
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
              >
                {CONTROL_SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {tab === 'spell_recipe' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/70 mb-1">Formula</label>
            <input
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-white/70 mb-1">Mana</label>
              <input type="number" min={0} value={mana} onChange={(e) => setMana(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-white/70 mb-1">Stamina</label>
              <input type="number" min={0} value={stamina} onChange={(e) => setStamina(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-white/70 mb-1">AP</label>
              <input type="number" min={0} value={ap} onChange={(e) => setAp(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/70 mb-1">Range</label>
              <select value={range} onChange={(e) => setRange(e.target.value as typeof RANGES[number])} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm">
                {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/70 mb-1">Target</label>
              <select value={targetType} onChange={(e) => setTargetType(e.target.value as typeof TARGET_TYPES[number])} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm">
                {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {tab === 'blueprint' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/70 mb-1">Kind</label>
              <select value={bpKind} onChange={(e) => setBpKind(e.target.value as typeof BLUEPRINT_KINDS[number])} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm">
                {BLUEPRINT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/70 mb-1">Dimensions (x,y,z)</label>
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    min={0.1}
                    step={0.5}
                    value={bpDim[axis]}
                    onChange={(e) => setBpDim((d) => ({ ...d, [axis]: Number(e.target.value) }))}
                    className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-2 text-xs"
                    aria-label={`dimension ${axis}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/70 mb-1">Materials (resource:qty, comma)</label>
            <input
              value={bpMaterials}
              onChange={(e) => setBpMaterials(e.target.value)}
              placeholder="wood:50, iron:10"
              className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {error && <div className="text-xs text-red-400 mt-3">{error}</div>}
      {lastCreatedId && <div className="text-xs text-emerald-400 mt-3">Created — id: {lastCreatedId}</div>}

      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-white/10">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-4 py-2 bg-amber-500/20 border border-amber-500/40 rounded-md text-sm font-semibold disabled:opacity-50 hover:bg-amber-500/30"
        >
          {submitting ? 'Saving…' : 'Save personal recipe'}
        </button>
      </div>
      <p className="text-[11px] text-white/40 mt-2">
        Saved as scope=&apos;personal&apos; — only you see it. Publish from the personal locker.
      </p>
    </div>
  );
}

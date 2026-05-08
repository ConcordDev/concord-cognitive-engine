'use client';

// v2.0: three-tab create flow for personal recipe DTUs.
// Each authored recipe defaults to scope='personal' (server-enforced via
// the personal_dtus_never_leak sovereignty invariant). Users can publish
// via POST /api/personal-locker/dtus/:id/list-on-marketplace; the inline
// flow below offers it as a one-click follow-up to creation so the
// author → save → list → earn loop closes in one panel.

import { useState } from 'react';
import { api } from '@/lib/api/client';

type RecipeKind = 'fighting_style_recipe' | 'spell_recipe' | 'blueprint';

const TAB_DEFS: Array<{ kind: RecipeKind; label: string; hint: string }> = [
  { kind: 'fighting_style_recipe', label: 'Fighting Style', hint: 'Combos + stance + frame data + element coupling.' },
  { kind: 'spell_recipe',          label: 'Spell',          hint: 'Formula + costs + range + target + element + status.' },
  { kind: 'blueprint',             label: 'Blueprint',      hint: 'Plan with dimensions, materials, and structural stress profile.' },
];

const CONTROL_SCHEMES = ['bare_hands', 'boxer', 'karate', 'firearm_pistol', 'firearm_rifle', 'blade', 'magic_channel', 'stealth'] as const;
const TARGET_TYPES   = ['single', 'aoe', 'self'] as const;
const RANGES         = ['melee', 'close', 'mid', 'long'] as const;
const BLUEPRINT_KINDS = ['building', 'vehicle', 'weapon'] as const;

// Element list mirrors the embodied-skill-environment coupling table —
// fire/ice/lightning/water/bio/poison/energy/physical/arcane. Recipes
// that declare an element get the env-coupling potency multiplier
// (`elementalEnvBoost` in server/lib/embodied/skill-environment.js).
const ELEMENTS = ['none', 'fire', 'ice', 'lightning', 'water', 'bio', 'poison', 'energy', 'physical', 'arcane'] as const;
type Element = typeof ELEMENTS[number];

const STATUS_EFFECTS = ['burn', 'freeze', 'shock', 'wet', 'poison', 'bleed', 'stun', 'silence', 'slow', 'haste'] as const;
type StatusEffect = typeof STATUS_EFFECTS[number];

// Material-toughness-aware stress profile for the Geo-Mod-light system
// (server/lib/embodied/skill-environment.js#applyStructuralStress).
const STRESS_PROFILES = ['light', 'standard', 'reinforced', 'fortified'] as const;
type StressProfile = typeof STRESS_PROFILES[number];

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
  // Frame data (Street Fighter / Tekken idiom): how long each phase
  // of a strike lasts. Loaded into the combat tick when the player
  // executes a move from this style.
  const [windupMs, setWindupMs] = useState<number>(120);
  const [activeMs, setActiveMs] = useState<number>(80);
  const [recoveryMs, setRecoveryMs] = useState<number>(200);
  const [rangeM, setRangeM] = useState<number>(1.5);
  const [maxDamage, setMaxDamage] = useState<number>(35);
  const [fightingElement, setFightingElement] = useState<Element>('physical');

  // Spell state
  const [formula, setFormula] = useState<string>('fire+arcane');
  const [mana, setMana] = useState<number>(30);
  const [stamina, setStamina] = useState<number>(0);
  const [ap, setAp] = useState<number>(0);
  const [range, setRange] = useState<typeof RANGES[number]>('mid');
  const [targetType, setTargetType] = useState<typeof TARGET_TYPES[number]>('single');
  const [spellElement, setSpellElement] = useState<Element>('arcane');
  const [spellStatus, setSpellStatus] = useState<StatusEffect[]>([]);

  // Blueprint state
  const [bpKind, setBpKind] = useState<typeof BLUEPRINT_KINDS[number]>('building');
  const [bpDim, setBpDim] = useState<{ x: number; y: number; z: number }>({ x: 4, y: 3, z: 4 });
  const [bpMaterials, setBpMaterials] = useState<string>('wood:50, iron:10');
  const [stressProfile, setStressProfile] = useState<StressProfile>('standard');

  // Post-create marketplace listing — closes the author → save →
  // list → earn loop without leaving the panel.
  const [listingPrice, setListingPrice] = useState<string>('25');
  const [listingError, setListingError] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [listed, setListed] = useState(false);

  function toggleStatus(s: StatusEffect) {
    setSpellStatus((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  function buildMeta(): Record<string, unknown> {
    if (tab === 'fighting_style_recipe') {
      return {
        type: 'fighting_style_recipe',
        moves: moves.split(',').map(s => s.trim()).filter(Boolean).map(comboId => ({ comboId })),
        stance: stance.trim(),
        controlScheme,
        // Frame data + reach + headline damage + element coupling.
        // The combat tick reads these to schedule windup/active/recovery
        // and the env-coupling table picks up `element` to apply potency.
        frame_data: { windup_ms: windupMs, active_ms: activeMs, recovery_ms: recoveryMs },
        range_m: rangeM,
        max_damage: maxDamage,
        ...(fightingElement !== 'none' ? { element: fightingElement } : {}),
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
        ...(spellElement !== 'none' ? { element: spellElement } : {}),
        ...(spellStatus.length > 0 ? { status_effects: spellStatus } : {}),
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
      stress_profile: stressProfile,
    };
  }

  async function handlePublish() {
    if (!lastCreatedId) return;
    setListingError(null);
    const price = Number(listingPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setListingError('Price must be a positive number.');
      return;
    }
    setListing(true);
    try {
      const res = await api.post(
        `/api/personal-locker/dtus/${encodeURIComponent(lastCreatedId)}/list-on-marketplace`,
        { price }
      );
      if (res.data?.ok === false) {
        setListingError(res.data?.error ?? 'Listing failed.');
      } else {
        setListed(true);
      }
    } catch (e) {
      setListingError(e instanceof Error ? e.message : 'Listing failed.');
    } finally {
      setListing(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setListingError(null);
    setListed(false);
    setLastCreatedId(null);
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
          <fieldset className="rounded-md border border-white/10 bg-white/[0.02] px-3 pt-2 pb-3">
            <legend className="px-1 text-[10px] uppercase tracking-wider text-white/50">Frame data (ms)</legend>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-white/60 mb-1">Windup</label>
                <input type="number" min={0} step={10} value={windupMs} onChange={(e) => setWindupMs(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-[10px] text-white/60 mb-1">Active</label>
                <input type="number" min={0} step={10} value={activeMs} onChange={(e) => setActiveMs(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-[10px] text-white/60 mb-1">Recovery</label>
                <input type="number" min={0} step={10} value={recoveryMs} onChange={(e) => setRecoveryMs(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm" />
              </div>
            </div>
          </fieldset>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-white/70 mb-1">Range (m)</label>
              <input type="number" min={0.1} step={0.1} value={rangeM} onChange={(e) => setRangeM(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-white/70 mb-1">Max damage</label>
              <input type="number" min={1} step={1} value={maxDamage} onChange={(e) => setMaxDamage(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-white/70 mb-1">Element</label>
              <select value={fightingElement} onChange={(e) => setFightingElement(e.target.value as Element)} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm">
                {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
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
          <div className="grid grid-cols-3 gap-3">
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
            <div>
              <label className="block text-xs text-white/70 mb-1">Element</label>
              <select value={spellElement} onChange={(e) => setSpellElement(e.target.value as Element)} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm">
                {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-white/70 mb-1">Status effects</label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_EFFECTS.map((s) => {
                const active = spellStatus.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatus(s)}
                    aria-pressed={active}
                    className={`px-2 py-1 rounded-full text-[11px] border transition-colors ${
                      active
                        ? 'bg-amber-500/25 border-amber-500/50 text-amber-200'
                        : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
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
          <div>
            <label className="block text-xs text-white/70 mb-1">Structural stress profile</label>
            <div className="grid grid-cols-4 gap-1.5">
              {STRESS_PROFILES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setStressProfile(p)}
                  aria-pressed={stressProfile === p}
                  className={`px-2 py-1.5 rounded-md text-xs border transition-colors capitalize ${
                    stressProfile === p
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                      : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/40 mt-1">
              Drives the Geo-Mod-light damage model — heavier profiles take more
              hits before transitioning standing → damaged → collapsed.
            </p>
          </div>
        </div>
      )}

      {error && <div className="text-xs text-red-400 mt-3">{error}</div>}

      {lastCreatedId && !listed && (
        <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="text-xs text-emerald-300 font-semibold mb-2">
            Saved as personal — id: <span className="font-mono">{lastCreatedId.slice(0, 16)}…</span>
          </div>
          <p className="text-[11px] text-white/60 mb-3">
            Publish to the marketplace to enter the royalty cascade. 95% of every sale flows to creators;
            derivative works keep paying you forever (rate halves per generation, floor 0.05%).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={listingPrice}
              onChange={(e) => setListingPrice(e.target.value)}
              inputMode="decimal"
              placeholder="Price (CC)"
              className="flex-1 min-w-[120px] bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm"
            />
            <button
              onClick={handlePublish}
              disabled={listing}
              className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-md text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {listing ? 'Listing…' : 'List on marketplace'}
            </button>
          </div>
          {listingError && <p role="alert" className="mt-2 text-[11px] text-rose-300">{listingError}</p>}
        </div>
      )}

      {listed && (
        <div className="mt-4 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          Listed. Earnings appear in the creator dashboard once buyers transact.
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-white/10">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-4 py-2 bg-amber-500/20 border border-amber-500/40 rounded-md text-sm font-semibold disabled:opacity-50 hover:bg-amber-500/30"
        >
          {submitting ? 'Saving…' : lastCreatedId ? 'Save another recipe' : 'Save personal recipe'}
        </button>
      </div>
      <p className="text-[11px] text-white/40 mt-2">
        Recipes save as scope=&apos;personal&apos; — only you see the source. Listings are public but
        the underlying DTU stays personal until consent is granted (citation-consent gate).
      </p>
    </div>
  );
}

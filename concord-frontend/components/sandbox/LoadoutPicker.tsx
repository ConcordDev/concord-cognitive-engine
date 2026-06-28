'use client';

/**
 * LoadoutPicker — swap weapon + skill and save named loadout presets so
 * combat-feel iteration does not need URL editing. Persists per user
 * through the sandbox domain macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Swords, Save, Trash2, Loader2 } from 'lucide-react';

interface WeaponDef { id: string; label: string; baseLight: number; baseHeavy: number; reach: number; armorPierce: number; }
interface SkillDef { id: string; label: string; element: string; tier: number; }
interface Loadout { id: string; name: string; weaponId: string; skillId: string; lightDamage: number; heavyDamage: number; createdAt: string; }

export interface ActiveLoadout {
  weaponId: string;
  skillId: string;
  lightDamage: number;
  heavyDamage: number;
}

export function LoadoutPicker({ onApply }: { onApply: (l: ActiveLoadout) => void }) {
  const [weapons, setWeapons] = useState<WeaponDef[]>([]);
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [weaponId, setWeaponId] = useState('fist');
  const [skillId, setSkillId] = useState('none');
  const [light, setLight] = useState(8);
  const [heavy, setHeavy] = useState(16);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<Loadout[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('sandbox', 'listLoadouts', {});
    if (r.data?.ok && r.data.result) setSaved(r.data.result.loadouts as Loadout[]);
    else throw new Error(r.data?.error || 'list_failed');
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const c = await lensRun('sandbox', 'catalog', {});
        if (c.data?.ok && c.data.result) {
          const ws = c.data.result.weapons as WeaponDef[];
          const ks = c.data.result.skills as SkillDef[];
          setWeapons(ws);
          setSkills(ks);
          if (ws[0]) { setWeaponId(ws[0].id); setLight(ws[0].baseLight); setHeavy(ws[0].baseHeavy); }
        } else {
          throw new Error(c.data?.error || 'catalog_failed');
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load loadouts');
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const selectWeapon = (id: string) => {
    setWeaponId(id);
    const w = weapons.find((x) => x.id === id);
    if (w) { setLight(w.baseLight); setHeavy(w.baseHeavy); }
  };

  const apply = useCallback(() => {
    onApply({ weaponId, skillId, lightDamage: light, heavyDamage: heavy });
  }, [onApply, weaponId, skillId, light, heavy]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun('sandbox', 'saveLoadout', {
        weaponId, skillId, lightDamage: light, heavyDamage: heavy, name: name.trim(),
      });
      if (r.data?.ok) { setName(''); await refresh(); }
      else setError(r.data?.error || 'Save failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setBusy(false); }
  };

  const loadSaved = (l: Loadout) => {
    setWeaponId(l.weaponId);
    setSkillId(l.skillId);
    setLight(l.lightDamage);
    setHeavy(l.heavyDamage);
    onApply({ weaponId: l.weaponId, skillId: l.skillId, lightDamage: l.lightDamage, heavyDamage: l.heavyDamage });
  };

  const remove = async (id: string) => {
    await lensRun('sandbox', 'deleteLoadout', { loadoutId: id });
    await refresh();
  };

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/80 p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-amber-200">
        <Swords className="h-3.5 w-3.5" /> Loadout
      </div>

      <label className="mb-1 block text-[10px] uppercase text-slate-400" htmlFor="sb-weapon">Weapon</label>
      <select
        id="sb-weapon"
        value={weaponId}
        onChange={(e) => selectWeapon(e.target.value)}
        className="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
      >
        {weapons.map((w) => <option key={w.id} value={w.id}>{w.label} · reach {w.reach}m</option>)}
      </select>

      <label className="mb-1 block text-[10px] uppercase text-slate-400" htmlFor="sb-skill">Skill</label>
      <select
        id="sb-skill"
        value={skillId}
        onChange={(e) => setSkillId(e.target.value)}
        className="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
      >
        {skills.map((k) => <option key={k.id} value={k.id}>{k.label} · {k.element} T{k.tier}</option>)}
      </select>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-slate-400">Light dmg</span>
          <input
            type="number" min={1} max={500} value={light}
            onChange={(e) => setLight(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 tabular-nums text-slate-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-slate-400">Heavy dmg</span>
          <input
            type="number" min={1} max={500} value={heavy}
            onChange={(e) => setHeavy(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 tabular-nums text-slate-100"
          />
        </label>
      </div>

      <div className="mb-2 flex gap-2">
        <button
          onClick={apply}
          className="flex-1 rounded bg-amber-600 px-2 py-1 font-semibold text-amber-50 hover:bg-amber-500"
        >
          Equip
        </button>
      </div>

      <div className="mb-2 flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 placeholder:text-slate-600"
        />
        <button
          onClick={save}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 hover:bg-slate-600 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-2 rounded border border-rose-700/60 bg-rose-950/40 px-2 py-1.5 text-[10px] text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-1.5 rounded border border-dashed border-slate-700 px-2 py-2 text-[10px] text-slate-400" aria-busy="true" aria-live="polite">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading loadouts…
        </div>
      ) : saved.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700 px-2 py-2 text-center text-[10px] text-slate-400">
          No saved loadouts yet.
        </div>
      ) : (
        <ul className="space-y-1">
          {saved.map((l) => (
            <li key={l.id} className="flex items-center gap-1.5 rounded bg-slate-800/60 px-2 py-1">
              <button onClick={() => loadSaved(l)} className="min-w-0 flex-1 text-left hover:text-amber-200">
                <div className="truncate text-slate-200">{l.name}</div>
                <div className="text-[9px] text-slate-400">{l.weaponId} · {l.skillId} · {l.lightDamage}/{l.heavyDamage}</div>
              </button>
              <button onClick={() => remove(l.id)} aria-label="Delete loadout" className="text-slate-400 hover:text-rose-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

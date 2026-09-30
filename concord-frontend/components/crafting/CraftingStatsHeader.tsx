'use client';

import { useCallback, useEffect, useState, type MutableRefObject, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import { ACTIVE_WORLD_CHANGED_EVENT } from '@/hooks/useActiveWorldId';
import {
  Hammer, Flame, Wand2, Sword, ShieldCheck, Coins, Loader2, ArrowUpCircle, RefreshCw,
} from 'lucide-react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import {
  activeWorldId,
  type RecipeType,
  type RecipeRow,
  type ResourceBar,
  type CharacterProgress,
} from './crafting-shared';

const ActiveEffectsBar = dynamic(
  () => import('@/components/concordia/hud/ActiveEffectsBar'),
  { ssr: false }
);

export function CraftingStatsHeader({
  refreshRef,
}: {
  /** Parent can call the latest refresh via this mutable ref. */
  refreshRef?: MutableRefObject<(() => void) | null>;
}) {
  const [counts, setCounts] = useState<Record<RecipeType, number>>({
    fighting_style_recipe: 0,
    spell_recipe: 0,
    blueprint: 0,
    food_recipe: 0,
  });
  const [character, setCharacter] = useState<CharacterProgress | null>(null);
  const [bars, setBars] = useState<ResourceBar[]>([]);
  const [balance, setBalance] = useState<{ balance: number; tier?: string } | null>(null);
  const [headerErr, setHeaderErr] = useState<string | null>(null);

  const refreshHeader = useCallback(async () => {
    setHeaderErr(null);
    const worldId = activeWorldId();
    const tasks: Array<Promise<unknown>> = [
      api.get('/api/personal-locker/dtus', { params: { lens: 'concordia' } })
        .then((r) => {
          const all = (r.data?.dtus ?? []) as RecipeRow[];
          const next: Record<RecipeType, number> = {
            fighting_style_recipe: 0, spell_recipe: 0, blueprint: 0, food_recipe: 0,
          };
          for (const d of all) {
            const t = (d.meta?.type ?? d.type) as RecipeType | undefined;
            if (t && next[t] !== undefined) next[t]++;
          }
          setCounts(next);
        })
        .catch((e) => console.warn('[crafting] recipe counts load failed:', e)),
      api.get(`/api/crafting/character/${encodeURIComponent(worldId)}`)
        .then((r) => setCharacter(r.data ?? null))
        .catch(() => setCharacter(null)),
      api.get(`/api/crafting/resource-bars/${encodeURIComponent(worldId)}`)
        .then((r) => setBars((r.data?.bars ?? []) as ResourceBar[]))
        .catch(() => setBars([])),
      api.get('/api/economy/balance')
        .then((r) => setBalance(r.data ?? null))
        .catch(() => setBalance(null)),
    ];
    try {
      await Promise.allSettled(tasks);
    } catch (e) {
      setHeaderErr(e instanceof Error ? e.message : 'header refresh failed');
    }
  }, []);

  useEffect(() => {
    if (refreshRef) refreshRef.current = () => { void refreshHeader(); };
  }, [refreshHeader, refreshRef]);

  useEffect(() => {
    refreshHeader();
    const onAvatar = () => refreshHeader();
    window.addEventListener('concordia:avatar-changed', onAvatar);
    // Canonical event (hooks/useWorldTravel.ts + useActiveWorldId.ts) — the
    // prior 'concordia:world-changed' name is never dispatched by anything.
    window.addEventListener(ACTIVE_WORLD_CHANGED_EVENT, onAvatar);
    return () => {
      window.removeEventListener('concordia:avatar-changed', onAvatar);
      window.removeEventListener(ACTIVE_WORLD_CHANGED_EVENT, onAvatar);
    };
  }, [refreshHeader]);

  return (
    <>
      <header className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <SvgIcon name="hammer" size={28} className="text-amber-400" />
            <h1 className="text-2xl font-bold">Crafting</h1>
          </div>
          <p className="text-xs text-white/40 mt-1">
            Recipes, forge, marketplace, and skill progression — one workbench.
          </p>
        </div>
        <button
          onClick={refreshHeader}
          className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1"
          title="Refresh stats"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </header>

      <StatStrip counts={counts} character={character} balance={balance?.balance ?? 0} />

      {bars.length > 0 && (
        <ResourceBars
          bars={bars}
          upgradePoints={character?.upgrade_points ?? 0}
          onUpgraded={refreshHeader}
        />
      )}

      {headerErr && <p className="text-xs text-red-400 mb-3">{headerErr}</p>}

      <ActiveEffectsBar />
    </>
  );
}

function StatStrip({
  counts, character, balance,
}: {
  counts: Record<RecipeType, number>;
  character: CharacterProgress | null;
  balance: number;
}) {
  const total = counts.fighting_style_recipe + counts.spell_recipe + counts.blueprint + counts.food_recipe;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
      <StatCard label="Recipes" value={String(total)} hint="Personal locker" icon={<Hammer className="w-3.5 h-3.5 text-amber-300" />} />
      <StatCard label="Food"  value={String(counts.food_recipe)}            icon={<Flame className="w-3.5 h-3.5 text-orange-300" />} />
      <StatCard label="Spells" value={String(counts.spell_recipe)}          icon={<Wand2 className="w-3.5 h-3.5 text-violet-300" />} />
      <StatCard label="Styles" value={String(counts.fighting_style_recipe)} icon={<Sword className="w-3.5 h-3.5 text-rose-300" />} />
      <StatCard
        label="Char Lv"
        value={character?.level != null ? String(character.level) : '—'}
        hint={character?.upgrade_points ? `${character.upgrade_points} pts` : undefined}
        icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />}
      />
      <StatCard
        label="Wallet"
        value={balance.toFixed(0)}
        hint="CC"
        icon={<Coins className="w-3.5 h-3.5 text-yellow-300" />}
      />
    </div>
  );
}

function StatCard({
  label, value, hint, icon,
}: { label: string; value: string; hint?: string; icon: ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/50">
        {icon}{label}
      </div>
      <div className="text-base font-bold leading-tight mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-white/40">{hint}</div>}
    </div>
  );
}

function ResourceBars({
  bars, upgradePoints, onUpgraded,
}: { bars: ResourceBar[]; upgradePoints: number; onUpgraded: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upgrade(barType: string) {
    setPending(barType);
    setErr(null);
    try {
      await api.post('/api/crafting/upgrade-bar', { worldId: activeWorldId(), barType });
      onUpgraded();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'upgrade failed';
      setErr(msg);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-3">
      <div className="flex items-center justify-between text-[11px] text-white/60 mb-2">
        <span>Resource bars</span>
        <span>
          {upgradePoints > 0
            ? `${upgradePoints} upgrade point${upgradePoints === 1 ? '' : 's'} available`
            : 'No upgrade points'}
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {bars.map((b) => {
          const pct = b.max > 0 ? Math.max(0, Math.min(100, (b.current / b.max) * 100)) : 0;
          const color = barColor(b.bar_type);
          return (
            <div key={b.bar_type} className="bg-black/40 rounded-md p-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide mb-1">
                <span className="text-white/60">{b.bar_type}</span>
                <span className="text-white/80 font-mono">{Math.round(b.current)}/{Math.round(b.max)}</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
              </div>
              <button
                disabled={upgradePoints <= 0 || pending === b.bar_type}
                onClick={() => upgrade(b.bar_type)}
                className="mt-1.5 w-full text-[10px] py-0.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1"
                title="Spend an upgrade point on this bar"
              >
                {pending === b.bar_type ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                ) : (
                  <ArrowUpCircle className="w-2.5 h-2.5" />
                )}
                Upgrade
              </button>
            </div>
          );
        })}
      </div>
      {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
    </div>
  );
}

function barColor(type: string): string {
  switch (type) {
    case 'hp':         return 'bg-rose-500';
    case 'mana':       return 'bg-violet-500';
    case 'stamina':    return 'bg-emerald-500';
    case 'bio_power':  return 'bg-amber-500';
    case 'perception': return 'bg-cyan-500';
    default:           return 'bg-white/40';
  }
}

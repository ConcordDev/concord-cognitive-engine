'use client';

/**
 * CharacterSheetPanel — a "paper doll"-style character sheet for the world lens.
 *
 * On mount it GETs /api/crafting/character/:worldId (the real, already-wired
 * crafting/progression backend) and renders the character's level, the five
 * vital bars, a skills summary, and a derived "Power" headline. When the player
 * has pending upgrade points, each bar gets a "+" button that POSTs
 * /api/crafting/upgrade-bar and re-fetches.
 *
 * Honest by construction: every number is read from the backend response. On a
 * failed fetch it renders a disconnected state, never fabricated data.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, ChevronDown, ChevronRight, Plus, Sparkles } from 'lucide-react';

type BarType = 'hp' | 'mana' | 'stamina' | 'bio_power' | 'perception';

interface Bar {
  current: number;
  max: number;
}

interface SkillSummary {
  skill_type: string;
  level: number;
  total_xp: number;
}

interface CharacterData {
  ok: boolean;
  characterLevel: number;
  pendingUpgrades: number;
  totalUpgradesSpent: number;
  bars: Partial<Record<BarType, Bar>>;
  skillSummary: SkillSummary[];
  recentUpgrades: unknown[];
}

const BAR_ORDER: BarType[] = ['hp', 'mana', 'stamina', 'bio_power', 'perception'];

const BAR_META: Record<BarType, { label: string; fill: string }> = {
  hp: { label: 'Health', fill: 'bg-rose-500' },
  mana: { label: 'Mana', fill: 'bg-sky-500' },
  stamina: { label: 'Stamina', fill: 'bg-emerald-500' },
  bio_power: { label: 'Bio Power', fill: 'bg-fuchsia-500' },
  perception: { label: 'Perception', fill: 'bg-amber-500' },
};

function humanize(skillType: string): string {
  return skillType
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function CharacterSheetPanel({ worldId, onClose }: { worldId: string; onClose?: () => void }) {
  const [data, setData] = useState<CharacterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<BarType | null>(null);
  const [vitalsOpen, setVitalsOpen] = useState(true);
  const [skillsOpen, setSkillsOpen] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/crafting/character/${encodeURIComponent(worldId)}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (json?.ok) {
        setData(json as CharacterData);
        setError(null);
      } else {
        setError(json?.error || 'Character sheet unavailable');
      }
    } catch {
      setError('Disconnected from character backend');
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    window.addEventListener('concordia:character-updated', handler);
    return () => window.removeEventListener('concordia:character-updated', handler);
  }, [refresh]);

  const upgradeBar = useCallback(
    async (barType: BarType) => {
      setUpgrading(barType);
      try {
        await fetch('/api/crafting/upgrade-bar', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worldId, barType }),
        });
      } catch {
        /* surfaced via refresh — unchanged pending count means it didn't apply */
      } finally {
        setUpgrading(null);
        await refresh();
      }
    },
    [worldId, refresh]
  );

  const pending = data?.pendingUpgrades ?? 0;

  // Derived summary headline — clearly labelled as a derived figure, not a stored stat.
  const power = (() => {
    if (!data) return 0;
    const barMaxSum = BAR_ORDER.reduce((acc, b) => acc + (data.bars?.[b]?.max ?? 0), 0);
    const skillLevelSum = (data.skillSummary ?? []).reduce((acc, s) => acc + (s.level ?? 0), 0);
    return Math.round(data.characterLevel * 10 + barMaxSum / 10 + skillLevelSum);
  })();

  const sortedSkills = [...(data?.skillSummary ?? [])].sort((a, b) => b.level - a.level);

  return (
    <div className="fixed left-1/2 top-1/2 z-40 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-black/80 text-white shadow-2xl backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-amber-300" /> Character Sheet
          </h2>
          {data && (
            <div className="mt-0.5 flex items-center gap-3 text-xs text-white/70">
              <span>
                Level <span className="font-semibold text-white">{data.characterLevel}</span>
              </span>
              {pending > 0 && (
                <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-semibold text-amber-200">
                  {pending} upgrade point{pending === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close character sheet"
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
        {loading && <div className="py-6 text-center text-xs text-white/50">Loading character…</div>}

        {!loading && error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Derived headline */}
            <div className="mb-4 flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-white/50">
                Power (derived summary)
              </span>
              <span className="text-lg font-bold tabular-nums text-amber-200">{power}</span>
            </div>

            {/* Vitals */}
            <section className="mb-4">
              <button
                type="button"
                onClick={() => setVitalsOpen((v) => !v)}
                className="mb-2 flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white"
              >
                {vitalsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Vitals
              </button>
              {vitalsOpen && (
                <ul className="space-y-2">
                  {BAR_ORDER.map((barType) => {
                    const bar = data.bars?.[barType];
                    if (!bar) return null;
                    const meta = BAR_META[barType];
                    const pct = bar.max > 0 ? Math.min(100, Math.round((bar.current / bar.max) * 100)) : 0;
                    return (
                      <li key={barType} data-testid={`bar-${barType}`}>
                        <div className="mb-0.5 flex items-center justify-between text-xs">
                          <span className="text-white/80">{meta.label}</span>
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums text-white/60">
                              {Math.round(bar.current)} / {Math.round(bar.max)}
                            </span>
                            {pending > 0 && (
                              <button
                                type="button"
                                disabled={upgrading === barType}
                                onClick={() => upgradeBar(barType)}
                                aria-label={`Upgrade ${meta.label}`}
                                className="flex h-4 w-4 items-center justify-center rounded bg-amber-400/20 text-amber-200 hover:bg-amber-400/40 disabled:opacity-40"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded bg-white/10">
                          <div className={`h-full ${meta.fill}`} style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Skills */}
            <section>
              <button
                type="button"
                onClick={() => setSkillsOpen((v) => !v)}
                className="mb-2 flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white"
              >
                {skillsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Skills
              </button>
              {skillsOpen && (
                <ul className="space-y-1">
                  {sortedSkills.length === 0 && (
                    <li className="py-2 text-xs text-white/40">No skills trained yet.</li>
                  )}
                  {sortedSkills.map((s) => (
                    <li
                      key={s.skill_type}
                      data-testid={`skill-${s.skill_type}`}
                      className="flex items-center justify-between rounded px-2 py-1 text-xs odd:bg-white/5"
                    >
                      <span className="text-white/85">{humanize(s.skill_type)}</span>
                      <span className="flex items-center gap-3 tabular-nums text-white/60">
                        <span>
                          Lv <span className="font-semibold text-white">{s.level}</span>
                        </span>
                        <span className="text-white/40">{s.total_xp.toLocaleString()} xp</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default CharacterSheetPanel;

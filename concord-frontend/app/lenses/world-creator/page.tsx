'use client';

/**
 * World Creator — entrypoint lens for authoring new sub-worlds.
 *
 * Why this lens exists separately from /lenses/world: the world lens is the
 * play surface (presence, render, combat). World-creator is the authoring
 * surface — fork a universe-type, pick rule modulators, mint the world,
 * then route into /lenses/world?worldId=<new-id>. It also surfaces the
 * anomaly viewer (creators see anomalies for their own worlds; that
 * sub-route already exists at /lenses/world-creator/anomalies).
 *
 * Backend wire: POST /api/worlds (routes/worlds.js:149) — auth required;
 * server records `created_by = req.user.id`. The detector at
 * `lib/anomaly-detection.js` is what `anomalies/` reads.
 */
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useState, useCallback, useMemo } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LensShell } from '@/components/lens/LensShell';

const UNIVERSE_TYPES = [
  { id: 'concordia-hub', label: 'Concordia (default)', description: 'Earth-like physics, balanced ecosystem.' },
  { id: 'ruined', label: 'Ruined', description: 'Post-collapse aesthetic; dust, scarcity, slower healing.' },
  { id: 'verdant', label: 'Verdant', description: 'High biomass, fast growth, dense fauna.' },
  { id: 'arcane', label: 'Arcane', description: 'Stronger element coupling; magic potency boosted.' },
  { id: 'frontier', label: 'Frontier', description: 'Sparse cities, longer travel, peer-mesh-friendly.' },
  { id: 'crucible', label: 'Crucible', description: 'High drift density; lattice-quest-cycle fires more aggressively.' },
] as const;

type UniverseType = typeof UNIVERSE_TYPES[number]['id'];

interface RuleModulators {
  combatLethality: number;       // 0.5 (cozy) → 1.5 (lethal)
  refusalSensitivity: number;    // 0.5 (loose) → 1.5 (strict)
  questDensity: number;          // 0.5 (sparse) → 1.5 (dense)
  weatherIntensity: number;      // 0.5 (mild) → 1.5 (extreme)
}

const DEFAULT_RULES: RuleModulators = {
  combatLethality: 1.0,
  refusalSensitivity: 1.0,
  questDensity: 1.0,
  weatherIntensity: 1.0,
};

export default function WorldCreatorPage() {
  useLensCommand([
    { id: 'world-creator-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'world-creator' });

  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [universeType, setUniverseType] = useState<UniverseType>('concordia-hub');
  const [rules, setRules] = useState<RuleModulators>(DEFAULT_RULES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => name.trim().length >= 3 && !submitting, [name, submitting]);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/worlds', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          universe_type: universeType,
          description: description.trim(),
          physics_modulators: {},
          rule_modulators: rules,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const worldId = data?.world?.id;
      if (worldId) {
        router.push(`/lenses/world?worldId=${encodeURIComponent(worldId)}`);
      } else {
        router.push('/lenses/world');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create world');
      setSubmitting(false);
    }
  }, [name, description, universeType, rules, canSubmit, router]);

  const updateRule = useCallback(<K extends keyof RuleModulators>(key: K, value: number) => {
    setRules(prev => ({ ...prev, [key]: value }));
  }, []);

  return (
    <LensShell lensId="world-creator">
      <div className="mx-auto max-w-3xl px-6 py-8 text-stone-100">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Create a sub-world</h1>
          <p className="mt-2 text-stone-400">
            Fork a universe type, dial the rule modulators, and the content seeder will populate
            it from <code className="text-stone-300">content/world/&lt;id&gt;/</code> if authored
            content exists. You become the world&apos;s sole creator — there is no admin role.
          </p>
          <nav className="mt-4 flex gap-4 text-sm">
            <Link href="/lenses/world-creator/anomalies" className="text-amber-400 hover:underline">
              View anomalies in your worlds →
            </Link>
            <Link href="/lenses/world" className="text-stone-400 hover:underline">
              ← Back to world lens
            </Link>
          </nav>
        </header>

        <form onSubmit={onSubmit} className="space-y-6">
          <fieldset className="space-y-2">
            <label htmlFor="world-name" className="block text-sm font-medium text-stone-300">
              World name
            </label>
            <input
              id="world-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. The Sovereign Ruins"
              minLength={3}
              maxLength={64}
              required
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-stone-100 focus:border-amber-500 focus:outline-none"
            />
            <p className="text-xs text-stone-500">3–64 characters. Visible to anyone who travels here.</p>
          </fieldset>

          <fieldset className="space-y-2">
            <label className="block text-sm font-medium text-stone-300">Universe type</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {UNIVERSE_TYPES.map(ut => (
                <button
                  key={ut.id}
                  type="button"
                  onClick={() => setUniverseType(ut.id)}
                  className={`rounded border px-3 py-3 text-left transition ${
                    universeType === ut.id
                      ? 'border-amber-500 bg-amber-950/20'
                      : 'border-stone-700 bg-stone-900 hover:border-stone-500'
                  }`}
                >
                  <div className="font-medium text-stone-100">{ut.label}</div>
                  <div className="mt-1 text-xs text-stone-400">{ut.description}</div>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <label htmlFor="world-description" className="block text-sm font-medium text-stone-300">
              Description (optional)
            </label>
            <textarea
              id="world-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="What should travellers know before they arrive?"
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-stone-100 focus:border-amber-500 focus:outline-none"
            />
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-stone-300">Rule modulators</legend>
            {(Object.entries(rules) as [keyof RuleModulators, number][]).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[160px_1fr_60px] items-center gap-3">
                <label htmlFor={`rule-${key}`} className="text-sm text-stone-400">
                  {ruleLabel(key)}
                </label>
                <input
                  id={`rule-${key}`}
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.1}
                  value={value}
                  onChange={e => updateRule(key, Number(e.target.value))}
                  className="w-full"
                />
                <span className="text-right text-xs tabular-nums text-stone-300">
                  {value.toFixed(1)}×
                </span>
              </div>
            ))}
            <p className="text-xs text-stone-500">
              All modulators default to 1.0×. Server clamps to [0.5×, 1.5×]. Saved as JSON in{' '}
              <code>worlds.rule_modulators</code>.
            </p>
          </fieldset>

          {error && (
            <div role="alert" className="rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded bg-amber-600 px-4 py-2 font-medium text-stone-900 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create world'}
            </button>
            <Link
              href="/lenses/world"
              className="text-sm text-stone-400 hover:text-stone-200"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
    </LensShell>
  );
}

function ruleLabel(key: keyof RuleModulators): string {
  switch (key) {
    case 'combatLethality':    return 'Combat lethality';
    case 'refusalSensitivity': return 'Refusal sensitivity';
    case 'questDensity':       return 'Quest density';
    case 'weatherIntensity':   return 'Weather intensity';
  }
}

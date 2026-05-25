'use client';

/**
 * DecreePanel — issue one of 8 decree kinds for the realm the player
 * rules. Mounted in PanelHost; opened from RulerOverlay's "Issue
 * decree" button.
 *
 * Decree kinds + estimated popularity_delta (rough heuristic; the
 * server's applyDecreeEffect computes the real value):
 *   tax_change       — ±10 depending on direction
 *   conscription     — −15 (citizens hate forced service)
 *   trade_embargo    — −5 / +5 depending on rival
 *   recipe_grant     — +12 (free knowledge → goodwill)
 *   pardon           — +8 (forgives an exile)
 *   exile            — −6 (removes a target; some applaud, more fear)
 *   construction     — +5 (building things citizens see)
 *   festival         — +12 (loved; legitimacy boost)
 *
 * Submits via kingdoms.propose_decree macro; the server validates
 * issuer = ruler and applies the effect.
 */

import { useState } from 'react';
import { useHUDContext } from '../HUDContextProvider';
import { macro } from './_macro';

type DecreeKind = 'tax_change' | 'conscription' | 'trade_embargo' | 'recipe_grant' | 'pardon' | 'exile' | 'construction' | 'festival';

interface DecreeSpec {
  kind: DecreeKind;
  label: string;
  description: string;
  estimatedDelta: number;
  bodyFields: Array<{ key: string; label: string; type: 'number' | 'text'; placeholder?: string }>;
}

const DECREE_SPECS: DecreeSpec[] = [
  { kind: 'tax_change',    label: 'Change Tax Rate',  description: 'Raise or lower tax. Citizens dislike rises.', estimatedDelta: -10, bodyFields: [{ key: 'new_rate', label: 'New rate (0.0–0.5)', type: 'number', placeholder: '0.10' }] },
  { kind: 'conscription',  label: 'Conscript Citizens', description: 'Forced military service. Loyalty drops.', estimatedDelta: -15, bodyFields: [{ key: 'count', label: 'How many', type: 'number', placeholder: '50' }] },
  { kind: 'trade_embargo', label: 'Trade Embargo',    description: 'Block trade with a rival realm.', estimatedDelta: -5, bodyFields: [{ key: 'against_kingdom_id', label: 'Target realm id', type: 'text', placeholder: 'realm_xxx' }] },
  { kind: 'recipe_grant',  label: 'Grant Recipe',     description: 'Gift a recipe DTU to all citizens.', estimatedDelta: 12, bodyFields: [{ key: 'recipe_id', label: 'Recipe DTU id', type: 'text', placeholder: 'dtu_xxx' }] },
  { kind: 'pardon',        label: 'Pardon Exile',     description: 'Lift exile against a target.', estimatedDelta: 8, bodyFields: [{ key: 'target_user_id', label: 'Target user/NPC id', type: 'text', placeholder: 'user_xxx' }] },
  { kind: 'exile',         label: 'Exile',            description: 'Banish a target from the realm.', estimatedDelta: -6, bodyFields: [{ key: 'target_user_id', label: 'Target user/NPC id', type: 'text', placeholder: 'user_xxx' }, { key: 'reason', label: 'Reason', type: 'text', placeholder: 'sedition' }] },
  { kind: 'construction',  label: 'Construction',     description: 'Authorise a building. Treasury cost.', estimatedDelta: 5, bodyFields: [{ key: 'project', label: 'Project name', type: 'text', placeholder: 'new_temple' }, { key: 'cost', label: 'Treasury cost', type: 'number', placeholder: '300' }] },
  { kind: 'festival',      label: 'Festival',         description: 'Throw a festival. Citizens love it.', estimatedDelta: 12, bodyFields: [{ key: 'theme', label: 'Theme', type: 'text', placeholder: 'harvest' }] },
];

export function DecreePanel() {
  const myRealm = useHUDContext((s) => s.myRealm);
  const [selectedKind, setSelectedKind] = useState<DecreeKind | null>(null);
  const [bodyValues, setBodyValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!myRealm) {
    return <p className="text-sm text-zinc-400 italic">You don&apos;t rule a realm. Take over one via conquest, inheritance, or election to issue decrees.</p>;
  }

  const spec = selectedKind ? DECREE_SPECS.find((s) => s.kind === selectedKind) : null;

  async function submit() {
    if (!spec) return;
    setSubmitting(true);
    setStatus(`Proposing ${spec.label}…`);
    // Convert body values to typed shape
    const body: Record<string, unknown> = {};
    for (const f of spec.bodyFields) {
      const raw = bodyValues[f.key] || '';
      body[f.key] = f.type === 'number' ? Number(raw) : raw;
    }
    const r = await macro('kingdoms', 'propose_decree', {
      kingdomId: myRealm!.id,
      kind: spec.kind,
      body,
    });
    setSubmitting(false);
    if (r?.ok) {
      setStatus(`✓ ${spec.label} issued.`);
      setSelectedKind(null);
      setBodyValues({});
    } else {
      setStatus(`Failed: ${r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 5000);
  }

  return (
    <div className="text-sm" data-testid="decree-panel">
      <p className="text-xs text-zinc-400 mb-3">
        Ruler of <span className="font-bold text-amber-200">{myRealm.name}</span>. Choose a decree. Citizens will respond.
      </p>

      {status && (
        <div role="status" aria-live="polite" className="mb-3 bg-amber-950/50 border border-amber-700/50 text-amber-200 px-3 py-1.5 rounded text-xs">{status}</div>
      )}

      {!spec ? (
        <ul className="grid grid-cols-1 gap-1.5">
          {DECREE_SPECS.map((s) => (
            <li key={s.kind}>
              <button
                type="button"
                onClick={() => setSelectedKind(s.kind)}
                aria-label={`Choose ${s.label}`}
                data-decree-kind={s.kind}
                className="w-full text-left bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-900 hover:border-amber-700/60 rounded p-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-100">{s.label}</span>
                  <span className={`text-[10px] font-mono ${s.estimatedDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.estimatedDelta > 0 ? '+' : ''}{s.estimatedDelta} popularity
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-zinc-400">{s.description}</p>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-2">
          <div className="bg-zinc-900/50 border border-amber-700/60 rounded p-2">
            <h4 className="text-sm font-bold text-amber-200 mb-1">{spec.label}</h4>
            <p className="text-[10px] text-zinc-400">{spec.description}</p>
            <p className="mt-1 text-[10px] font-mono text-zinc-400">
              Estimated popularity Δ: <span className={spec.estimatedDelta > 0 ? 'text-emerald-400' : 'text-red-400'}>{spec.estimatedDelta > 0 ? '+' : ''}{spec.estimatedDelta}</span>
            </p>
          </div>

          {spec.bodyFields.map((f) => (
            <label key={f.key} className="block">
              <span className="block text-[10px] text-zinc-400 mb-0.5">{f.label}</span>
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                value={bodyValues[f.key] || ''}
                onChange={(e) => setBodyValues((cur) => ({ ...cur, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                aria-label={f.label}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs"
              />
            </label>
          ))}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setSelectedKind(null); setBodyValues({}); }}
              aria-label="Back"
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              aria-label="Submit decree"
              className="flex-1 text-xs px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium disabled:opacity-50"
            >
              {submitting ? 'Issuing…' : `Issue ${spec.label}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

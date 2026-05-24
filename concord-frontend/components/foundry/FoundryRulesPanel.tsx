'use client';

/**
 * Foundry — FoundryRulesPanel.
 *
 * Author game rules in plain language. Each line ("when a player
 * enters the boss arena, lock the doors") goes to foundry.compose_rule,
 * which translates it into a structured rule via the conscious brain —
 * or, if no brain is reachable, a deterministic keyword parse. Either
 * way you get a usable rule back; the composedBy badge says which path
 * produced it. Composed rules persist into the worldspec.
 */

import { useState } from 'react';
import { composeRule, type FoundryRule } from '@/lib/foundry/api';
import { Loader2, Plus, Wand2, Trash2 } from 'lucide-react';

interface FoundryRulesPanelProps {
  foundryWorldId: string | null;
  rules: FoundryRule[];
  onRulesChange: (rules: FoundryRule[]) => void;
}

export function FoundryRulesPanel({ foundryWorldId, rules, onRulesChange }: FoundryRulesPanelProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    const nl = draft.trim();
    if (!nl) return;
    setBusy(true);
    setErr(null);
    try {
      // Pass the world id when saved so the rule persists server-side;
      // otherwise it's held locally until the next Save.
      const r = await composeRule(nl, foundryWorldId ?? undefined);
      if (!r.ok || !r.rule) {
        setErr(r.reason === 'rule_too_long' ? 'Keep the rule under 500 characters.' : `Couldn't compose that rule (${r.reason ?? 'unknown'}).`);
        return;
      }
      onRulesChange([...rules, r.rule]);
      setDraft('');
    } catch {
      setErr('Could not reach the backend to compose the rule.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => onRulesChange(rules.filter((r) => r.id !== id));

  return (
    <div className="mt-6 border-t border-slate-800 pt-3">
      <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Wand2 className="h-3 w-3" /> Rules
      </h3>

      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) add(); }}
          placeholder="e.g. when a player enters the boss arena, lock the doors"
          maxLength={500}
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !draft.trim()}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
        </button>
      </div>
      {err && <p className="mt-1 text-[11px] text-red-300">{err}</p>}

      {rules.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-start gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-slate-200">{rule.source}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  <span className="text-sky-400">{rule.trigger.kind}</span>
                  {rule.trigger.target ? ` (${rule.trigger.target})` : ''}
                  {' → '}
                  <span className="text-emerald-400">{rule.effect.kind}</span>
                  {rule.effect.target ? ` (${rule.effect.target})` : ''}
                  <span className="ml-1.5 rounded bg-slate-800 px-1 py-px">
                    {rule.composedBy === 'llm' ? 'AI' : 'keyword'}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(rule.id)}
                aria-label="Remove rule"
                className="rounded p-0.5 text-slate-400 hover:bg-red-600/20 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FoundryRulesPanel;

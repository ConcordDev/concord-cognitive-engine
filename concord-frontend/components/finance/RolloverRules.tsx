'use client';

import { useCallback, useEffect, useState } from 'react';
import { Recycle, Loader2, Trash2, Play } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Envelope {
  id: string;
  category: string;
  monthlyTarget: number;
  rolloverEnabled: boolean;
  currentBalance: number;
  spentThisMonth: number;
}
interface RolloverRule {
  id: string;
  envelopeId: string;
  mode: 'full' | 'capped' | 'reset';
  cap: number;
  goalTarget: number;
  accumulatedGoal: number;
}
interface AppliedRow {
  envelopeId: string;
  category: string;
  leftover: number;
  carried: number;
  toGoal: number;
  mode: string;
  newBalance: number;
  goalProgress: { accumulated: number; target: number; pct: number } | null;
}

const MODE_DESC: Record<RolloverRule['mode'], string> = {
  full: 'Carry all leftover into next cycle',
  capped: 'Carry up to the cap, surplus → savings goal',
  reset: 'Drop leftover, start fresh each cycle',
};

export function RolloverRules() {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [rules, setRules] = useState<RolloverRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [applied, setApplied] = useState<AppliedRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ envelopeId: '', mode: 'full' as RolloverRule['mode'], cap: '', goalTarget: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [env, rl] = await Promise.all([
        lensRun('finance', 'envelopes-list', {}),
        lensRun('finance', 'rollover-rules-list', {}),
      ]);
      if (env.data?.ok) setEnvelopes((env.data.result as { envelopes: Envelope[] }).envelopes || []);
      if (rl.data?.ok) setRules((rl.data.result as { rules: RolloverRule[] }).rules || []);
    } catch (e) { console.error('[Rollover] load failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function setRule() {
    if (!form.envelopeId) return;
    setBusy(true);
    try {
      const r = await lensRun('finance', 'rollover-rule-set', {
        envelopeId: form.envelopeId,
        mode: form.mode,
        cap: form.mode === 'capped' ? Number(form.cap) || 0 : 0,
        goalTarget: form.mode === 'capped' ? Number(form.goalTarget) || 0 : 0,
      });
      if (r.data?.ok) {
        setForm({ envelopeId: '', mode: 'full', cap: '', goalTarget: '' });
        await refresh();
      }
    } catch (e) { console.error('[Rollover] set failed', e); }
    finally { setBusy(false); }
  }

  async function deleteRule(id: string) {
    try {
      const r = await lensRun('finance', 'rollover-rule-delete', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Rollover] delete failed', e); }
  }

  async function applyRollover() {
    setBusy(true);
    try {
      const r = await lensRun('finance', 'rollover-apply', {});
      if (r.data?.ok) {
        setApplied((r.data.result as { applied: AppliedRow[] }).applied || []);
        await refresh();
      }
    } catch (e) { console.error('[Rollover] apply failed', e); }
    finally { setBusy(false); }
  }

  const envName = (id: string) => envelopes.find((e) => e.id === id)?.category || id;
  const ruledIds = new Set(rules.map((r) => r.envelopeId));
  const availableEnvelopes = envelopes.filter((e) => !ruledIds.has(e.id));

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Recycle className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Budget rollover rules
        </span>
        <button
          onClick={applyRollover}
          disabled={busy || envelopes.length === 0}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          <Play className="w-3 h-3" /> Run period close
        </button>
      </header>

      <p className="px-4 py-2 text-[10px] text-gray-400 border-b border-white/5">
        Attach a rollover rule to a budget envelope. At period close, leftover money
        carries forward per the rule — capped mode routes surplus into a savings goal.
      </p>

      {/* New rule form */}
      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <select
          value={form.envelopeId}
          onChange={(e) => setForm({ ...form, envelopeId: e.target.value })}
          className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          <option value="">Select envelope…</option>
          {availableEnvelopes.map((e) => <option key={e.id} value={e.id}>{e.category}</option>)}
        </select>
        <select
          value={form.mode}
          onChange={(e) => setForm({ ...form, mode: e.target.value as RolloverRule['mode'] })}
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          <option value="full">Full</option>
          <option value="capped">Capped</option>
          <option value="reset">Reset</option>
        </select>
        {form.mode === 'capped' ? (
          <>
            <input
              type="number"
              value={form.cap}
              onChange={(e) => setForm({ ...form, cap: e.target.value })}
              placeholder="Carry cap"
              className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
            <input
              type="number"
              value={form.goalTarget}
              onChange={(e) => setForm({ ...form, goalTarget: e.target.value })}
              placeholder="Goal target"
              className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
          </>
        ) : (
          <div className="col-span-2 px-2 py-1.5 text-[10px] text-gray-400 flex items-center">
            {MODE_DESC[form.mode]}
          </div>
        )}
        <button
          onClick={setRule}
          disabled={busy || !form.envelopeId}
          className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
        >
          Save rule
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : rules.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">
            <Recycle className="w-6 h-6 mx-auto mb-2 opacity-30" />
            {envelopes.length === 0
              ? 'No budget envelopes yet — create one in the Budget tab first.'
              : 'No rollover rules. Add one above.'}
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rules.map((r) => (
              <li key={r.id} className="px-3 py-2.5 hover:bg-white/[0.03] group flex items-center gap-3 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white truncate">{envName(r.envelopeId)}</span>
                    <span className={cn(
                      'text-[9px] uppercase px-1.5 py-0.5 rounded',
                      r.mode === 'full' ? 'bg-emerald-500/15 text-emerald-300'
                        : r.mode === 'capped' ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-zinc-500/15 text-zinc-300',
                    )}>
                      {r.mode}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {MODE_DESC[r.mode]}
                    {r.mode === 'capped' && r.cap > 0 && ` · cap $${r.cap}`}
                  </div>
                  {r.goalTarget > 0 && (
                    <div className="mt-1">
                      <div className="flex items-center justify-between text-[10px] text-gray-400">
                        <span>Savings goal</span>
                        <span>${r.accumulatedGoal.toLocaleString()} / ${r.goalTarget.toLocaleString()}</span>
                      </div>
                      <div className="h-1 bg-white/5 rounded-full overflow-hidden mt-0.5">
                        <div
                          className="h-full bg-cyan-500/70 rounded-full"
                          style={{ width: `${Math.min(100, (r.accumulatedGoal / r.goalTarget) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => deleteRule(r.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"
                  aria-label="Delete rule"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {applied && applied.length > 0 && (
        <div className="px-4 py-3 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
            Last period close
          </div>
          <ul className="space-y-1">
            {applied.map((a) => (
              <li key={a.envelopeId} className="flex items-center gap-2 text-[11px]">
                <span className="text-gray-400 w-24 truncate">{a.category}</span>
                <span className="text-gray-400">leftover ${a.leftover.toLocaleString()}</span>
                <span className="text-emerald-300">→ carried ${a.carried.toLocaleString()}</span>
                {a.toGoal > 0 && <span className="text-cyan-300">→ goal ${a.toGoal.toLocaleString()}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default RolloverRules;

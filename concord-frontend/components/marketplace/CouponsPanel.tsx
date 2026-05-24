'use client';

/**
 * CouponsPanel — sales events beyond simple promotions: tiered
 * (spend-more-save-more), BOGO, percent / fixed / free-shipping, all
 * with time-boxing and redemption caps. A live coupon tester applies
 * any code against a sample subtotal so the seller can verify the math.
 * Persisted via the `coupons-*` macros. No seed data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Ticket, Loader2, Plus, Trash2, Power, Calculator } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type CouponKind = 'percent' | 'fixed' | 'free_shipping' | 'bogo' | 'tiered';

interface Tier {
  minSpendUsd: number;
  percentOff: number;
}

interface Coupon {
  id: string;
  number: string;
  code: string;
  kind: CouponKind;
  amount: number;
  tiers: Tier[];
  buyQty: number;
  getQty: number;
  minOrderUsd: number;
  maxRedemptions: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  live: boolean;
  redemptions: number;
}

interface ApplyResult {
  code: string;
  kind: string;
  discountUsd: number;
  subtotalUsd: number;
  totalAfterDiscountUsd: number;
}

const KIND_LABEL: Record<CouponKind, string> = {
  percent: 'Percent off',
  fixed: 'Fixed amount off',
  free_shipping: 'Free shipping',
  bogo: 'Buy X get Y free',
  tiered: 'Tiered (spend more, save more)',
};

export function CouponsPanel() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    code: '',
    kind: 'percent' as CouponKind,
    amount: '',
    buyQty: '1',
    getQty: '1',
    minOrderUsd: '',
    maxRedemptions: '',
    startsAt: '',
    endsAt: '',
  });
  const [tiers, setTiers] = useState<{ minSpendUsd: string; percentOff: string }[]>([
    { minSpendUsd: '', percentOff: '' },
  ]);

  // Coupon tester
  const [testCode, setTestCode] = useState('');
  const [testSubtotal, setTestSubtotal] = useState('');
  const [testQty, setTestQty] = useState('1');
  const [testResult, setTestResult] = useState<ApplyResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('marketplace', 'coupons-list', {});
      if (r.data?.ok) setCoupons((r.data.result?.coupons || []) as Coupon[]);
    } catch (e) {
      console.error('[Coupons] list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function create() {
    if (!draft.code.trim()) return;
    setError(null);
    try {
      const input: Record<string, unknown> = {
        code: draft.code.trim(),
        kind: draft.kind,
        minOrderUsd: Number(draft.minOrderUsd) || 0,
        maxRedemptions: draft.maxRedemptions === '' ? 0 : Number(draft.maxRedemptions),
        startsAt: draft.startsAt || '',
        endsAt: draft.endsAt || '',
      };
      if (draft.kind === 'percent' || draft.kind === 'fixed') input.amount = Number(draft.amount) || 0;
      if (draft.kind === 'bogo') {
        input.buyQty = Number(draft.buyQty) || 1;
        input.getQty = Number(draft.getQty) || 1;
      }
      if (draft.kind === 'tiered') {
        input.tiers = tiers
          .filter((t) => t.minSpendUsd !== '' && t.percentOff !== '')
          .map((t) => ({
            minSpendUsd: Number(t.minSpendUsd) || 0,
            percentOff: Number(t.percentOff) || 0,
          }));
      }
      const r = await lensRun('marketplace', 'coupons-create', input);
      if (r.data?.ok === false) {
        setError(r.data.error || 'Could not create coupon');
        return;
      }
      setCreating(false);
      setDraft({
        code: '',
        kind: 'percent',
        amount: '',
        buyQty: '1',
        getQty: '1',
        minOrderUsd: '',
        maxRedemptions: '',
        startsAt: '',
        endsAt: '',
      });
      setTiers([{ minSpendUsd: '', percentOff: '' }]);
      await refresh();
    } catch (e) {
      console.error('[Coupons] create failed', e);
      setError('Could not create coupon');
    }
  }

  async function toggle(id: string) {
    try {
      await lensRun('marketplace', 'coupons-toggle', { id });
      await refresh();
    } catch (e) {
      console.error('[Coupons] toggle failed', e);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this coupon?')) return;
    try {
      await lensRun('marketplace', 'coupons-delete', { id });
      await refresh();
    } catch (e) {
      console.error('[Coupons] delete failed', e);
    }
  }

  async function test() {
    setTestError(null);
    setTestResult(null);
    try {
      const r = await lensRun('marketplace', 'coupons-apply', {
        code: testCode.trim(),
        subtotalUsd: Number(testSubtotal) || 0,
        qty: Number(testQty) || 1,
      });
      if (r.data?.ok === false) {
        setTestError(r.data.error || 'Coupon could not be applied');
        return;
      }
      setTestResult((r.data?.result as ApplyResult) || null);
    } catch (e) {
      console.error('[Coupons] apply failed', e);
      setTestError('Coupon could not be applied');
    }
  }

  function summary(c: Coupon): string {
    if (c.kind === 'percent') return `${c.amount}% off`;
    if (c.kind === 'fixed') return `$${c.amount} off`;
    if (c.kind === 'free_shipping') return 'Free shipping';
    if (c.kind === 'bogo') return `Buy ${c.buyQty}, get ${c.getQty} free`;
    if (c.kind === 'tiered')
      return c.tiers.map((t) => `$${t.minSpendUsd}+ → ${t.percentOff}%`).join(', ');
    return c.kind;
  }

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Ticket className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Coupons &amp; sales events</span>
          <span className="text-[10px] text-gray-400">{coupons.length}</span>
          <button
            onClick={() => setCreating((v) => !v)}
            className="ml-auto px-2.5 py-1 text-xs rounded bg-orange-500 text-black font-semibold hover:bg-orange-400 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> New coupon
          </button>
        </header>

        {creating && (
          <div className="px-4 py-3 border-b border-white/10 space-y-2">
            <div className="grid grid-cols-12 gap-2">
              <input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                placeholder="CODE *"
                className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono uppercase"
              />
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as CouponKind })}
                className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              >
                {(Object.keys(KIND_LABEL) as CouponKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              {(draft.kind === 'percent' || draft.kind === 'fixed') && (
                <input
                  type="number"
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  placeholder={draft.kind === 'percent' ? '% off' : '$ off'}
                  className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
              )}
            </div>

            {draft.kind === 'bogo' && (
              <div className="grid grid-cols-12 gap-2">
                <input
                  type="number"
                  value={draft.buyQty}
                  onChange={(e) => setDraft({ ...draft, buyQty: e.target.value })}
                  placeholder="Buy qty"
                  className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
                <input
                  type="number"
                  value={draft.getQty}
                  onChange={(e) => setDraft({ ...draft, getQty: e.target.value })}
                  placeholder="Get free qty"
                  className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
              </div>
            )}

            {draft.kind === 'tiered' && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase text-gray-400">Spend tiers</div>
                {tiers.map((t, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <input
                      type="number"
                      value={t.minSpendUsd}
                      onChange={(e) =>
                        setTiers((ts) =>
                          ts.map((tt, idx) =>
                            idx === i ? { ...tt, minSpendUsd: e.target.value } : tt,
                          ),
                        )
                      }
                      placeholder="Min spend $"
                      className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                    />
                    <input
                      type="number"
                      value={t.percentOff}
                      onChange={(e) =>
                        setTiers((ts) =>
                          ts.map((tt, idx) =>
                            idx === i ? { ...tt, percentOff: e.target.value } : tt,
                          ),
                        )
                      }
                      placeholder="% off"
                      className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                    />
                    <button
                      onClick={() => setTiers((ts) => ts.filter((_, idx) => idx !== i))}
                      className="col-span-2 p-1.5 rounded hover:bg-rose-500/20 text-rose-300 flex items-center justify-center"
                      aria-label="Remove tier"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setTiers((ts) => [...ts, { minSpendUsd: '', percentOff: '' }])}
                  className="px-2 py-1 text-[10px] rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25 inline-flex items-center gap-1"
                >
                  <Plus className="w-2.5 h-2.5" /> Add tier
                </button>
              </div>
            )}

            <div className="grid grid-cols-12 gap-2">
              <input
                type="number"
                value={draft.minOrderUsd}
                onChange={(e) => setDraft({ ...draft, minOrderUsd: e.target.value })}
                placeholder="Min order $"
                className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
              />
              <input
                type="number"
                value={draft.maxRedemptions}
                onChange={(e) => setDraft({ ...draft, maxRedemptions: e.target.value })}
                placeholder="Max redemptions (0=∞)"
                className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
              />
              <input
                type="date"
                value={draft.startsAt}
                onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
              <input
                type="date"
                value={draft.endsAt}
                onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
            </div>
            {error && <div className="text-xs text-rose-300">{error}</div>}
            <button
              onClick={create}
              className="px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400"
            >
              Create coupon
            </button>
          </div>
        )}

        {/* Coupon list */}
        <div className="max-h-[20rem] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : coupons.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-400">
              <Ticket className="w-6 h-6 mx-auto mb-2 opacity-30" />
              No coupons yet.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {coupons.map((c) => (
                <li key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span
                    className={cn(
                      'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                      c.live
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : c.active
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-gray-500/20 text-gray-300',
                    )}
                  >
                    {c.live ? 'live' : c.active ? 'scheduled' : 'paused'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white flex items-center gap-2">
                      <span className="font-mono text-orange-300">{c.code}</span>
                      <span className="text-[10px] text-gray-400">{KIND_LABEL[c.kind]}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {summary(c)}
                      {c.minOrderUsd > 0 && ` · min $${c.minOrderUsd}`}
                      {c.maxRedemptions > 0 &&
                        ` · ${c.redemptions}/${c.maxRedemptions} used`}
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(c.id)}
                    className={cn(
                      'p-1.5 rounded',
                      c.active
                        ? 'text-emerald-300 hover:bg-emerald-500/20'
                        : 'text-gray-400 hover:bg-white/5',
                    )}
                    title={c.active ? 'Pause' : 'Activate'}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(c.id)}
                    className="p-1.5 rounded hover:bg-rose-500/20 text-rose-300"
                    aria-label="Delete coupon"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Coupon tester */}
      <div className="bg-[#0d1117] border border-white/10 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <Calculator className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-semibold text-gray-300">Coupon tester</span>
        </header>
        <div className="px-4 py-3 grid grid-cols-12 gap-2 items-center">
          <input
            value={testCode}
            onChange={(e) => setTestCode(e.target.value)}
            placeholder="Code"
            className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono uppercase"
          />
          <input
            type="number"
            value={testSubtotal}
            onChange={(e) => setTestSubtotal(e.target.value)}
            placeholder="Subtotal $"
            className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
          />
          <input
            type="number"
            value={testQty}
            onChange={(e) => setTestQty(e.target.value)}
            placeholder="Qty"
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
          />
          <button
            onClick={test}
            className="col-span-4 px-3 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
          >
            Apply coupon
          </button>
          {testError && <div className="col-span-12 text-xs text-rose-300">{testError}</div>}
          {testResult && (
            <div className="col-span-12 text-xs text-emerald-200 flex items-center gap-3">
              <span>
                Discount <span className="font-mono">${testResult.discountUsd.toFixed(2)}</span>
              </span>
              <span>
                Total{' '}
                <span className="font-mono font-bold">
                  ${testResult.totalAfterDiscountUsd.toFixed(2)}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CouponsPanel;

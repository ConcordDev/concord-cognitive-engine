// concord-frontend/app/lenses/dx-platform/billing/page.tsx
//
// DX Platform billing dashboard — A5 polish surface.
//
// Three panels:
//   1) Wallet balance + Stripe top-up CTA (re-uses the existing CC purchase flow).
//   2) Per-day per-macro usage rollup (last 7d) — pulled from `billing.usage`.
//   3) Current-window quota indicator — pulled from `billing.getCurrentQuota`.
//
// All read calls flow through `POST /api/lens/run`. The lens is gated
// by the publicReadDomain entry for `billing` (see server.js:9388).

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LensShell } from "@/components/lens/LensShell";

interface UsageRow {
  ts_day: number;
  domain: string;
  macro_name: string;
  calls: number;
  cost: number;
  duration_ms_total: number;
  errors: number;
}

interface QuotaRow {
  domain: string;
  macroName: string;
  used: number;
  limit: number;
  remaining: number;
  windowStart: number;
}

async function runMacro<T = unknown>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/lens/run", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain, name, input }),
  });
  if (!r.ok) throw new Error(`macro ${domain}.${name} failed: ${r.status}`);
  return r.json() as Promise<T>;
}

export default function BillingDashboardPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [quota, setQuota] = useState<QuotaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [b, u, q] = await Promise.all([
        runMacro<{ ok: boolean; balance?: number }>("billing", "balance"),
        runMacro<{ ok: boolean; rows?: UsageRow[] }>("billing", "usage"),
        runMacro<{ ok: boolean; quotas?: QuotaRow[] }>("billing", "getCurrentQuota"),
      ]);
      setBalance(b.balance ?? null);
      setUsage(u.rows || []);
      setQuota(q.quotas || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Group usage by day for the chart.
  const byDay = new Map<number, { calls: number; cost: number }>();
  for (const r of usage) {
    const cur = byDay.get(r.ts_day) || { calls: 0, cost: 0 };
    cur.calls += r.calls;
    cur.cost += Number(r.cost) || 0;
    byDay.set(r.ts_day, cur);
  }
  const days = [...byDay.entries()].sort((a, b) => b[0] - a[0]);
  const totalCost7d = days.reduce((s, [, v]) => s + v.cost, 0);
  const totalCalls7d = days.reduce((s, [, v]) => s + v.calls, 0);

  // Top macros by cost (last 7d).
  const byMacro = new Map<string, { calls: number; cost: number }>();
  for (const r of usage) {
    const key = `${r.domain}.${r.macro_name}`;
    const cur = byMacro.get(key) || { calls: 0, cost: 0 };
    cur.calls += r.calls;
    cur.cost += Number(r.cost) || 0;
    byMacro.set(key, cur);
  }
  const topMacros = [...byMacro.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 12);

  return (
    <LensShell lensId="dx-platform" asMain={false}>
    <div className="p-6 space-y-6 text-sm">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">DX Platform — Billing</h1>
        <button onClick={refresh} className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {err && <p className="text-red-400">Error: {err}</p>}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="CC balance">
          <div className="text-3xl font-medium">{balance == null ? "—" : balance.toFixed(2)}</div>
          <div className="text-xs text-zinc-500 mt-1">Concord Coin</div>
          <Link href="/lenses/wallet" className="text-xs underline">Top up via Stripe →</Link>
        </Card>
        <Card title="Spend (last 7d)">
          <div className="text-3xl font-medium">{totalCost7d.toFixed(2)}</div>
          <div className="text-xs text-zinc-500 mt-1">{totalCalls7d.toLocaleString()} macro calls</div>
        </Card>
        <Card title="Quota now">
          <div className="text-3xl font-medium">{quota.length}</div>
          <div className="text-xs text-zinc-500 mt-1">macros tracked this minute</div>
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Daily spend</h2>
        <div className="rounded border border-zinc-800 p-3">
          {days.length === 0 ? (
            <p className="text-zinc-500">No macro calls in the last 7 days.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-zinc-400 text-xs">
                  <th className="text-left py-1">Day</th>
                  <th className="text-right">Calls</th>
                  <th className="text-right">Cost (CC)</th>
                </tr>
              </thead>
              <tbody>
                {days.map(([ts_day, v]) => {
                  const date = new Date(ts_day * 86400_000);
                  return (
                    <tr key={ts_day} className="border-t border-zinc-900">
                      <td className="py-1">{date.toISOString().slice(0, 10)}</td>
                      <td className="text-right">{v.calls.toLocaleString()}</td>
                      <td className="text-right">{v.cost.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Top macros (last 7d)</h2>
        <div className="rounded border border-zinc-800 p-3">
          {topMacros.length === 0 ? (
            <p className="text-zinc-500">No data yet.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-zinc-400 text-xs">
                  <th className="text-left py-1">Macro</th>
                  <th className="text-right">Calls</th>
                  <th className="text-right">Cost (CC)</th>
                </tr>
              </thead>
              <tbody>
                {topMacros.map(([k, v]) => (
                  <tr key={k} className="border-t border-zinc-900">
                    <td className="py-1 font-mono">{k}</td>
                    <td className="text-right">{v.calls.toLocaleString()}</td>
                    <td className="text-right">{v.cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Current-minute quota</h2>
        <div className="rounded border border-zinc-800 p-3">
          {quota.length === 0 ? (
            <p className="text-zinc-500">No macros consumed in this minute.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-zinc-400 text-xs">
                  <th className="text-left py-1">Macro</th>
                  <th className="text-right">Used</th>
                  <th className="text-right">Limit</th>
                  <th className="text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {quota.map((q) => (
                  <tr key={`${q.domain}.${q.macroName}`} className="border-t border-zinc-900">
                    <td className="py-1 font-mono">{q.domain}.{q.macroName}</td>
                    <td className="text-right">{q.used}</td>
                    <td className="text-right">{q.limit}</td>
                    <td className={`text-right ${q.remaining < q.limit / 4 ? "text-yellow-400" : ""}`}>{q.remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
    </LensShell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-400">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

'use client';

/**
 * /admin/sandbox — B2B sandbox tenant management. Phase 9.5 #8.
 * Currency: CC. Admin-gated.
 */

import { useEffect, useState } from 'react';

interface Tenant {
  id: number;
  tenant_org: string;
  monthly_cc: number;
  isolation_level: string;
  provisioned_at: number;
  expires_at: number;
  status: string;
  escrow_cc: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function SandboxAdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [form, setForm] = useState({ tenantOrg: '', tenantContact: '', monthlyCc: 5000, durationMonths: 1, isolationLevel: 'strict' });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('sandbox', 'list');
    if (r?.ok) setTenants(r.tenants || []);
  };

  useEffect(() => { void refresh(); }, []);

  const provision = async () => {
    if (!form.tenantOrg) return;
    setStatus('Provisioning…');
    const r = await macro('sandbox', 'provision', form);
    if (r?.ok) {
      setStatus(`✓ Provisioned tenant ${r.tenantId}, ${r.escrowCc} CC escrowed`);
      setForm({ tenantOrg: '', tenantContact: '', monthlyCc: 5000, durationMonths: 1, isolationLevel: 'strict' });
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 5000);
  };

  const kill = async (id: number) => {
    if (!confirm(`Kill tenant ${id}? Substrate is archived but the instance terminates.`)) return;
    const r = await macro('sandbox', 'kill', { tenantId: id });
    if (r?.ok) await refresh();
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Sandbox Tenants</h1>
        <p className="mt-1 text-sm text-zinc-400">
          B2B agent rentals. Each tenant gets a federated peer with isolation flags + escrowed CC. Kill switch terminates with substrate archive.
          {' '}<strong>Currency: CC.</strong>
        </p>
      </header>

      {status && (
        <div className="mb-4 bg-cyan-950/50 border border-cyan-700/50 text-cyan-200 px-3 py-2 rounded-lg text-sm">{status}</div>
      )}

      <section className="mb-6 bg-zinc-900/80 border border-cyan-800/50 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-bold text-cyan-300">Provision Tenant</h2>
        <input
          type="text" placeholder="Org name" value={form.tenantOrg}
          onChange={(e) => setForm({ ...form, tenantOrg: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
        />
        <input
          type="text" placeholder="Contact email" value={form.tenantContact}
          onChange={(e) => setForm({ ...form, tenantContact: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
        />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-zinc-400 block">Monthly CC</label>
            <input
              type="number" min={100} value={form.monthlyCc}
              onChange={(e) => setForm({ ...form, monthlyCc: Number(e.target.value) || 100 })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block">Months</label>
            <input
              type="number" min={1} value={form.durationMonths}
              onChange={(e) => setForm({ ...form, durationMonths: Number(e.target.value) || 1 })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block">Isolation</label>
            <select
              value={form.isolationLevel}
              onChange={(e) => setForm({ ...form, isolationLevel: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100"
            >
              <option value="strict">strict</option>
              <option value="federated">federated</option>
              <option value="open">open</option>
            </select>
          </div>
        </div>
        <button
          type="button" onClick={provision} disabled={!form.tenantOrg}
          className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg"
        >Provision</button>
      </section>

      <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Active Tenants</h2>
      {tenants.length === 0 ? (
        <p className="text-zinc-400 italic">No tenants yet.</p>
      ) : (
        <ul className="space-y-2">
          {tenants.map(t => (
            <li key={t.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-sm flex justify-between">
              <div>
                <p className="text-zinc-100 font-medium">{t.tenant_org}</p>
                <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                  {t.monthly_cc} CC/mo · {t.isolation_level} · escrow {t.escrow_cc} CC · {t.status}
                  · expires {new Date(t.expires_at * 1000).toLocaleDateString()}
                </p>
              </div>
              {t.status === 'provisioned' && (
                <button
                  type="button" onClick={() => kill(t.id)}
                  className="text-rose-400 hover:text-rose-300 text-[11px]"
                >Kill</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

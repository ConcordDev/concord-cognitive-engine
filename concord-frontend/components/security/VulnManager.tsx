'use client';

/**
 * VulnManager — OpenCVE / NVD-shape vulnerability management: an asset
 * inventory, a CVE/vulnerability tracker with severity + remediation
 * status, a risk-posture dashboard, and a live CVE feed. Wires the
 * security.asset-*, security.vuln-*, security.security-dashboard and
 * security.feed macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { cn } from '@/lib/utils';

interface Asset { id: string; name: string; type: string; vendor: string | null; version: string | null; openVulnCount: number }
interface Vuln { id: string; cveId: string | null; title: string; cvss: number | null; severity: string; status: string; kev: boolean; affectedAssetIds: string[] }
interface Dash { assets: number; openVulns: number; bySeverity: Record<string, number>; kev: number; riskScore: number; posture: string }

const SEV_COLOR: Record<string, string> = {
  critical: 'bg-rose-600 text-white', high: 'bg-orange-600 text-white',
  medium: 'bg-amber-600 text-white', low: 'bg-zinc-700 text-zinc-200', unknown: 'bg-zinc-800 text-zinc-400',
};
const STATUSES = ['open', 'triaged', 'in_progress', 'remediated', 'accepted'];

export function VulnManager() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [vulns, setVulns] = useState<Vuln[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [assetForm, setAssetForm] = useState({ name: '', type: 'service', vendor: '' });
  const [vulnForm, setVulnForm] = useState({ cveId: '', title: '', cvss: '' });
  const [statusFilter, setStatusFilter] = useState('');

  const refresh = useCallback(async () => {
    const [al, vl, d] = await Promise.all([
      lensRun('security', 'asset-list', {}),
      lensRun('security', 'vuln-list', statusFilter ? { status: statusFilter } : {}),
      lensRun('security', 'security-dashboard', {}),
    ]);
    setAssets((al.data?.result?.assets as Asset[]) || []);
    setVulns((vl.data?.result?.vulns as Vuln[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, [statusFilter]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addAsset() {
    if (!assetForm.name.trim()) return;
    await lensRun('security', 'asset-add', assetForm);
    setAssetForm({ name: '', type: 'service', vendor: '' });
    await refresh();
  }
  async function addVuln() {
    if (!vulnForm.title.trim()) return;
    await lensRun('security', 'vuln-add', { cveId: vulnForm.cveId.trim(), title: vulnForm.title.trim(), cvss: vulnForm.cvss ? Number(vulnForm.cvss) : undefined });
    setVulnForm({ cveId: '', title: '', cvss: '' });
    await refresh();
  }
  async function setVulnStatus(id: string, status: string) {
    await lensRun('security', 'vuln-update', { id, status });
    await refresh();
  }
  async function del(kind: 'asset' | 'vuln', id: string) {
    await lensRun('security', `${kind}-delete`, { id });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShieldAlert className="w-4 h-4 text-rose-400" />
        <h3 className="text-sm font-bold text-zinc-100">Vulnerability Manager</h3>
        <span className="text-[11px] text-zinc-400">OpenCVE shape</span>
      </div>

      {dash && (
        <div className="grid grid-cols-5 gap-2 mb-3">
          {([['Assets', dash.assets], ['Open', dash.openVulns], ['Critical', dash.bySeverity.critical],
             ['KEV', dash.kev], ['Risk', `${dash.riskScore}`]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}
      {dash && (
        <p className={cn('text-[11px] mb-2', dash.posture === 'at-risk' ? 'text-rose-400' : dash.posture === 'needs-attention' ? 'text-amber-400' : 'text-emerald-400')}>
          Posture: {dash.posture.replace('-', ' ')}
        </p>
      )}

      <div className="mb-3"><LensFeedButton domain="security" label="Live CVE feed (CIRCL CVE-Search)" /></div>

      <div className="grid sm:grid-cols-2 gap-3">
        {/* Assets */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Asset inventory</p>
          <div className="flex gap-1 mb-1.5">
            <input value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="Asset name"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={assetForm.vendor} onChange={e => setAssetForm({ ...assetForm, vendor: e.target.value })} placeholder="vendor"
              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button aria-label="Add" onClick={addAsset} className="px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><Plus className="w-3 h-3" /></button>
          </div>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {assets.map(a => (
              <li key={a.id} className="group flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1">
                <span className="text-xs text-zinc-200 flex-1 truncate">{a.name} <span className="text-zinc-400">{a.vendor || a.type}</span></span>
                {a.openVulnCount > 0 && <span className="text-[10px] text-rose-400">{a.openVulnCount} open</span>}
                <button aria-label="Delete" onClick={() => del('asset', a.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        </div>

        {/* Vulns */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Vulnerabilities</p>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[10px] text-zinc-300">
              <option value="">all</option>
              {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div className="flex gap-1 mb-1.5">
            <input value={vulnForm.cveId} onChange={e => setVulnForm({ ...vulnForm, cveId: e.target.value })} placeholder="CVE"
              className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={vulnForm.title} onChange={e => setVulnForm({ ...vulnForm, title: e.target.value })} placeholder="Title"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={vulnForm.cvss} onChange={e => setVulnForm({ ...vulnForm, cvss: e.target.value })} placeholder="CVSS"
              className="w-12 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button aria-label="Add" onClick={addVuln} className="px-2 rounded bg-rose-600 hover:bg-rose-500 text-white"><Plus className="w-3 h-3" /></button>
          </div>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {vulns.map(v => (
              <li key={v.id} className="group flex items-center gap-1.5 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1">
                <span className={cn('text-[9px] px-1 rounded shrink-0', SEV_COLOR[v.severity])}>{v.cvss ?? '?'}</span>
                <span className="text-xs text-zinc-200 truncate flex-1">{v.cveId ? `${v.cveId} ` : ''}{v.title}</span>
                {v.kev && <span className="text-[9px] text-rose-400">KEV</span>}
                <select value={v.status} onChange={e => setVulnStatus(v.id, e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[9px] text-zinc-300">
                  {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
                <button aria-label="Delete" onClick={() => del('vuln', v.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

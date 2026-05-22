'use client';

/**
 * RecordSharingPanel — FHIR R4 export (full record or immunizations
 * only) + family/proxy access management. Backend:
 * healthcare.fhir-export / proxy-grant / proxy-list / proxy-revoke.
 */

import { useEffect, useState, useCallback } from 'react';
import { Share2, Loader2, Download, Plus, Users, XCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface FhirBundle { resourceType: string; type: string; entry: unknown[] }
interface FhirResult { fhirVersion: string; bundle: FhirBundle; resourceCount: number; scope: string }
interface ProxyGrant {
  id: string; patientId: string; proxyName: string; proxyEmail: string;
  relationship: string; accessLevel: string;
  status: 'active' | 'revoked'; grantedAt: string; revokedAt: string | null; expiresOn: string;
}

const RELATIONSHIPS = ['parent', 'child', 'spouse', 'guardian', 'caregiver', 'sibling', 'other'];
const ACCESS_LEVELS = ['view', 'view_and_message', 'full'];

export function RecordSharingPanel({ patientId }: { patientId: string }) {
  const [grants, setGrants] = useState<ProxyGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<FhirResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ proxyName: '', proxyEmail: '', relationship: 'caregiver', accessLevel: 'view', expiresOn: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('healthcare', 'proxy-list', { patientId });
      if (r.data?.ok) setGrants((r.data.result.grants || []) as ProxyGrant[]);
    } catch (e) { console.error('[RecordSharing] refresh', e); }
    finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function exportFhir(scope: 'full' | 'immunizations') {
    setExporting(true);
    setExportResult(null);
    try {
      const r = await lensRun('healthcare', 'fhir-export', { patientId, scope });
      if (r.data?.ok) {
        const result = r.data.result as FhirResult;
        setExportResult(result);
        // Trigger a download of the FHIR Bundle JSON.
        const blob = new Blob([JSON.stringify(result.bundle, null, 2)], { type: 'application/fhir+json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fhir-${scope}-${patientId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) { console.error('[RecordSharing] export', e); }
    finally { setExporting(false); }
  }

  async function grant() {
    if (!draft.proxyName.trim()) return;
    try {
      const r = await lensRun('healthcare', 'proxy-grant', {
        patientId,
        proxyName: draft.proxyName.trim(),
        proxyEmail: draft.proxyEmail.trim(),
        relationship: draft.relationship,
        accessLevel: draft.accessLevel,
        expiresOn: draft.expiresOn,
      });
      if (r.data?.ok) {
        setDraft({ proxyName: '', proxyEmail: '', relationship: 'caregiver', accessLevel: 'view', expiresOn: '' });
        setAdding(false);
        await refresh();
      }
    } catch (e) { console.error('[RecordSharing] grant', e); }
  }

  async function revoke(id: string) {
    try {
      const r = await lensRun('healthcare', 'proxy-revoke', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[RecordSharing] revoke', e); }
  }

  return (
    <div className="space-y-4">
      {/* FHIR export */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Share2 className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Health-record sharing (FHIR R4)</span>
        </header>
        <div className="p-3 space-y-2">
          <p className="text-xs text-gray-500">Export a FHIR R4 Bundle for import into any conformant system (other EHRs, immunization registries, personal health records).</p>
          <div className="flex items-center gap-2">
            <button onClick={() => exportFhir('full')} disabled={exporting} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1">
              {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}Export full record
            </button>
            <button onClick={() => exportFhir('immunizations')} disabled={exporting} className="px-3 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-40 inline-flex items-center gap-1">
              <Download className="w-3 h-3" />Immunizations only
            </button>
          </div>
          {exportResult && (
            <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-2.5 py-1.5">
              Exported FHIR {exportResult.fhirVersion} Bundle — {exportResult.resourceCount} resource{exportResult.resourceCount === 1 ? '' : 's'} ({exportResult.scope}). File downloaded.
            </div>
          )}
        </div>
      </div>

      {/* Proxy access */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Family / proxy access</span>
          <span className="text-[10px] text-gray-500">{grants.filter(g => g.status === 'active').length} active</span>
          <button onClick={() => setAdding(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Grant access
          </button>
        </header>

        {adding && (
          <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
            <input value={draft.proxyName} onChange={e => setDraft({ ...draft, proxyName: e.target.value })} placeholder="Proxy name *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={draft.proxyEmail} onChange={e => setDraft({ ...draft, proxyEmail: e.target.value })} placeholder="Proxy email" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <select value={draft.relationship} onChange={e => setDraft({ ...draft, relationship: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={draft.accessLevel} onChange={e => setDraft({ ...draft, accessLevel: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
            <input type="date" value={draft.expiresOn} onChange={e => setDraft({ ...draft, expiresOn: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={grant} className="col-span-4 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Grant</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : grants.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500">No proxy access granted.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {grants.map(g => (
              <li key={g.id} className="px-4 py-2.5 flex items-center gap-3">
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', g.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/20 text-gray-400')}>{g.status}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{g.proxyName} <span className="text-[10px] text-gray-500">{g.relationship} · {g.accessLevel.replace(/_/g, ' ')}</span></div>
                  <div className="text-[10px] text-gray-500 truncate">
                    {g.proxyEmail || 'no email'} · granted {g.grantedAt.slice(0, 10)}
                    {g.expiresOn && ` · expires ${g.expiresOn}`}
                  </div>
                </div>
                {g.status === 'active' && (
                  <button onClick={() => revoke(g.id)} className="px-2 py-0.5 text-[10px] rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 inline-flex items-center gap-0.5"><XCircle className="w-3 h-3" />Revoke</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RecordSharingPanel;

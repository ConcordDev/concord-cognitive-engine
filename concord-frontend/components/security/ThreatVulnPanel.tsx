'use client';

/**
 * ThreatVulnPanel — bespoke threat-risk + vulnerability scanner
 * for the security lens. Wires security.threatAssessment +
 * security.vulnerabilityScan against editable threat and system
 * configurations.
 *
 *   • Threats: editable rows (name/type/probability/impact/vulns/
 *     controls) → per-threat risk score, residual risk, mitigations
 *   • Systems: editable rows (hostname/firewall/encryption/mfa/
 *     defaultCreds) → findings list with severity grouping
 *   • Save-as-DTU captures inputs + both reports
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldAlert, Loader2, Plus, Trash2, Server } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Threat { name: string; type: string; probability: number; impact: number; vulnerabilities: number; activeControls: number; totalControls: number }
interface SysConfig { hostname: string; firewall: boolean; encryption: boolean; mfa: boolean; defaultCredentials: boolean }
interface ThreatAssessment { name?: string; riskScore?: number; riskLevel?: string; controlEffectiveness?: number; residualRisk?: number; mitigations?: string[] }
interface ThreatResult { assessments?: ThreatAssessment[] }
interface ScanFinding { system: string; type: string; severity: 'critical' | 'high' | 'medium' | 'low'; detail: string }
interface ScanResult { findings?: ScanFinding[]; totalFindings?: number; bySeverity?: Record<string, number> }

async function callSec<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('security', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

export function ThreatVulnPanel() {
  const [threats, setThreats] = useState<Threat[]>([{ name: '', type: '', probability: 3, impact: 3, vulnerabilities: 0, activeControls: 0, totalControls: 0 }]);
  const [systems, setSystems] = useState<SysConfig[]>([{ hostname: '', firewall: true, encryption: true, mfa: true, defaultCredentials: false }]);
  const [threatResult, setThreatResult] = useState<ThreatResult | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const analyze = useMutation({
    mutationFn: async () => {
      const ts = threats.filter((t) => t.name.trim()).map((t) => ({
        name: t.name, type: t.type, probability: t.probability, impact: t.impact,
        vulnerabilities: Array.from({ length: t.vulnerabilities }, (_, i) => `vuln-${i + 1}`),
        controls: Array.from({ length: t.totalControls }, (_, i) => ({ status: i < t.activeControls ? 'active' : 'inactive' })),
      }));
      const sys = systems.filter((s) => s.hostname.trim()).map((s) => ({
        name: s.hostname,
        configurations: { firewall: s.firewall, encryption: s.encryption, mfa: s.mfa, defaultCredentials: s.defaultCredentials },
      }));
      const [t, v] = await Promise.all([
        callSec<ThreatResult>('threatAssessment', { artifact: { data: { threats: ts } } }),
        callSec<ScanResult>('vulnerabilityScan', { artifact: { data: { systems: sys } } }),
      ]);
      setThreatResult(t);
      setScanResult(v);
      return { t, v };
    },
  });

  const addThreat = () => setThreats((ts) => [...ts, { name: '', type: '', probability: 3, impact: 3, vulnerabilities: 0, activeControls: 0, totalControls: 0 }]);
  const updateThreat = <K extends keyof Threat>(i: number, key: K, value: Threat[K]) =>
    setThreats((ts) => ts.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)));
  const removeThreat = (i: number) => setThreats((ts) => ts.filter((_, idx) => idx !== i));

  const addSystem = () => setSystems((ss) => [...ss, { hostname: '', firewall: true, encryption: true, mfa: true, defaultCredentials: false }]);
  const updateSystem = <K extends keyof SysConfig>(i: number, key: K, value: SysConfig[K]) =>
    setSystems((ss) => ss.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  const removeSystem = (i: number) => setSystems((ss) => ss.filter((_, idx) => idx !== i));

  const riskColour = (level?: string) => {
    if (level === 'critical') return 'bg-rose-500/20 text-rose-200';
    if (level === 'high') return 'bg-orange-500/20 text-orange-200';
    if (level === 'medium') return 'bg-amber-500/20 text-amber-200';
    return 'bg-emerald-500/20 text-emerald-200';
  };

  const sevColour = (sev: string) => {
    if (sev === 'critical') return 'border-rose-500/40 bg-rose-500/10 text-rose-200';
    if (sev === 'high') return 'border-orange-500/40 bg-orange-500/10 text-orange-200';
    if (sev === 'medium') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    return 'border-zinc-700 bg-zinc-800/40 text-zinc-300';
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-red-400" />
          <h2 className="text-sm font-semibold text-white">Threat + vulnerability scanner</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">security.threatAssessment + vulnerabilityScan</span>
        </div>
        {(threatResult || scanResult) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-security-threats-vulns"
            title={`Security — ${threatResult?.assessments?.length ?? 0} threats · ${scanResult?.totalFindings ?? 0} findings`}
            content={`Threats:\n${(threatResult?.assessments || []).map((a) => `  ${a.name} (${a.riskLevel}) — risk ${a.riskScore}, residual ${a.residualRisk}, controls ${a.controlEffectiveness}%\n    Mitigations: ${a.mitigations?.join(' / ') || 'none'}`).join('\n')}\n\nVulnerability findings (${scanResult?.totalFindings ?? 0}):\n${(scanResult?.findings || []).map((f) => `  [${f.severity.toUpperCase()}] ${f.system} — ${f.detail}`).join('\n')}`}
            extraTags={['security', 'risk', 'vulnerability']}
            rawData={{ threats, systems, threatResult, scanResult }}
          />
        )}
      </header>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Threats</div>
        <div className="grid grid-cols-[1fr_90px_60px_60px_60px_90px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-500">
          <span>Name</span><span>Type</span><span>Prob</span><span>Impact</span><span>Vulns</span><span>Controls</span><span></span>
        </div>
        {threats.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_60px_60px_60px_90px_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Threat name" value={t.name} onChange={(e) => updateThreat(i, 'name', e.target.value)} />
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Type" value={t.type} onChange={(e) => updateThreat(i, 'type', e.target.value)} />
            <input type="number" min={1} max={5} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={t.probability} onChange={(e) => updateThreat(i, 'probability', Math.max(1, Math.min(5, Number(e.target.value) || 3)))} />
            <input type="number" min={1} max={5} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={t.impact} onChange={(e) => updateThreat(i, 'impact', Math.max(1, Math.min(5, Number(e.target.value) || 3)))} />
            <input type="number" min={0} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={t.vulnerabilities} onChange={(e) => updateThreat(i, 'vulnerabilities', Math.max(0, Number(e.target.value) || 0))} />
            <div className="flex items-center gap-1">
              <input type="number" min={0} className="w-12 rounded border border-zinc-800 bg-zinc-950 px-1 py-1 text-xs text-white font-mono" value={t.activeControls} onChange={(e) => updateThreat(i, 'activeControls', Math.max(0, Number(e.target.value) || 0))} />
              <span className="text-[10px] text-zinc-500">/</span>
              <input type="number" min={0} className="w-12 rounded border border-zinc-800 bg-zinc-950 px-1 py-1 text-xs text-white font-mono" value={t.totalControls} onChange={(e) => updateThreat(i, 'totalControls', Math.max(0, Number(e.target.value) || 0))} />
            </div>
            <button type="button" onClick={() => removeThreat(i)} className="rounded border border-zinc-800 text-xs text-zinc-500 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <button type="button" onClick={addThreat} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-red-500/40 hover:text-red-200"><Plus className="h-3 w-3" />Add threat</button>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Systems (vulnerability config)</div>
        <div className="grid grid-cols-[1fr_50px_50px_50px_70px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-500">
          <span>Hostname</span><span>FW</span><span>Enc</span><span>MFA</span><span>Def cred</span><span></span>
        </div>
        {systems.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_50px_50px_50px_70px_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="hostname" value={s.hostname} onChange={(e) => updateSystem(i, 'hostname', e.target.value)} />
            <label className="flex items-center justify-center rounded border border-zinc-800 bg-zinc-950"><input type="checkbox" checked={s.firewall} onChange={(e) => updateSystem(i, 'firewall', e.target.checked)} /></label>
            <label className="flex items-center justify-center rounded border border-zinc-800 bg-zinc-950"><input type="checkbox" checked={s.encryption} onChange={(e) => updateSystem(i, 'encryption', e.target.checked)} /></label>
            <label className="flex items-center justify-center rounded border border-zinc-800 bg-zinc-950"><input type="checkbox" checked={s.mfa} onChange={(e) => updateSystem(i, 'mfa', e.target.checked)} /></label>
            <label className="flex items-center justify-center rounded border border-zinc-800 bg-zinc-950"><input type="checkbox" checked={s.defaultCredentials} onChange={(e) => updateSystem(i, 'defaultCredentials', e.target.checked)} /></label>
            <button type="button" onClick={() => removeSystem(i)} className="rounded border border-zinc-800 text-xs text-zinc-500 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <button type="button" onClick={addSystem} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-red-500/40 hover:text-red-200"><Plus className="h-3 w-3" />Add system</button>
      </div>

      <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-mono text-red-200 hover:bg-red-500/25 disabled:opacity-50">
        {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
        Analyze
      </button>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analysis failed.</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><ShieldAlert className="h-3 w-3" />Threat risk</div>
          {!threatResult && <div className="text-[11px] text-zinc-500">Analyze to score.</div>}
          {threatResult?.assessments && (
            <div className="space-y-2">
              {threatResult.assessments.map((a, i) => (
                <div key={i} className="rounded border border-red-500/15 bg-zinc-950/40 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-100">{a.name}</span>
                    <span className={`rounded px-2 py-0.5 text-[9px] uppercase ${riskColour(a.riskLevel)}`}>{a.riskLevel}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] font-mono text-zinc-300">
                    <span>risk {a.riskScore}</span>
                    <span>resid {a.residualRisk}</span>
                    <span>ctrl {a.controlEffectiveness}%</span>
                  </div>
                  {a.mitigations && a.mitigations.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-zinc-400">
                      {a.mitigations.slice(0, 3).map((m, j) => <li key={j}>{m}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Server className="h-3 w-3" />Vulnerability findings</div>
          {!scanResult && <div className="text-[11px] text-zinc-500">Analyze to scan.</div>}
          {scanResult && (
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-zinc-400">{scanResult.totalFindings} findings</span>
                {scanResult.bySeverity && Object.entries(scanResult.bySeverity).map(([sev, n]) => (
                  <span key={sev} className={`rounded px-1.5 py-0.5 ${sevColour(sev)}`}>{sev}: {n}</span>
                ))}
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {scanResult.findings?.map((f, i) => (
                  <div key={i} className={`rounded border px-2 py-1 ${sevColour(f.severity)}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px]">{f.system}</span>
                      <span className="text-[9px] uppercase">{f.severity}</span>
                    </div>
                    <div className="text-[10px]">{f.detail}</div>
                  </div>
                ))}
                {scanResult.findings?.length === 0 && <div className="text-emerald-300">No findings — all systems clean.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

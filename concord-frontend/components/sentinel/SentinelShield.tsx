'use client';


/**
 * SentinelShield — the live threat board. Surfaces shield.status /
 * shield.threats / shield.metrics, runs an on-demand content/hash scan,
 * and lets the operator promote any threat into a triage case via
 * sentinel.triage.open (bridging the read-only feed to the case workflow).
 *
 * Also wires the Fortify Suite — shield.surgeon (per-threat reverse-
 * engineering + neutralization procedure), shield.guardian (per-threat
 * firewall-rule generation), shield.prophet (family-level variant
 * prediction), shield.sweep (full lattice sweep), shield.report (submit a
 * threat to the collective lattice), and the read-only shield.firewall /
 * shield.predictions feeds those three write into. These macros existed in
 * server/lib/concord-shield.js with real depth (attack-vector analysis,
 * neutralization playbooks, iptables-style rule synthesis, technique-
 * escalation prediction) but had zero UI caller before this pass.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Shield, Loader2, ScanLine, AlertOctagon, FolderPlus, Check,
  Stethoscope, Radar, Send, Zap, ChevronDown, ChevronUp, Flame,
} from 'lucide-react';

interface ShieldStatus {
  securityScore?: number;
  shieldStatus?: {
    initialized?: boolean;
    tools?: Record<string, unknown> | string[];
    threatIndexSize?: number;
    knownGoodHashes?: number;
  };
}
interface ShieldThreat {
  id: string;
  severity?: string;
  subtype?: string;
  description?: string;
  detectedAt?: string;
  vector?: string;
}
interface SurgeonAnalysis {
  attackVector: string;
  techniques: string[];
  severityAssessment: { level: string; score: number };
  neutralizationProcedure: { immediate: string[]; shortTerm: string[]; longTerm: string[] };
}
// shield.guardian (per-threat) returns raw rule-text strings; shield.firewall
// (the global feed) returns FIREWALL_RULE DTUs with a `.rule` field. Both
// shapes are real — normalize for display rather than assuming one.
type GuardianRule = string | { rule?: string; id?: string; [k: string]: unknown };
function ruleText(r: GuardianRule): string {
  return typeof r === 'string' ? r : (r.rule ?? JSON.stringify(r));
}
function ruleKey(r: GuardianRule, i: number): string | number {
  return typeof r === 'string' ? i : (r.id ?? i);
}
interface Investigation {
  loading: boolean;
  surgeon?: SurgeonAnalysis | null;
  guardianRules?: GuardianRule[];
  error?: string;
}
interface ProphetPrediction {
  id?: string;
  family?: string;
  predictedVariant?: string;
  confidence?: number;
  preemptiveRule?: string;
}
interface SweepResult {
  sweepId: string;
  status: string;
  scanCount: number;
  cleanCount: number;
  threatsFound: { dtuId: string; threat?: string; severity?: string }[];
  durationMs: number;
  toolsUsed: string[];
}

const SEV_TONE: Record<string, string> = {
  critical: 'bg-rose-900/50 text-rose-200',
  high: 'bg-orange-900/50 text-orange-200',
  medium: 'bg-amber-900/50 text-amber-200',
  low: 'bg-sky-900/50 text-sky-200',
  unknown: 'bg-zinc-800 text-zinc-400',
};

const REPORT_SUBTYPES = ['exploit', 'ransomware', 'trojan', 'rootkit', 'phishing', 'worm', 'spyware'] as const;

export function SentinelShield({ onTriageOpened }: { onTriageOpened?: () => void }) {
  const [status, setStatus] = useState<ShieldStatus | null>(null);
  const [threats, setThreats] = useState<ShieldThreat[]>([]);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [scanInput, setScanInput] = useState('');
  const [scanResult, setScanResult] = useState<unknown>(null);
  const [scanning, setScanning] = useState(false);

  // Fortify Suite — investigate (surgeon+guardian) per threat.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [investigations, setInvestigations] = useState<Record<string, Investigation>>({});

  // Fortify Suite — prophet family prediction + the read-only feeds it and
  // Guardian populate.
  const [family, setFamily] = useState('');
  const [predicting, setPredicting] = useState(false);
  const [predictions, setPredictions] = useState<ProphetPrediction[]>([]);
  const [firewallRules, setFirewallRules] = useState<GuardianRule[]>([]);
  const [fortifyOpen, setFortifyOpen] = useState(false);
  const [prophetMsg, setProphetMsg] = useState<string | null>(null);

  // Fortify Suite — report a threat to the collective lattice.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportSubtype, setReportSubtype] = useState<typeof REPORT_SUBTYPES[number]>('exploit');
  const [reportSeverity, setReportSeverity] = useState(5);
  const [reportDesc, setReportDesc] = useState('');
  const [reportHash, setReportHash] = useState('');
  const [reportVector, setReportVector] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportResult, setReportResult] = useState<{ status?: string; message?: string } | null>(null);

  // Fortify Suite — full lattice sweep.
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, tRes, mRes] = await Promise.all([
      lensRun('shield', 'status', {}),
      lensRun('shield', 'threats', { limit: 100 }),
      lensRun('shield', 'metrics', {}),
    ]);
    setStatus((sRes.data?.result ?? sRes.data) as ShieldStatus);
    setThreats(((tRes.data?.result as { threats?: ShieldThreat[] } | null)?.threats) ?? []);
    setMetrics((mRes.data?.result ?? mRes.data) as Record<string, unknown>);
    setLoading(false);
  }, []);

  const loadFortify = useCallback(async () => {
    const [fRes, pRes] = await Promise.all([
      lensRun('shield', 'firewall', { limit: 50 }),
      lensRun('shield', 'predictions', { limit: 20 }),
    ]);
    const fResult = (fRes.data?.result ?? fRes.data) as { rules?: GuardianRule[] } | null;
    const pResult = (pRes.data?.result ?? pRes.data) as { predictions?: ProphetPrediction[] } | null;
    setFirewallRules(fResult?.rules ?? []);
    setPredictions(pResult?.predictions ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadFortify(); }, [loadFortify]);

  const knownFamilies = useMemo(
    () => [...new Set(threats.map((t) => t.subtype).filter((s): s is string => Boolean(s)))],
    [threats],
  );

  async function runScan() {
    if (!scanInput.trim()) return;
    setScanning(true);
    setScanResult(null);
    // 64-hex strings are treated as hashes, anything else as content.
    const isHash = /^[a-f0-9]{32,64}$/i.test(scanInput.trim());
    const input = isHash ? { hash: scanInput.trim() } : { content: scanInput };
    const r = await lensRun('shield', 'scan', input);
    setScanResult(r.data?.result ?? r.data);
    setScanning(false);
    await load();
  }

  async function openTriage(t: ShieldThreat) {
    setBusy(true);
    const r = await lensRun('sentinel', 'triage.open', {
      threatId: t.id,
      title: t.description || t.subtype || `Threat ${t.id}`,
      severity: t.severity || 'unknown',
      description: t.description || '',
      vector: t.vector || null,
    });
    if (r.data?.ok) {
      setOpened((prev) => new Set(prev).add(t.id));
      onTriageOpened?.();
    }
    setBusy(false);
  }

  async function investigate(t: ShieldThreat) {
    if (expanded === t.id) { setExpanded(null); return; }
    setExpanded(t.id);
    if (investigations[t.id]) return; // already fetched
    setInvestigations((prev) => ({ ...prev, [t.id]: { loading: true } }));
    const [surgeonRes, guardianRes] = await Promise.all([
      lensRun('shield', 'surgeon', { threatId: t.id }),
      lensRun('shield', 'guardian', { threatId: t.id }),
    ]);
    const surgeonOk = surgeonRes.data?.ok !== false;
    const guardianOk = guardianRes.data?.ok !== false;
    const sResult = (surgeonRes.data?.result ?? surgeonRes.data) as { analysis?: SurgeonAnalysis } | null;
    const gResult = (guardianRes.data?.result ?? guardianRes.data) as { rules?: GuardianRule[] } | null;
    setInvestigations((prev) => ({
      ...prev,
      [t.id]: {
        loading: false,
        surgeon: surgeonOk ? sResult?.analysis ?? null : null,
        guardianRules: guardianOk ? gResult?.rules ?? [] : [],
        error: !surgeonOk ? (surgeonRes.data?.error as string) : !guardianOk ? (guardianRes.data?.error as string) : undefined,
      },
    }));
    if (guardianOk && (gResult?.rules?.length ?? 0) > 0) await loadFortify();
  }

  async function runProphet() {
    if (!family.trim()) return;
    setPredicting(true);
    setProphetMsg(null);
    const r = await lensRun('shield', 'prophet', { family: family.trim() });
    const result = (r.data?.result ?? r.data) as { reason?: string; samplesAnalyzed?: number } | null;
    if (result?.reason === 'insufficient_data') {
      setProphetMsg(`Not enough "${family.trim()}" samples yet — Prophet needs ≥2 detected variants to project a trend.`);
    } else if (r.data?.ok === false) {
      setProphetMsg(r.data?.error || 'Prophet analysis failed.');
    }
    await loadFortify();
    setPredicting(false);
  }

  async function submitReport() {
    if (!reportDesc.trim()) return;
    setReportBusy(true);
    setReportResult(null);
    const r = await lensRun('shield', 'report', {
      subtype: reportSubtype,
      severity: reportSeverity,
      description: reportDesc.trim(),
      fileHash: reportHash.trim() || undefined,
      vector: reportVector.trim() || undefined,
    });
    const result = (r.data?.result ?? r.data) as { status?: string; message?: string } | null;
    setReportResult(result);
    setReportBusy(false);
    if (r.data?.ok) {
      setReportDesc('');
      setReportHash('');
      setReportVector('');
      await load();
    }
  }

  async function runSweep() {
    setSweeping(true);
    setSweepResult(null);
    const r = await lensRun('shield', 'sweep', { depth: 'standard' });
    const result = (r.data?.result ?? r.data) as { sweep?: SweepResult } | null;
    setSweepResult(result?.sweep ?? null);
    setSweeping(false);
    await Promise.all([load(), loadFortify()]);
  }

  const score = status?.securityScore;
  const ss = status?.shieldStatus;

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="flex items-center gap-2 px-3 py-6 text-xs text-blue-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading shield state…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Security score" value={score != null ? String(score) : '—'} />
            <Stat label="Initialized" value={ss?.initialized ? 'yes' : 'no'} />
            <Stat label="Threat index" value={ss?.threatIndexSize ?? 0} />
            <Stat label="Active threats" value={threats.length} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={sweeping}
              onClick={runSweep}
              className="inline-flex items-center gap-1.5 rounded bg-orange-700/60 px-3 py-1.5 text-xs font-medium text-orange-50 hover:bg-orange-700/80 disabled:opacity-40"
            >
              {sweeping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Run full sweep
            </button>
            <button
              onClick={() => setReportOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded bg-blue-950/40 px-3 py-1.5 text-xs text-blue-300 hover:text-blue-100"
            >
              <Send className="h-3.5 w-3.5" /> Report a threat
            </button>
            {sweepResult && (
              <span className="text-[11px] text-blue-500">
                Sweep {sweepResult.status}: {sweepResult.scanCount} scanned, {sweepResult.threatsFound.length} found, {sweepResult.cleanCount} clean ({sweepResult.durationMs}ms)
              </span>
            )}
          </div>

          {reportOpen && (
            <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
                <Send className="h-4 w-4" /> Report a threat to the collective lattice
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={reportSubtype}
                  onChange={(e) => setReportSubtype(e.target.value as typeof REPORT_SUBTYPES[number])}
                  className="rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
                  aria-label="Threat subtype"
                >
                  {REPORT_SUBTYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <label className="flex items-center gap-2 text-xs text-blue-400">
                  Severity
                  <input
                    type="range" min={1} max={10} value={reportSeverity}
                    onChange={(e) => setReportSeverity(Number(e.target.value))}
                    className="flex-1"
                    aria-label="Severity"
                  />
                  <span className="w-4 text-right font-mono text-blue-200">{reportSeverity}</span>
                </label>
                <input
                  value={reportVector}
                  onChange={(e) => setReportVector(e.target.value)}
                  placeholder="attack vector (e.g. email attachment)"
                  className="rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 text-xs text-blue-100 focus:border-blue-500 focus:outline-none sm:col-span-2"
                />
                <input
                  value={reportHash}
                  onChange={(e) => setReportHash(e.target.value)}
                  placeholder="SHA-256 hash (optional)"
                  className="rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 font-mono text-xs text-blue-100 focus:border-blue-500 focus:outline-none sm:col-span-2"
                />
                <textarea
                  value={reportDesc}
                  onChange={(e) => setReportDesc(e.target.value)}
                  placeholder="Describe what you observed…"
                  className="h-16 w-full rounded border border-blue-900/40 bg-black/40 p-2 text-xs text-blue-100 focus:border-blue-500 focus:outline-none sm:col-span-2"
                />
              </div>
              <button
                disabled={reportBusy || !reportDesc.trim()}
                onClick={submitReport}
                className="mt-2 inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                {reportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Submit report
              </button>
              {reportResult && (
                <p className="mt-2 text-[11px] text-blue-400">
                  {reportResult.status === 'known_threat' ? 'Already known — ' : 'New threat added — '}
                  {reportResult.message}
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
              <ScanLine className="h-4 w-4" /> On-demand scan
            </h3>
            <textarea
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder="Paste file content, or a SHA-256 / MD5 hash, to scan…"
              className="h-20 w-full rounded border border-blue-900/40 bg-black/40 p-2 font-mono text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
              aria-label="Scan input"
            />
            <button
              disabled={scanning || !scanInput.trim()}
              onClick={runScan}
              className="mt-2 inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
              Run scan
            </button>
            {scanResult != null && (
              <pre className="mt-3 max-h-56 overflow-auto rounded border border-blue-900/40 bg-black/60 p-2 font-mono text-[10px] text-blue-300">
                {JSON.stringify(scanResult, null, 2)}
              </pre>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-blue-200">
              Threat board ({threats.length})
            </h3>
            {threats.length === 0 ? (
              <p className="rounded border border-blue-900/30 bg-blue-950/10 px-4 py-6 text-center text-xs text-blue-600">
                No active threats. Shield is observing.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {threats.map((t) => {
                  const isOpen = opened.has(t.id);
                  const isExpanded = expanded === t.id;
                  const inv = investigations[t.id];
                  return (
                    <li key={t.id} className="rounded border border-blue-900/30 bg-blue-950/10 text-xs">
                      <div className="flex items-center gap-2.5 px-3 py-2">
                        <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                        <span className="font-mono text-[10px] text-blue-500">{t.id}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${SEV_TONE[t.severity ?? 'unknown'] ?? SEV_TONE.unknown}`}>
                          {t.severity ?? 'unknown'}
                        </span>
                        {t.subtype && <span className="text-blue-400">{t.subtype}</span>}
                        {t.description && <span className="truncate text-blue-100">{t.description}</span>}
                        <button
                          onClick={() => investigate(t)}
                          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-blue-950/50 px-2 py-0.5 text-[10px] text-blue-300 hover:bg-blue-900/50"
                        >
                          <Stethoscope className="h-3 w-3" />
                          Investigate
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                        <button
                          disabled={busy || isOpen}
                          onClick={() => openTriage(t)}
                          className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] ${
                            isOpen
                              ? 'bg-emerald-900/40 text-emerald-300'
                              : 'bg-blue-700/50 text-blue-100 hover:bg-blue-700/70'
                          } disabled:opacity-60`}
                        >
                          {isOpen ? <Check className="h-3 w-3" /> : <FolderPlus className="h-3 w-3" />}
                          {isOpen ? 'Triaged' : 'Triage'}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-blue-900/30 px-3 py-2.5">
                          {inv?.loading ? (
                            <p className="flex items-center gap-2 text-[11px] text-blue-600">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running Surgeon + Guardian…
                            </p>
                          ) : inv?.error ? (
                            <p className="text-[11px] text-rose-400">{inv.error}</p>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-blue-700">
                                  <Stethoscope className="h-3 w-3" /> Surgeon — neutralization procedure
                                </p>
                                {inv?.surgeon ? (
                                  <div className="space-y-1 text-[11px] text-blue-300">
                                    <p>Vector: <span className="text-blue-100">{inv.surgeon.attackVector}</span></p>
                                    <p>Assessment: <span className="text-blue-100">{inv.surgeon.severityAssessment.level}</span></p>
                                    {(['immediate', 'shortTerm', 'longTerm'] as const).map((phase) => (
                                      inv.surgeon!.neutralizationProcedure[phase].length > 0 && (
                                        <div key={phase}>
                                          <span className="capitalize text-blue-500">{phase.replace('Term', ' term')}:</span>
                                          <ul className="ml-3 list-disc text-blue-200">
                                            {inv.surgeon!.neutralizationProcedure[phase].map((step, i) => (
                                              <li key={i}>{step}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-blue-700">No analysis available.</p>
                                )}
                              </div>
                              <div>
                                <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-blue-700">
                                  <Flame className="h-3 w-3" /> Guardian — generated rules
                                </p>
                                {inv?.guardianRules && inv.guardianRules.length > 0 ? (
                                  <ul className="space-y-1">
                                    {inv.guardianRules.map((r, i) => (
                                      <li key={ruleKey(r, i)} className="rounded border border-blue-900/20 bg-black/40 px-2 py-1 font-mono text-[10px] text-blue-300">
                                        {ruleText(r)}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-[11px] text-blue-700">No firewall rule generated (unknown vector).</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <details
            className="rounded border border-blue-900/30 bg-blue-950/10"
            open={fortifyOpen}
            onToggle={(e) => setFortifyOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer px-3 py-2 text-xs text-blue-400">
              <Radar className="mr-1 inline h-3 w-3" /> Fortifications — Prophet predictions + Guardian rules
            </summary>
            <div className="space-y-3 border-t border-blue-900/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  list="sentinel-threat-families"
                  value={family}
                  onChange={(e) => setFamily(e.target.value)}
                  placeholder="threat family (e.g. ransomware)"
                  className="rounded border border-blue-900/40 bg-black/40 px-2 py-1 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
                  aria-label="Threat family"
                />
                <datalist id="sentinel-threat-families">
                  {knownFamilies.map((f) => <option key={f} value={f} />)}
                </datalist>
                <button
                  disabled={predicting || !family.trim()}
                  onClick={runProphet}
                  className="inline-flex items-center gap-1.5 rounded bg-blue-700/50 px-2.5 py-1 text-xs text-blue-100 hover:bg-blue-700/70 disabled:opacity-40"
                >
                  {predicting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
                  Run Prophet
                </button>
              </div>
              {prophetMsg && <p className="text-[11px] text-blue-500">{prophetMsg}</p>}

              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-blue-700">
                  Predictions ({predictions.length})
                </p>
                {predictions.length === 0 ? (
                  <p className="text-[11px] text-blue-700">
                    No predictions yet — Prophet needs ≥2 samples of a family to project the next variant.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {predictions.map((p, i) => (
                      <li key={p.id ?? i} className="rounded border border-blue-900/20 bg-black/30 px-2 py-1 text-[11px]">
                        <span className="rounded bg-blue-900/40 px-1 py-0.5 text-[9px] text-blue-300">{p.family}</span>
                        <span className="ml-2 text-blue-200">{p.predictedVariant}</span>
                        {p.confidence != null && (
                          <span className="ml-2 text-[9px] text-blue-600">{Math.round(p.confidence * 100)}% confidence</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-blue-700">
                  Active firewall rules ({firewallRules.length})
                </p>
                {firewallRules.length === 0 ? (
                  <p className="text-[11px] text-blue-700">No rules generated yet — investigate a threat to run Guardian.</p>
                ) : (
                  <ul className="space-y-1">
                    {firewallRules.map((r, i) => (
                      <li key={ruleKey(r, i)} className="rounded border border-blue-900/20 bg-black/40 px-2 py-1 font-mono text-[10px] text-blue-300">
                        {ruleText(r)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </details>

          {metrics && (
            <details className="rounded border border-blue-900/30 bg-blue-950/10">
              <summary className="cursor-pointer px-3 py-2 text-xs text-blue-400">
                <Shield className="mr-1 inline h-3 w-3" /> Shield metrics
              </summary>
              <pre className="overflow-auto p-3 font-mono text-[11px] text-blue-500">
                {JSON.stringify(metrics, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-3 text-blue-200">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-blue-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </div>
  );
}

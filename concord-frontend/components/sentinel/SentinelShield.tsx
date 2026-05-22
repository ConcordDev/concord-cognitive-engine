'use client';


/**
 * SentinelShield — the live threat board. Surfaces shield.status /
 * shield.threats / shield.metrics, runs an on-demand content/hash scan,
 * and lets the operator promote any threat into a triage case via
 * sentinel.triage.open (bridging the read-only feed to the case workflow).
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Shield, Loader2, ScanLine, AlertOctagon, FolderPlus, Check,
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

const SEV_TONE: Record<string, string> = {
  critical: 'bg-rose-900/50 text-rose-200',
  high: 'bg-orange-900/50 text-orange-200',
  medium: 'bg-amber-900/50 text-amber-200',
  low: 'bg-sky-900/50 text-sky-200',
  unknown: 'bg-zinc-800 text-zinc-400',
};

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

  useEffect(() => { load(); }, [load]);

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
                  return (
                    <li key={t.id} className="flex items-center gap-2.5 rounded border border-blue-900/30 bg-blue-950/10 px-3 py-2 text-xs">
                      <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                      <span className="font-mono text-[10px] text-blue-500">{t.id}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${SEV_TONE[t.severity ?? 'unknown'] ?? SEV_TONE.unknown}`}>
                        {t.severity ?? 'unknown'}
                      </span>
                      {t.subtype && <span className="text-blue-400">{t.subtype}</span>}
                      {t.description && <span className="truncate text-blue-100">{t.description}</span>}
                      <button
                        disabled={busy || isOpen}
                        onClick={() => openTriage(t)}
                        className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] ${
                          isOpen
                            ? 'bg-emerald-900/40 text-emerald-300'
                            : 'bg-blue-700/50 text-blue-100 hover:bg-blue-700/70'
                        } disabled:opacity-60`}
                      >
                        {isOpen ? <Check className="h-3 w-3" /> : <FolderPlus className="h-3 w-3" />}
                        {isOpen ? 'Triaged' : 'Triage'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

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

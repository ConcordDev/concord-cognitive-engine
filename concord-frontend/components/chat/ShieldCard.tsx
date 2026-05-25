'use client';

/**
 * ShieldCard — Security scan results rendered inline in the chat rail.
 *
 * When Shield processes a scan, check, or sweep via the chat rail,
 * results appear as a card showing:
 *   - Scan status (clean / threat found)
 *   - Threat details (subtype, severity, signatures, vector)
 *   - Neutralization steps
 *   - Security score breakdown
 *   - Firewall rules generated
 *   - Prophet predictions
 *
 * All through chat. No separate app. No settings menu.
 */

import { useState } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Activity,
  Flame,
  Bug,
  Lock,
  Eye,
  Zap,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────

interface ThreatHash {
  md5?: string;
  sha256?: string;
  ssdeep?: string;
}

interface ThreatSignatures {
  clamav?: string;
  yara?: string[];
  snort?: string;
  suricata?: string;
}

interface ThreatDTU {
  id: string;
  subtype: string;
  severity: number;
  hash?: ThreatHash;
  signatures?: ThreatSignatures;
  vector?: string;
  behavior?: string[];
  affected?: string[];
  neutralization?: string;
  first_seen?: string;
  times_detected?: number;
}

interface ScanResult {
  ok: boolean;
  clean: boolean;
  cached?: boolean;
  threat?: ThreatDTU;
  hash?: ThreatHash;
}

interface SecurityScore {
  score: number;
  grade: string;
  breakdown: {
    scanCoverage: number;
    threatRatio: number;
    firewallCoverage: number;
    recencyScore: number;
    toolCoverage: number;
  };
  stats: {
    totalScanned: number;
    threatsDetected: number;
    cleanFiles: number;
    firewallRules: number;
    recentThreats: number;
  };
  recommendations: string[];
}

interface SweepResult {
  sweepId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  threatsFound: { dtuId: string; severity?: number }[];
  cleanCount: number;
  scanCount: number;
  toolsUsed: string[];
}

interface ShieldCardProps {
  type: 'scan' | 'score' | 'sweep' | 'threats' | 'prediction';
  scanResult?: ScanResult;
  securityScore?: SecurityScore;
  sweepResult?: SweepResult;
  threats?: ThreatDTU[];
  predictions?: { family: string; predictedVariant: string; confidence: number }[];
}

// ── Severity Config ──────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { color: string; label: string; icon: typeof Flame }> = {
  critical: { color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'Critical', icon: Flame },
  high: { color: 'text-orange-400 bg-orange-500/10 border-orange-500/20', label: 'High', icon: AlertTriangle },
  medium: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Medium', icon: Bug },
  low: { color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'Low', icon: Eye },
};

function getSeverityLevel(severity: number): string {
  if (severity >= 9) return 'critical';
  if (severity >= 7) return 'high';
  if (severity >= 4) return 'medium';
  return 'low';
}

const GRADE_COLORS: Record<string, string> = {
  A: 'text-green-400 bg-green-500/10 border-green-500/20',
  B: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  C: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  D: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  F: 'text-red-400 bg-red-500/10 border-red-500/20',
};

// ── Component ────────────────────────────────────────────────────

export default function ShieldCard({
  type,
  scanResult,
  securityScore,
  sweepResult,
  threats,
  predictions,
}: ShieldCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-zinc-900/60 backdrop-blur-sm overflow-hidden border-zinc-700/50">
      {/* Scan Result */}
      {type === 'scan' && scanResult && (
        <ScanResultCard result={scanResult} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      )}

      {/* Security Score */}
      {type === 'score' && securityScore && (
        <SecurityScoreCard score={securityScore} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      )}

      {/* Sweep Result */}
      {type === 'sweep' && sweepResult && (
        <SweepResultCard sweep={sweepResult} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      )}

      {/* Threat Feed */}
      {type === 'threats' && threats && (
        <ThreatFeedCard threats={threats} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      )}

      {/* Predictions */}
      {type === 'prediction' && predictions && (
        <PredictionsCard predictions={predictions} />
      )}
    </div>
  );
}

// ── Scan Result Sub-component ────────────────────────────────────

function ScanResultCard({
  result,
  expanded,
  onToggle,
}: {
  result: ScanResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isClean = result.clean;
  const threat = result.threat;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
        <div className={cn(
          'p-2 rounded-md border',
          isClean
            ? 'bg-green-500/10 text-green-400 border-green-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        )}>
          {isClean ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-100">
            {isClean ? 'File is Clean' : `Threat Detected: ${threat?.subtype?.toUpperCase() || 'UNKNOWN'}`}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            {!isClean && threat && (
              <SeverityBadge severity={threat.severity} />
            )}
            {result.cached && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                Cached
              </span>
            )}
          </div>
        </div>
        {!isClean && (
          <button onClick={onToggle} className="p-1 rounded hover:bg-zinc-800 text-zinc-400">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Hash info */}
      {result.hash?.sha256 && (
        <div className="px-4 py-2 text-xs text-zinc-400 border-b border-zinc-800/30 font-mono">
          SHA256: {result.hash.sha256.slice(0, 32)}...
        </div>
      )}

      {/* Expanded threat details */}
      {!isClean && threat && expanded && (
        <div className="px-4 py-3 space-y-3 text-xs">
          {/* Signatures */}
          {(threat.signatures?.clamav || (threat.signatures?.yara?.length ?? 0) > 0) && (
            <div>
              <span className="text-zinc-400 font-medium">Signatures:</span>
              <div className="mt-1 space-y-1">
                {threat.signatures?.clamav && (
                  <div className="text-zinc-400">ClamAV: <span className="text-zinc-300">{threat.signatures.clamav}</span></div>
                )}
                {threat.signatures?.yara?.map((rule, i) => (
                  <div key={i} className="text-zinc-400">YARA: <span className="text-zinc-300">{rule}</span></div>
                ))}
              </div>
            </div>
          )}

          {/* Vector */}
          {threat.vector && (
            <div>
              <span className="text-zinc-400 font-medium">Attack Vector:</span>
              <span className="ml-2 text-zinc-300">{threat.vector}</span>
            </div>
          )}

          {/* Behavior */}
          {threat.behavior && threat.behavior.length > 0 && (
            <div>
              <span className="text-zinc-400 font-medium">Behavior:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {threat.behavior.map((b, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Neutralization */}
          {threat.neutralization && (
            <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
              <span className="text-zinc-400 font-medium">Neutralization:</span>
              <p className="mt-1 text-zinc-300 leading-relaxed">{threat.neutralization}</p>
            </div>
          )}

          {/* Detection stats */}
          <div className="flex items-center gap-4 text-zinc-400 pt-1 border-t border-zinc-800/30">
            {threat.times_detected && (
              <span>Detected {threat.times_detected} time{threat.times_detected !== 1 ? 's' : ''}</span>
            )}
            {threat.first_seen && (
              <span>First seen: {new Date(threat.first_seen).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      )}

      {/* Clean confirmation */}
      {isClean && (
        <div className="px-4 py-2 text-xs text-green-400 bg-green-500/5 border-t border-green-500/10 flex items-center gap-2">
          <CheckCircle2 className="w-3 h-3" />
          No threats detected. File verified against the threat lattice.
        </div>
      )}
    </>
  );
}

// ── Security Score Sub-component ─────────────────────────────────

function SecurityScoreCard({
  score,
  expanded,
  onToggle,
}: {
  score: SecurityScore;
  expanded: boolean;
  onToggle: () => void;
}) {
  const gradeColor = GRADE_COLORS[score.grade] || GRADE_COLORS.C;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
        <div className={cn('p-2 rounded-md border', gradeColor)}>
          <Shield className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-100">Security Score</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={cn('text-lg font-bold', gradeColor.split(' ')[0])}>
              {score.score}/100
            </span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded border font-medium', gradeColor)}>
              Grade {score.grade}
            </span>
          </div>
        </div>
        <button onClick={onToggle} className="p-1 rounded hover:bg-zinc-800 text-zinc-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="px-4 py-3 space-y-3 text-xs">
          {/* Breakdown bars */}
          <div className="space-y-2">
            <ScoreBar label="Scan Coverage" value={score.breakdown.scanCoverage} />
            <ScoreBar label="Threat Ratio" value={score.breakdown.threatRatio} />
            <ScoreBar label="Firewall Coverage" value={score.breakdown.firewallCoverage} />
            <ScoreBar label="Recency Score" value={score.breakdown.recencyScore} />
            <ScoreBar label="Tool Coverage" value={score.breakdown.toolCoverage} />
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-zinc-400 pt-2 border-t border-zinc-800/30">
            <span>{score.stats.totalScanned} scanned</span>
            <span>{score.stats.threatsDetected} threats</span>
            <span>{score.stats.firewallRules} rules</span>
          </div>

          {/* Recommendations */}
          {score.recommendations.length > 0 && (
            <div className="p-2 rounded bg-amber-500/5 border border-amber-500/10">
              <span className="text-amber-400 font-medium">Recommendations:</span>
              <ul className="mt-1 space-y-1">
                {score.recommendations.map((rec, i) => (
                  <li key={i} className="text-zinc-400 flex items-start gap-1">
                    <Zap className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 75 ? 'bg-green-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex justify-between text-zinc-400 mb-0.5">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ── Sweep Result Sub-component ───────────────────────────────────

function SweepResultCard({
  sweep,
  expanded,
  onToggle,
}: {
  sweep: SweepResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasThreats = sweep.threatsFound.length > 0;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
        <div className={cn(
          'p-2 rounded-md border',
          hasThreats
            ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
            : 'bg-green-500/10 text-green-400 border-green-500/20'
        )}>
          <Activity className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-100">
            System Sweep {sweep.status === 'complete' ? 'Complete' : 'In Progress'}
          </h3>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-400">
            <span>{sweep.scanCount} scanned</span>
            <span className="text-zinc-600">|</span>
            <span>{sweep.cleanCount} clean</span>
            {hasThreats && (
              <>
                <span className="text-zinc-600">|</span>
                <span className="text-red-400">{sweep.threatsFound.length} threats</span>
              </>
            )}
          </div>
        </div>
        <button onClick={onToggle} className="p-1 rounded hover:bg-zinc-800 text-zinc-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="px-4 py-3 space-y-2 text-xs">
          {sweep.toolsUsed.length > 0 && (
            <div className="text-zinc-400">
              Tools used: {sweep.toolsUsed.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')}
            </div>
          )}
          {sweep.durationMs && (
            <div className="text-zinc-400">
              Duration: {(sweep.durationMs / 1000).toFixed(1)}s
            </div>
          )}
          {hasThreats && (
            <div className="space-y-1 pt-1 border-t border-zinc-800/30">
              {sweep.threatsFound.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-zinc-400">
                  <XCircle className="w-3 h-3 text-red-400" />
                  <span className="font-mono">{t.dtuId.slice(0, 20)}</span>
                  {t.severity && <SeverityBadge severity={t.severity} />}
                </div>
              ))}
            </div>
          )}
          {!hasThreats && (
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle2 className="w-3 h-3" />
              No threats found. Your system is clean.
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Threat Feed Sub-component ────────────────────────────────────

function ThreatFeedCard({
  threats,
  expanded,
  onToggle,
}: {
  threats: ThreatDTU[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
        <div className="p-2 rounded-md border bg-red-500/10 text-red-400 border-red-500/20">
          <ShieldAlert className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-100">Threat Intelligence Feed</h3>
          <span className="text-xs text-zinc-400">{threats.length} recent threats</span>
        </div>
        <button onClick={onToggle} className="p-1 rounded hover:bg-zinc-800 text-zinc-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      <div className="divide-y divide-zinc-800/30">
        {threats.slice(0, expanded ? 20 : 5).map((threat, i) => {
          const level = getSeverityLevel(threat.severity);
          const config = SEVERITY_CONFIG[level];
          const Icon = config.icon;
          return (
            <div key={i} className="px-4 py-2 flex items-center gap-3 text-xs">
              <Icon className={cn('w-3 h-3 shrink-0', config.color.split(' ')[0])} />
              <span className={cn('px-1.5 py-0.5 rounded border font-medium uppercase', config.color)}>
                {threat.subtype}
              </span>
              <span className="text-zinc-400 truncate flex-1">
                {threat.hash?.sha256?.slice(0, 16) || threat.id?.slice(0, 16)}
              </span>
              <span className="text-zinc-600 tabular-nums shrink-0">
                {threat.severity}/10
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Predictions Sub-component ────────────────────────────────────

function PredictionsCard({
  predictions,
}: {
  predictions: { family: string; predictedVariant: string; confidence: number }[];
}) {
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
        <div className="p-2 rounded-md border bg-purple-500/10 text-purple-400 border-purple-500/20">
          <Lock className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-100">Prophet Predictions</h3>
          <span className="text-xs text-zinc-400">{predictions.length} predicted variants</span>
        </div>
      </div>

      <div className="divide-y divide-zinc-800/30">
        {predictions.slice(0, 10).map((pred, i) => (
          <div key={i} className="px-4 py-2 flex items-center gap-3 text-xs">
            <Zap className="w-3 h-3 text-purple-400 shrink-0" />
            <span className="text-zinc-300 capitalize font-medium">{pred.family}</span>
            <span className="text-zinc-600">→</span>
            <span className="text-zinc-400 truncate flex-1">{pred.predictedVariant}</span>
            <span className="text-zinc-600 tabular-nums shrink-0">
              {Math.round(pred.confidence * 100)}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Shared: Severity Badge ───────────────────────────────────────

function SeverityBadge({ severity }: { severity: number }) {
  const level = getSeverityLevel(severity);
  const config = SEVERITY_CONFIG[level];
  return (
    <span className={cn('text-xs px-1.5 py-0.5 rounded border font-medium', config.color)}>
      {config.label} ({severity}/10)
    </span>
  );
}

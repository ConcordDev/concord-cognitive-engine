'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Requirement {
  label: string;
  current: number;
  target: number;
  unit: string;
}

interface LearningPath {
  id: string;
  name: string;
  domain: string;
  domainColor: string;
  description: string;
  requirements: Requirement[];
  complete: boolean;
  claimed: boolean;
}

interface Certificate {
  id: string;
  pathId: string;
  pathName: string;
  holder: string;
  issuedDate: string;
  metrics: { dtus: number; citations: number; passRate: number };
  verificationHash: string;
  blockchainTx: string;
}

// ── Backend wire shapes (education.paths-list / education.certificates-list) ─────

interface PathsListResult {
  paths?: Array<{
    id?: string;
    title?: string;
    description?: string;
    steps?: Array<{
      courseTitle?: string;
      totalLessons?: number;
      completedLessons?: number;
    }>;
    totalSteps?: number;
    completedSteps?: number;
    progressPct?: number;
    complete?: boolean;
  }>;
}

interface CertificatesListResult {
  certificates?: Array<{
    id?: string;
    courseId?: string;
    courseTitle?: string;
    issuedAt?: string;
    institution?: string;
    instructor?: string;
    verificationCode?: string;
  }>;
}

const DOMAIN_COLOR = '#3b82f6';

function mapPath(p: NonNullable<PathsListResult['paths']>[number]): LearningPath {
  const totalSteps = p.totalSteps ?? p.steps?.length ?? 0;
  const completedSteps = p.completedSteps ?? 0;
  return {
    id: String(p.id ?? ''),
    name: String(p.title ?? 'Untitled path'),
    domain: 'Learning',
    domainColor: DOMAIN_COLOR,
    description: String(p.description ?? ''),
    // Map real per-step progress into the requirements checklist shape.
    requirements: [
      { label: 'Course Completions', current: completedSteps, target: totalSteps, unit: 'courses' },
    ],
    complete: Boolean(p.complete),
    claimed: false,
  };
}

function mapCertificate(c: NonNullable<CertificatesListResult['certificates']>[number]): Certificate {
  return {
    id: String(c.id ?? ''),
    pathId: String(c.courseId ?? ''),
    pathName: String(c.courseTitle ?? 'Certificate'),
    holder: String(c.instructor ?? c.institution ?? ''),
    issuedDate: c.issuedAt ? String(c.issuedAt).slice(0, 10) : '',
    metrics: { dtus: 0, citations: 0, passRate: 0 },
    verificationHash: String(c.verificationCode ?? ''),
    blockchainTx: '',
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function progressPercent(reqs: Requirement[]): number {
  const total = reqs.reduce((acc, r) => {
    const pct = Math.min(r.current / r.target, 1);
    return acc + pct;
  }, 0);
  return Math.round((total / reqs.length) * 100);
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
        active
          ? 'bg-white/10 text-white border-b-2 border-cyan-400'
          : 'text-white/50 hover:text-white/80'
      }`}
    >
      {label}
    </button>
  );
}

function DomainBadge({ domain, color }: { domain: string; color: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}
    >
      {domain}
    </span>
  );
}

function RequirementRow({ req }: { req: Requirement }) {
  const met = req.current >= req.target;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={met ? 'text-emerald-400' : 'text-red-400'}>{met ? '\u2713' : '\u2717'}</span>
      <span className="text-white/70">{req.label}:</span>
      <span className={met ? 'text-emerald-300' : 'text-white'}>
        {req.current}
        {req.unit === '%' ? '%' : ''} / {req.target}
        {req.unit === '%' ? '%' : ` ${req.unit}`}
      </span>
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const barColor =
    percent >= 100 ? 'bg-emerald-500' : percent >= 60 ? 'bg-cyan-500' : 'bg-amber-500';
  return (
    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

function PathCard({
  path,
  onClaim,
}: {
  path: LearningPath;
  onClaim: (id: string) => void;
}) {
  const pct = progressPercent(path.requirements);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-white">{path.name}</h3>
            <DomainBadge domain={path.domain} color={path.domainColor} />
          </div>
          <p className="text-sm text-white/50 max-w-xl">{path.description}</p>
        </div>
        <span className="text-sm font-mono text-white/40">{pct}%</span>
      </div>

      {/* Progress bar */}
      <ProgressBar percent={pct} />

      {/* Requirements checklist */}
      <div className="space-y-1">
        {path.requirements.map((req, i) => (
          <RequirementRow key={i} req={req} />
        ))}
      </div>

      {/* Claim button */}
      {path.complete && !path.claimed && (
        <button
          onClick={() => onClaim(path.id)}
          className="mt-2 px-5 py-2 rounded-lg text-sm font-semibold text-black bg-emerald-400 hover:bg-emerald-300 transition-colors shadow-[0_0_16px_rgba(52,211,153,0.4)]"
        >
          Claim Certificate
        </button>
      )}
      {path.claimed && (
        <span className="inline-block mt-2 px-4 py-1.5 rounded-lg text-sm font-medium text-emerald-300 border border-emerald-500/30 bg-emerald-500/10">
          Claimed
        </span>
      )}
    </div>
  );
}

function CertificateCard({ cert }: { cert: Certificate }) {
  const hasMetrics = cert.metrics.dtus > 0 || cert.metrics.citations > 0 || cert.metrics.passRate > 0;
  return (
    <div
      className="relative rounded-xl p-[1px] overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #3b82f6, #a855f7, #ec4899)',
      }}
    >
      <div className="rounded-xl bg-black/90 backdrop-blur-md p-6 space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{cert.pathName}</h3>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Verified
          </span>
        </div>

        {/* Holder */}
        {cert.holder && (
          <div className="text-sm text-white/60">
            Holder:{' '}
            <span className="text-cyan-300 font-mono">{cert.holder}</span>
          </div>
        )}

        {/* Issued date */}
        {cert.issuedDate && (
          <div className="text-sm text-white/60">
            Issued: <span className="text-white/80">{cert.issuedDate}</span>
          </div>
        )}

        {/* Metrics (only when the backend supplies real metrics) */}
        {hasMetrics && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-white/5 border border-white/10 p-3 text-center">
              <div className="text-xl font-bold text-cyan-300">{cert.metrics.dtus}</div>
              <div className="text-xs text-white/40 mt-0.5">DTUs</div>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/10 p-3 text-center">
              <div className="text-xl font-bold text-purple-300">{cert.metrics.citations}</div>
              <div className="text-xs text-white/40 mt-0.5">Citations</div>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/10 p-3 text-center">
              <div className="text-xl font-bold text-emerald-300">{cert.metrics.passRate}%</div>
              <div className="text-xs text-white/40 mt-0.5">Pass Rate</div>
            </div>
          </div>
        )}

        {/* Verification code */}
        {cert.verificationHash && (
          <div className="text-xs text-white/40 font-mono break-all">
            Verification: {cert.verificationHash}
          </div>
        )}

        {/* Blockchain badge (only when a real on-chain tx exists) */}
        {cert.blockchainTx && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <svg
              className="w-4 h-4 text-indigo-400 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <span className="text-xs text-indigo-300">
              Notarized on-chain &mdash;{' '}
              <span className="font-mono text-indigo-400">{cert.blockchainTx}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

type TabId = 'paths' | 'certificates' | 'verify';

export default function CertificatePanel() {
  const [activeTab, setActiveTab] = useState<TabId>('paths');
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Load real learning paths + certificates ────────────────────────
  const loadEducation = useCallback(async () => {
    setLoading(true);
    try {
      const [pathsRes, certsRes] = await Promise.all([
        lensRun<PathsListResult>('education', 'paths-list', {}),
        lensRun<CertificatesListResult>('education', 'certificates-list', {}),
      ]);
      const realPaths = pathsRes.data.ok ? pathsRes.data.result?.paths ?? [] : [];
      setPaths(realPaths.map(mapPath));
      const realCerts = certsRes.data.ok ? certsRes.data.result?.certificates ?? [] : [];
      setCertificates(realCerts.map(mapCertificate));
    } catch {
      // Honest empty state — never fabricate.
      setPaths([]);
      setCertificates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEducation();
  }, [loadEducation]);

  // Verify tab state
  const [verifyHash, setVerifyHash] = useState('');
  const [verifyResult, setVerifyResult] = useState<
    | { found: true; holder: string; pathName: string; issuedDate: string; metrics: { dtus: number; citations: number; passRate: number } }
    | { found: false }
    | null
  >(null);

  // Derived
  const claimedIds = useMemo(
    () => new Set(certificates.map((c) => c.pathId)),
    [certificates],
  );

  const handleClaim = async (pathId: string) => {
    const path = paths.find((p) => p.id === pathId);
    if (!path || !path.complete) return;
    // Issue a real certificate via the education domain, then re-read state.
    try {
      await lensRun('education', 'certificates-issue', { courseId: pathId });
    } catch {
      /* refetch surfaces success/failure honestly */
    }
    await loadEducation();
    setActiveTab('certificates');
  };

  const handleVerify = () => {
    // Verify against the real loaded certificates by verification code.
    // No dedicated verify-by-hash macro exists; this checks the user's own
    // issued certificates rather than fabricating a verification database.
    const normalized = verifyHash.trim().toLowerCase().replace(/\u2026/g, '');
    const match = certificates.find(
      (c) => c.verificationHash.toLowerCase().replace(/\u2026/g, '') === normalized,
    );
    if (match) {
      setVerifyResult({
        found: true,
        holder: match.holder,
        pathName: match.pathName,
        issuedDate: match.issuedDate,
        metrics: match.metrics,
      });
    } else {
      setVerifyResult({ found: false });
    }
  };

  // Displayable paths with claimed status synced
  const displayPaths = useMemo(
    () =>
      paths.map((p) => ({
        ...p,
        claimed: p.claimed || claimedIds.has(p.id),
      })),
    [paths, claimedIds],
  );

  return (
    <div className="w-full rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 text-white overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-white/10">
        <h2 className="text-xl font-bold tracking-tight">Education Certificates</h2>
        <p className="text-sm text-white/40 mt-1">
          Earn verifiable credentials through structured learning paths
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-3 border-b border-white/10">
        <TabButton label="Learning Paths" active={activeTab === 'paths'} onClick={() => setActiveTab('paths')} />
        <TabButton label="My Certificates" active={activeTab === 'certificates'} onClick={() => setActiveTab('certificates')} />
        <TabButton label="Verify" active={activeTab === 'verify'} onClick={() => setActiveTab('verify')} />
      </div>

      {/* Content */}
      <div className="p-6">
        {/* ── Learning Paths ────────────────────────────────────────────── */}
        {activeTab === 'paths' && (
          <div className="space-y-4">
            {loading ? (
              <p className="text-sm text-white/30 py-12 text-center">Loading learning paths…</p>
            ) : displayPaths.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3 opacity-30">&#128218;</div>
                <p className="text-white/40 text-sm">
                  No learning paths yet. Create one to start earning credentials.
                </p>
              </div>
            ) : null}
            {displayPaths.map((path) => (
              <PathCard key={path.id} path={path} onClaim={handleClaim} />
            ))}
          </div>
        )}

        {/* ── My Certificates ───────────────────────────────────────────── */}
        {activeTab === 'certificates' && (
          <div className="space-y-5">
            {certificates.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3 opacity-30">&#127891;</div>
                <p className="text-white/40 text-sm">
                  No certificates yet. Complete a learning path to earn one.
                </p>
              </div>
            ) : (
              certificates.map((cert) => (
                <CertificateCard key={cert.id} cert={cert} />
              ))
            )}

            {/* Show unclaimed paths as placeholders */}
            {paths.filter((p) => !p.claimed && !claimedIds.has(p.id)).length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-white/30 mb-3 uppercase tracking-wider">
                  Unclaimed Paths
                </h4>
                <div className="space-y-2">
                  {paths
                    .filter((p) => !p.claimed && !claimedIds.has(p.id))
                    .map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-4 py-3 rounded-lg border border-white/5 bg-white/[0.02]"
                      >
                        <div className="flex items-center gap-2">
                          <DomainBadge domain={p.domain} color={p.domainColor} />
                          <span className="text-sm text-white/40">{p.name}</span>
                        </div>
                        <span className="text-xs text-white/20">
                          {progressPercent(p.requirements)}% complete
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Verify ────────────────────────────────────────────────────── */}
        {activeTab === 'verify' && (
          <div className="max-w-lg mx-auto space-y-6">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Certificate Hash
              </label>
              <input
                type="text"
                value={verifyHash}
                onChange={(e) => {
                  setVerifyHash(e.target.value);
                  setVerifyResult(null);
                }}
                placeholder="e.g. 0x7a3fe91b"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
              />
            </div>

            <button
              onClick={handleVerify}
              disabled={!verifyHash.trim()}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Verify Certificate
            </button>

            {verifyResult && (
              <div className="mt-4">
                {verifyResult.found ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-sm font-semibold text-emerald-300">
                        Certificate Verified
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-white/40">Holder:</span>{' '}
                        <span className="text-cyan-300 font-mono">
                          {verifyResult.holder}
                        </span>
                      </div>
                      <div>
                        <span className="text-white/40">Path:</span>{' '}
                        <span className="text-white/80">{verifyResult.pathName}</span>
                      </div>
                      <div>
                        <span className="text-white/40">Issued:</span>{' '}
                        <span className="text-white/80">{verifyResult.issuedDate}</span>
                      </div>
                      <div>
                        <span className="text-white/40">Pass Rate:</span>{' '}
                        <span className="text-emerald-300">
                          {verifyResult.metrics.passRate}%
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-white/40">
                        DTUs: <span className="text-cyan-300">{verifyResult.metrics.dtus}</span>
                      </span>
                      <span className="text-white/40">
                        Citations:{' '}
                        <span className="text-purple-300">{verifyResult.metrics.citations}</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-400" />
                      <span className="text-sm font-semibold text-red-300">
                        Certificate Not Found
                      </span>
                    </div>
                    <p className="text-sm text-white/40 mt-2">
                      No certificate matches the provided hash. Double-check the value
                      and try again.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

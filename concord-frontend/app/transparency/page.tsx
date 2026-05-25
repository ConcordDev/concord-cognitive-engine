'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Shield,
  FileText,
  Users,
  Bell,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Scale,
  Eye,
  EyeOff,
  BarChart3,
  Loader2,
} from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();

interface TransparencyReport {
  year: number;
  totalRequests: number;
  byType: Record<string, number>;
  byResponse: Record<string, number>;
  usersAffected: number;
  usersNotified: number;
  gagOrders: number;
  concordCommitments: {
    noVoluntarySurveillance: boolean;
    noBulkDataAccess: boolean;
    noBackdoors: boolean;
    minimumDataProvided: boolean;
    challengedOverbroadRequests: boolean;
  };
  publishedAt: string;
}

const TYPE_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  subpoena: { label: 'Subpoenas', icon: FileText },
  court_order: { label: 'Court Orders', icon: Scale },
  warrant: { label: 'Warrants', icon: Shield },
  national_security: { label: 'National Security', icon: Lock },
};

const RESPONSE_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'text-yellow-400' },
  complied: { label: 'Complied', color: 'text-zinc-400' },
  challenged: { label: 'Challenged', color: 'text-neon-cyan' },
  partial: { label: 'Partial Compliance', color: 'text-orange-400' },
  rejected: { label: 'Rejected', color: 'text-red-400' },
};

const COMMITMENT_LABELS: Record<string, { label: string; description: string }> = {
  noVoluntarySurveillance: {
    label: 'No Voluntary Surveillance',
    description: 'We do not voluntarily provide data to any government agency.',
  },
  noBulkDataAccess: {
    label: 'No Bulk Data Access',
    description: 'We do not grant bulk or programmatic access to user data.',
  },
  noBackdoors: {
    label: 'No Backdoors',
    description: 'We do not build backdoors into our systems for any party.',
  },
  minimumDataProvided: {
    label: 'Minimum Data Provided',
    description: 'When legally compelled, we provide only the narrowest data required.',
  },
  challengedOverbroadRequests: {
    label: 'Challenged Overbroad Requests',
    description: 'We challenge any request we believe is overly broad or legally deficient.',
  },
};

function StatCard({
  label,
  value,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: number | string;
  icon: typeof FileText;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-lattice-border bg-lattice-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accent ? 'text-neon-cyan' : 'text-zinc-400'}`} />
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-bold ${accent ? 'text-neon-cyan' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}

export default function TransparencyPage() {
  const { data, isLoading, isError } = useQuery<{ ok: boolean; report: TransparencyReport }>({
    queryKey: ['transparency', CURRENT_YEAR],
    queryFn: async () => {
      const { api } = await import('@/lib/api/client');
      const response = await api.get(`/api/transparency/${CURRENT_YEAR}`);
      return response.data;
    },
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  const report = data?.report;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      {/* Header */}
      <header className="mb-10">
        <div className="mb-4 flex items-center gap-3">
          <Shield className="h-7 w-7 text-neon-cyan" />
          <h1 className="text-3xl font-bold text-white">Transparency Report</h1>
        </div>
        <p className="max-w-2xl text-zinc-400 leading-relaxed">
          Concord publishes annual transparency reports detailing every law enforcement request
          we receive. We believe our users deserve to know how often governments seek their data
          and how we respond.
        </p>
      </header>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
          <span className="ml-3 text-zinc-400">Loading report...</span>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-400" />
          <p className="text-red-300">
            Unable to load the transparency report. Please try again later.
          </p>
        </div>
      )}

      {/* Report content */}
      {report && (
        <>
          {/* Year badge */}
          <div className="mb-8 flex items-center gap-3">
            <span className="rounded-lg bg-neon-cyan/10 px-3 py-1 text-sm font-semibold text-neon-cyan">
              {report.year}
            </span>
            {report.publishedAt && (
              <span className="text-xs text-zinc-400">
                Published {report.publishedAt.split(' ')[0]}
              </span>
            )}
          </div>

          {/* Overview stats */}
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-zinc-300">Overview</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Total Requests"
                value={report.totalRequests}
                icon={BarChart3}
                accent
              />
              <StatCard
                label="Users Affected"
                value={report.usersAffected}
                icon={Users}
              />
              <StatCard
                label="Users Notified"
                value={report.usersNotified}
                icon={Bell}
              />
              <StatCard
                label="Gag Orders"
                value={report.gagOrders}
                icon={EyeOff}
              />
            </div>
          </section>

          {/* By type */}
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-zinc-300">Requests by Type</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Object.entries(report.byType).map(([key, count]) => {
                const meta = TYPE_LABELS[key] || { label: key, icon: FileText };
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-lattice-border bg-lattice-surface p-5"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <meta.icon className="h-4 w-4 text-zinc-400" />
                      <span className="text-xs font-medium text-zinc-400">{meta.label}</span>
                    </div>
                    <p className="text-xl font-bold text-white">{count}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* By response */}
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-zinc-300">Requests by Response</h2>
            <div className="space-y-2">
              {Object.entries(report.byResponse).map(([key, count]) => {
                const meta = RESPONSE_LABELS[key] || { label: key, color: 'text-zinc-400' };
                const pct =
                  report.totalRequests > 0
                    ? Math.round((count / report.totalRequests) * 100)
                    : 0;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-4 rounded-lg border border-lattice-border bg-lattice-surface px-5 py-3"
                  >
                    <span className={`w-40 text-sm font-medium ${meta.color}`}>
                      {meta.label}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-neon-cyan/60 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-12 text-right text-sm font-bold text-white">{count}</span>
                    <span className="w-12 text-right text-xs text-zinc-400">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Concord Commitments */}
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-zinc-300">Our Commitments</h2>
            <p className="mb-6 text-sm text-zinc-400">
              These are standing commitments Concord makes to every user, reaffirmed annually.
            </p>
            <div className="space-y-3">
              {Object.entries(report.concordCommitments).map(([key, value]) => {
                const meta = COMMITMENT_LABELS[key] || {
                  label: key,
                  description: '',
                };
                return (
                  <div
                    key={key}
                    className="flex items-start gap-4 rounded-xl border border-lattice-border bg-lattice-surface p-5"
                  >
                    <CheckCircle2
                      className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                        value ? 'text-green-400' : 'text-red-400'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-white">{meta.label}</p>
                      <p className="mt-1 text-xs text-zinc-400">{meta.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Footer note */}
          <footer className="rounded-xl border border-lattice-border bg-lattice-surface p-6 text-sm text-zinc-400">
            <div className="flex items-start gap-3">
              <Eye className="mt-0.5 h-4 w-4 flex-shrink-0 text-zinc-600" />
              <div>
                <p className="mb-2">
                  This report covers all law enforcement requests received between January 1 and
                  December 31, {report.year}. National security requests are reported to the extent
                  permitted by law. Where gag orders prevent user notification, we disclose only the
                  aggregate count.
                </p>
                <p>
                  Questions about this report may be directed to{' '}
                  <span className="text-neon-cyan">legal@concordengine.com</span>.
                </p>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

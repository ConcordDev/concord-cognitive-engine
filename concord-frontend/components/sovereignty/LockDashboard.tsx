'use client';

import { Shield, Lock, AlertTriangle, CheckCircle, Ban } from 'lucide-react';

interface SovereigntyStatus {
  overallLock: number;
  invariants: {
    id: string;
    name: string;
    status: 'enforced' | 'warning' | 'violated';
    description: string;
  }[];
  lastAudit?: string;
}

interface LockDashboardProps {
  status?: SovereigntyStatus;
  compact?: boolean;
}

const defaultInvariants = [
  { id: '1', name: 'NO_TELEMETRY', status: 'enforced' as const, description: 'No external data collection' },
  { id: '2', name: 'NO_ADS', status: 'enforced' as const, description: 'No advertisements served' },
  { id: '3', name: 'NO_RESALE', status: 'enforced' as const, description: 'Data never sold to third parties' },
  { id: '4', name: 'LOCAL_FIRST', status: 'enforced' as const, description: 'Local processing prioritized' },
  { id: '5', name: 'OWNER_CONTROL', status: 'enforced' as const, description: 'Owner maintains full control' },
];

export function LockDashboard({ status, compact = false }: LockDashboardProps) {
  const lockPercentage = status?.overallLock ?? 70;
  const invariants = status?.invariants ?? defaultInvariants;

  const getStatusIcon = (s: 'enforced' | 'warning' | 'violated') => {
    switch (s) {
      case 'enforced':
        return <CheckCircle className="w-4 h-4 text-sovereignty-locked" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-sovereignty-warning" />;
      case 'violated':
        return <Ban className="w-4 h-4 text-sovereignty-danger" />;
    }
  };

  const getStatusColor = (s: 'enforced' | 'warning' | 'violated') => {
    switch (s) {
      case 'enforced':
        return 'text-sovereignty-locked';
      case 'warning':
        return 'text-sovereignty-warning';
      case 'violated':
        return 'text-sovereignty-danger';
    }
  };

  if (compact) {
    return (
      <div className="sovereignty-lock">
        <Lock className="w-4 h-4" />
        <span className="font-mono text-sm">{lockPercentage}%</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main Lock Indicator */}
      <div className="lens-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-sovereignty-locked" />
            <span className="font-semibold">Sovereignty Lock</span>
          </div>
          <span
            className={`text-2xl font-bold font-mono ${
              lockPercentage >= 70
                ? 'text-sovereignty-locked'
                : lockPercentage >= 50
                ? 'text-sovereignty-warning'
                : 'text-sovereignty-danger'
            }`}
          >
            {lockPercentage}%
          </span>
        </div>

        {/* Lock Progress Bar */}
        <div className="h-3 bg-lattice-deep rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              lockPercentage >= 70
                ? 'bg-sovereignty-locked'
                : lockPercentage >= 50
                ? 'bg-sovereignty-warning'
                : 'bg-sovereignty-danger'
            }`}
            style={{ width: `${lockPercentage}%` }}
          />
        </div>

        <p className="text-xs text-gray-400 mt-2">
          {lockPercentage >= 70
            ? 'Your data sovereignty is secure'
            : lockPercentage >= 50
            ? 'Some sovereignty controls need attention'
            : 'Critical: Sovereignty compromised'}
        </p>
      </div>

      {/* Ethos Invariants */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Lock className="w-4 h-4 text-neon-cyan" />
          Ethos Invariants
        </h3>

        <div className="space-y-2">
          {invariants.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between p-2 rounded-lg bg-lattice-deep"
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(inv.status)}
                <div>
                  <p className="text-sm font-mono">{inv.name}</p>
                  <p className="text-xs text-gray-400">{inv.description}</p>
                </div>
              </div>
              <span
                className={`text-xs px-2 py-1 rounded ${getStatusColor(inv.status)} bg-opacity-20`}
              >
                {inv.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Last Audit */}
      {status?.lastAudit && (
        <p className="text-xs text-gray-400 text-center">
          Last audit: {new Date(status.lastAudit).toLocaleString()}
        </p>
      )}
    </div>
  );
}

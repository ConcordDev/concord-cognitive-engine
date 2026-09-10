'use client';

import { CheckCircle, AlertTriangle } from 'lucide-react';

export function HealthCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}) {
  const colors = {
    ok: 'text-neon-green border-neon-green/20',
    warn: 'text-yellow-400 border-yellow-400/20',
    error: 'text-red-400 border-red-400/20',
  };
  const icons = {
    ok: <CheckCircle className="w-4 h-4" />,
    warn: <AlertTriangle className="w-4 h-4" />,
    error: <AlertTriangle className="w-4 h-4" />,
  };
  return (
    <div className={`lens-card border ${colors[status]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <span className={colors[status]}>{icons[status]}</span>
      </div>
      <p className="text-xs text-gray-400 font-mono">{detail}</p>
    </div>
  );
}

export function CmdButton({
  label,
  color,
  onClick,
  disabled,
}: {
  label: string;
  color: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`lens-card text-center hover:border-${color} transition-colors disabled:opacity-50`}
    >
      <p className="text-sm font-medium">{label}</p>
    </button>
  );
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

'use client';

import { useState } from 'react';
import {
  Users,
  FileText,
  Activity,
  Shield,
  Settings,
  AlertTriangle,
  CheckCircle,
  Clock,
  HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdminStats {
  users: {
    total: number;
    active: number;
    newToday: number;
  };
  dtus: {
    total: number;
    createdToday: number;
    averagePerUser: number;
  };
  storage: {
    used: number;
    total: number;
    attachments: number;
  };
  api: {
    requestsToday: number;
    averageLatency: number;
    errorRate: number;
  };
}

interface AuditLog {
  id: string;
  action: string;
  userId: string;
  userName: string;
  resource: string;
  timestamp: string;
  details?: string;
}

interface AdminDashboardProps {
  stats: AdminStats;
  auditLogs: AuditLog[];
  onRefresh?: () => void;
  className?: string;
}

function AdminDashboard({ stats, auditLogs, onRefresh, className }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'audit' | 'settings'>(
    'overview'
  );

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const storagePercent = (stats.storage.used / stats.storage.total) * 100;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-lattice-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-neon-purple" />
          <h1 className="text-xl font-bold text-white">Admin Dashboard</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm text-gray-400">System Healthy</span>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm text-gray-400 hover:text-white transition-colors"
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 border-b border-lattice-border">
        <div className="flex gap-1">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'audit', label: 'Audit Log', icon: FileText },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={cn(
                  'px-4 py-3 text-sm flex items-center gap-2 border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-neon-purple text-white'
                    : 'border-transparent text-gray-400 hover:text-white'
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats cards */}
            <div className="grid grid-cols-4 gap-4">
              <StatCard
                title="Total Users"
                value={stats.users.total}
                change={`+${stats.users.newToday} today`}
                icon={Users}
                color="cyan"
              />
              <StatCard
                title="Total DTUs"
                value={stats.dtus.total}
                change={`+${stats.dtus.createdToday} today`}
                icon={FileText}
                color="purple"
              />
              <StatCard
                title="API Requests"
                value={stats.api.requestsToday}
                change={`${stats.api.averageLatency}ms avg`}
                icon={Activity}
                color="green"
              />
              <StatCard
                title="Error Rate"
                value={`${(stats.api.errorRate * 100).toFixed(2)}%`}
                change={stats.api.errorRate < 0.01 ? 'Healthy' : 'Check logs'}
                icon={stats.api.errorRate < 0.01 ? CheckCircle : AlertTriangle}
                color={stats.api.errorRate < 0.01 ? 'green' : 'yellow'}
              />
            </div>

            {/* Storage */}
            <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-neon-cyan" />
                  <span className="font-medium text-white">Storage Usage</span>
                </div>
                <span className="text-sm text-gray-400">
                  {formatBytes(stats.storage.used)} / {formatBytes(stats.storage.total)}
                </span>
              </div>
              <div className="h-3 bg-lattice-bg rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    storagePercent > 90
                      ? 'bg-red-500'
                      : storagePercent > 70
                        ? 'bg-yellow-500'
                        : 'bg-neon-cyan'
                  )}
                  style={{ width: `${storagePercent}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>{stats.storage.attachments} attachments</span>
                <span>{storagePercent.toFixed(1)}% used</span>
              </div>
            </div>

            {/* Recent activity */}
            <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-neon-purple" />
                <span className="font-medium text-white">Recent Activity</span>
              </div>
              <div className="space-y-3">
                {auditLogs.slice(0, 5).map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between py-2 border-b border-lattice-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-lattice-bg flex items-center justify-center text-xs font-medium text-gray-400">
                        {log.userName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="text-sm text-white">{log.userName}</span>
                        <span className="text-sm text-gray-400"> {log.action} </span>
                        <span className="text-sm text-neon-cyan">{log.resource}</span>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">{formatTime(log.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-lattice-bg">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">User</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                    Resource
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Details</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">Time</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-t border-lattice-border/50 hover:bg-lattice-bg/50"
                  >
                    <td className="px-4 py-3 text-sm text-white">{log.userName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'px-2 py-0.5 text-xs rounded',
                          log.action === 'create' && 'bg-green-500/20 text-green-400',
                          log.action === 'update' && 'bg-blue-500/20 text-blue-400',
                          log.action === 'delete' && 'bg-red-500/20 text-red-400',
                          !['create', 'update', 'delete'].includes(log.action) &&
                            'bg-gray-500/20 text-gray-400'
                        )}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">{log.resource}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{log.details || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatTime(log.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-3 mb-6">
              <Users className="w-6 h-6 text-neon-cyan" />
              <h2 className="text-lg font-semibold text-white">User Overview</h2>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
                <p className="text-sm text-gray-400">Total Users</p>
                <p className="text-2xl font-bold text-white">{stats.users.total}</p>
              </div>
              <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
                <p className="text-sm text-gray-400">Active Users</p>
                <p className="text-2xl font-bold text-neon-green">{stats.users.active}</p>
              </div>
              <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
                <p className="text-sm text-gray-400">New Today</p>
                <p className="text-2xl font-bold text-neon-cyan">{stats.users.newToday}</p>
              </div>
            </div>
            <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4 mt-4">
              <p className="text-sm text-gray-400 mb-2">DTUs per User (avg)</p>
              <p className="text-xl font-semibold text-white">
                {stats.dtus.averagePerUser.toFixed(1)}
              </p>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-3 mb-6">
              <Settings className="w-6 h-6 text-neon-purple" />
              <h2 className="text-lg font-semibold text-white">System Settings</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
                <p className="text-sm text-gray-400">Storage Used</p>
                <p className="text-lg font-semibold text-white">
                  {formatBytes(stats.storage.used)} / {formatBytes(stats.storage.total)}
                </p>
                <div className="w-full bg-lattice-bg rounded-full h-2 mt-2">
                  <div
                    className={cn(
                      'h-2 rounded-full',
                      storagePercent > 80 ? 'bg-red-500' : 'bg-neon-cyan'
                    )}
                    style={{ width: `${Math.min(storagePercent, 100)}%` }}
                  />
                </div>
              </div>
              <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
                <p className="text-sm text-gray-400">API Requests Today</p>
                <p className="text-lg font-semibold text-white">
                  {stats.api.requestsToday.toLocaleString()}
                </p>
              </div>
              <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
                <p className="text-sm text-gray-400">Avg Latency</p>
                <p className="text-lg font-semibold text-white">{stats.api.averageLatency}ms</p>
              </div>
              <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
                <p className="text-sm text-gray-400">Error Rate</p>
                <p
                  className={cn(
                    'text-lg font-semibold',
                    stats.api.errorRate > 5 ? 'text-red-400' : 'text-neon-green'
                  )}
                >
                  {stats.api.errorRate}%
                </p>
              </div>
            </div>
            <div className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
              <p className="text-sm text-gray-400">Attachments</p>
              <p className="text-lg font-semibold text-white">
                {stats.storage.attachments.toLocaleString()} files
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  change,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  change: string;
  icon: React.ElementType;
  color: 'cyan' | 'purple' | 'green' | 'yellow';
}) {
  const colors = {
    cyan: 'text-neon-cyan bg-neon-cyan/10',
    purple: 'text-neon-purple bg-neon-purple/10',
    green: 'text-green-400 bg-green-400/10',
    yellow: 'text-yellow-400 bg-yellow-400/10',
  };

  return (
    <div className="bg-lattice-surface border border-lattice-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400">{title}</span>
        <div className={cn('p-2 rounded-lg', colors[color])}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-xs text-gray-500">{change}</div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedAdminDashboard = withErrorBoundary(AdminDashboard);
export { _WrappedAdminDashboard as AdminDashboard };

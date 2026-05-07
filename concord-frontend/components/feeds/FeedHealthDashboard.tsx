'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle,
  AlertCircle,
  XCircle,
  Pause,
  Play,
  ChevronDown,
  ChevronRight,
  Globe,
  Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface FeedHealthEntry {
  id: string;
  name: string;
  domain: string;
  type: string;
  url: string;
  interval: number;
  enabled: boolean;
  autoDisabled: boolean;
  autoDisableReason: string | null;
  health: {
    lastSuccess: string | null;
    lastAttempt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    totalFetches: number;
    totalErrors: number;
    totalItems: number;
    totalDTUsCreated: number;
    successRate: string;
  };
}

interface FeedDashboardData {
  totalFeeds: number;
  activeFeeds: number;
  disabledFeeds: number;
  autoDisabled: number;
  dtusThisHour: number;
  maxDtusPerHour: number;
  running: boolean;
  feeds: FeedHealthEntry[];
}

interface FeedHealthDashboardProps {
  className?: string;
}

export function FeedHealthDashboard({ className }: FeedHealthDashboardProps) {
  const [data, setData] = useState<FeedDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'active' | 'disabled' | 'erroring'>('all');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/feeds/health');
      if (res.ok) {
        const json = await res.json();
        if (json.ok) setData(json);
      }
    } catch (_e) {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleDomain = (domain: string) => {
    setExpandedDomains(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const toggleFeed = async (feedId: string, enabled: boolean) => {
    try {
      await fetch(`/api/feeds/${feedId}/${enabled ? 'enable' : 'disable'}`, { method: 'PUT' });
      fetchData();
    } catch (_e) { /* silent */ }
  };

  const testFeed = async (feedId: string) => {
    try {
      const res = await fetch(`/api/feeds/${feedId}/test`, { method: 'POST' });
      const json = await res.json();
      alert(json.reachable ? `✓ Feed reachable (${json.status}, ${json.size} bytes)` : `✗ Feed unreachable: ${json.error}`);
    } catch (_e) {
      alert('Test failed');
    }
  };

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <RefreshCw className="w-6 h-6 animate-spin text-neon-cyan" />
        <span className="ml-2 text-gray-400">Loading feed health...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={cn('p-4 text-red-400', className)}>
        Feed manager not available
      </div>
    );
  }

  // Group feeds by domain
  const grouped = new Map<string, FeedHealthEntry[]>();
  for (const feed of data.feeds) {
    const existing = grouped.get(feed.domain) || [];
    existing.push(feed);
    grouped.set(feed.domain, existing);
  }

  const filteredFeeds = data.feeds.filter(f => {
    if (filter === 'active') return f.enabled;
    if (filter === 'disabled') return !f.enabled;
    if (filter === 'erroring') return f.health.consecutiveFailures > 0;
    return true;
  });

  const filteredGrouped = new Map<string, FeedHealthEntry[]>();
  for (const feed of filteredFeeds) {
    const existing = filteredGrouped.get(feed.domain) || [];
    existing.push(feed);
    filteredGrouped.set(feed.domain, existing);
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400">Total Feeds</div>
          <div className="text-2xl font-bold text-white">{data.totalFeeds}</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 border border-green-900/30">
          <div className="text-xs text-gray-400">Active</div>
          <div className="text-2xl font-bold text-green-400">{data.activeFeeds}</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 border border-yellow-900/30">
          <div className="text-xs text-gray-400">Auto-Disabled</div>
          <div className="text-2xl font-bold text-yellow-400">{data.autoDisabled}</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 border border-cyan-900/30">
          <div className="text-xs text-gray-400">DTUs This Hour</div>
          <div className="text-2xl font-bold text-cyan-400">{data.dtusThisHour}<span className="text-xs text-gray-500">/{data.maxDtusPerHour}</span></div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(['all', 'active', 'disabled', 'erroring'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition',
              filter === f ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button onClick={fetchData} className="ml-auto px-3 py-1 rounded-md text-xs bg-gray-800 text-gray-400 hover:text-white">
          <RefreshCw className="w-3 h-3 inline mr-1" />Refresh
        </button>
      </div>

      {/* Feed List by Domain */}
      <div className="flex flex-col gap-2">
        {[...filteredGrouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([domain, feeds]) => (
          <div key={domain} className="bg-gray-800/30 rounded-lg border border-gray-700/50">
            <button
              onClick={() => toggleDomain(domain)}
              className="w-full flex items-center gap-2 p-3 hover:bg-gray-700/30 transition"
            >
              {expandedDomains.has(domain) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              <Globe className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-medium text-white capitalize">{domain}</span>
              <span className="text-xs text-gray-500 ml-auto">{feeds.length} feeds</span>
              <span className="text-xs text-green-400">{feeds.filter(f => f.enabled).length} active</span>
            </button>

            {expandedDomains.has(domain) && (
              <div className="border-t border-gray-700/50">
                {feeds.map(feed => (
                  <div key={feed.id} className="flex items-center gap-3 px-4 py-2 border-b border-gray-700/30 last:border-b-0">
                    {feed.enabled ? (
                      feed.health.consecutiveFailures > 0 ?
                        <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0" /> :
                        <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{feed.name}</div>
                      <div className="text-[10px] text-gray-500 truncate">{feed.url}</div>
                      {feed.autoDisableReason && (
                        <div className="text-[10px] text-red-400 truncate">⚠ {feed.autoDisableReason}</div>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500 text-right flex-shrink-0">
                      <div>{feed.health.successRate} success</div>
                      <div>{feed.health.totalDTUsCreated} DTUs</div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => toggleFeed(feed.id, !feed.enabled)}
                        className="p-1 rounded hover:bg-gray-700"
                        title={feed.enabled ? 'Disable' : 'Enable'}
                      >
                        {feed.enabled ? <Pause className="w-3 h-3 text-yellow-400" /> : <Play className="w-3 h-3 text-green-400" />}
                      </button>
                      <button
                        onClick={() => testFeed(feed.id)}
                        className="p-1 rounded hover:bg-gray-700"
                        title="Test connectivity"
                      >
                        <Wifi className="w-3 h-3 text-cyan-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

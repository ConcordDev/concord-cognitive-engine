'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Bell, BellOff, Brain, BarChart3, Clock, Settings,
  ChevronRight, X, Info,
  Zap, Mail, Archive, Calendar, GripVertical, ToggleLeft,
  ToggleRight, TrendingUp, Eye, MousePointer, Trash2,
  HelpCircle, Sparkles, AlertCircle, MessageSquare, Coins,
  Quote, Globe, Megaphone, Package,
} from 'lucide-react';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

export type PriorityBucket = 'immediate' | 'daily' | 'weekly' | 'archive';

export interface SmartNotification {
  id: string;
  title: string;
  message: string;
  domain: string;
  timestamp: number;
  read: boolean;
  dismissed: boolean;
  clicked: boolean;
  importanceScore: number; // 0–100
  bucket: PriorityBucket;
  groupKey?: string;
  groupCount?: number;
  reason: string; // "why am I seeing this?" explanation
  action?: { label: string; href: string };
}

export interface InterestDomain {
  id: string;
  label: string;
  icon: string;
  weight: number; // 0–1, higher = more important
}

export interface RoutingRule {
  id: string;
  domain: string;
  bucket: PriorityBucket;
  condition?: string;
}

export interface LearningSuggestion {
  id: string;
  message: string;
  domain: string;
  dismissCount: number;
  accepted?: boolean;
}

export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:mm"
  end: string;   // "HH:mm"
}

export interface NotificationAnalytics {
  totalReceived: number;
  readRate: number;    // 0–1
  actionRate: number;  // 0–1
  topDomains: { domain: string; count: number }[];
}

export interface UserProfile {
  interests: InterestDomain[];
  quietHours: QuietHours;
  smartMode: boolean;
  analytics: NotificationAnalytics;
  learningSuggestions: LearningSuggestion[];
}

interface SmartNotificationsProps {
  notifications: SmartNotification[];
  profile: UserProfile;
  rules: RoutingRule[];
  onUpdateRule: (ruleId: string, update: Partial<RoutingRule>) => void;
  onDismiss: (notificationId: string) => void;
  onLearn: (signal: { notificationId: string; action: 'read' | 'dismiss' | 'click' }) => void;
}

// ── Helpers ────────────────────────────────────────────────────────

const bucketConfig: Record<PriorityBucket, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  immediate: { label: 'Immediate', icon: Zap, color: 'text-red-400' },
  daily:     { label: 'Daily Digest', icon: Mail, color: 'text-blue-400' },
  weekly:    { label: 'Weekly', icon: Calendar, color: 'text-purple-400' },
  archive:   { label: 'Archive', icon: Archive, color: 'text-gray-500' },
};

const domainIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  citations: Quote,
  royalties: Coins,
  messages: MessageSquare,
  community: Globe,
  marketplace: Package,
  platform: Megaphone,
  lens: Eye,
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-red-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-blue-400';
  return 'text-gray-500';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-red-500/20';
  if (score >= 60) return 'bg-yellow-500/20';
  if (score >= 40) return 'bg-blue-500/20';
  return 'bg-gray-500/20';
}

// ── Component ──────────────────────────────────────────────────────

export default function SmartNotifications({
  notifications,
  profile,
  rules,
  onUpdateRule,
  onDismiss,
  onLearn,
}: SmartNotificationsProps) {
  const [activeTab, setActiveTab] = useState<'all' | PriorityBucket>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [expandedNotif, setExpandedNotif] = useState<string | null>(null);
  const [smartMode, setSmartMode] = useState(profile.smartMode);
  const [quietStart, setQuietStart] = useState(profile.quietHours.start);
  const [quietEnd, setQuietEnd] = useState(profile.quietHours.end);
  const [quietEnabled, setQuietEnabled] = useState(profile.quietHours.enabled);
  const [draggedInterest, setDraggedInterest] = useState<string | null>(null);
  const [interestOrder, setInterestOrder] = useState(profile.interests.map(i => i.id));

  // Filter notifications by tab
  const filtered = useMemo(() => {
    const visible = notifications.filter(n => !n.dismissed);
    if (activeTab === 'all') return smartMode
      ? [...visible].sort((a, b) => b.importanceScore - a.importanceScore)
      : [...visible].sort((a, b) => b.timestamp - a.timestamp);
    return visible
      .filter(n => n.bucket === activeTab)
      .sort((a, b) => (smartMode ? b.importanceScore - a.importanceScore : b.timestamp - a.timestamp));
  }, [notifications, activeTab, smartMode]);

  // Group batched notifications
  const grouped = useMemo(() => {
    const groups: SmartNotification[][] = [];
    const seen = new Set<string>();
    for (const n of filtered) {
      if (seen.has(n.id)) continue;
      if (n.groupKey) {
        const batch = filtered.filter(x => x.groupKey === n.groupKey);
        batch.forEach(x => seen.add(x.id));
        groups.push(batch);
      } else {
        seen.add(n.id);
        groups.push([n]);
      }
    }
    return groups;
  }, [filtered]);

  const handleRead = useCallback((id: string) => {
    onLearn({ notificationId: id, action: 'read' });
  }, [onLearn]);

  const handleDismiss = useCallback((id: string) => {
    onLearn({ notificationId: id, action: 'dismiss' });
    onDismiss(id);
  }, [onDismiss, onLearn]);

  const handleClick = useCallback((id: string) => {
    onLearn({ notificationId: id, action: 'click' });
  }, [onLearn]);

  const orderedInterests = useMemo(() => {
    return interestOrder
      .map(id => profile.interests.find(i => i.id === id))
      .filter(Boolean) as InterestDomain[];
  }, [interestOrder, profile.interests]);

  const handleDragStart = useCallback((id: string) => setDraggedInterest(id), []);
  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedInterest || draggedInterest === targetId) return;
    setInterestOrder(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(draggedInterest);
      const toIdx = next.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, draggedInterest);
      return next;
    });
  }, [draggedInterest]);

  const tabs: { key: 'all' | PriorityBucket; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'immediate', label: 'Immediate' },
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
  ];

  const unreadCount = notifications.filter(n => !n.read && !n.dismissed).length;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className={`${panel} p-4 space-y-4 max-w-2xl w-full`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-400" />
          <h2 className="text-white font-semibold text-lg">Smart Notifications</h2>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Smart / Chrono toggle */}
          <button
            onClick={() => setSmartMode(!smartMode)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-white/10 hover:bg-white/5 transition-colors"
          >
            {smartMode ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-purple-300">Smart</span>
              </>
            ) : (
              <>
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-gray-300">Chrono</span>
              </>
            )}
          </button>
          <button
            onClick={() => { setShowAnalytics(!showAnalytics); setShowSettings(false); }}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
          >
            <BarChart3 className="w-4 h-4 text-gray-400" />
          </button>
          <button
            onClick={() => { setShowSettings(!showSettings); setShowAnalytics(false); }}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
          >
            <Settings className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Learning Suggestions */}
      {profile.learningSuggestions.filter(s => s.accepted === undefined).map(suggestion => (
        <div
          key={suggestion.id}
          className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
        >
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-200">{suggestion.message}</p>
            <p className="text-xs text-amber-400/60 mt-0.5">
              Based on {suggestion.dismissCount} dismissed {suggestion.domain} notifications
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('smart-notifications:suggestion-accept', { detail: { suggestionId: suggestion.id, domain: suggestion.domain } })); }}
              className="px-2 py-1 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('smart-notifications:suggestion-decline', { detail: { suggestionId: suggestion.id, domain: suggestion.domain } })); }}
              className="px-2 py-1 text-xs rounded bg-white/5 text-gray-400 hover:bg-white/10 transition-colors"
            >
              No
            </button>
          </div>
        </div>
      ))}

      {/* Analytics Panel */}
      {showAnalytics && (
        <div className={`${panel} p-4 space-y-3`}>
          <h3 className="text-white font-medium text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-400" />
            Notification Analytics
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2 rounded bg-white/5">
              <div className="text-xl font-bold text-white">{profile.analytics.totalReceived}</div>
              <div className="text-xs text-gray-500">Received</div>
            </div>
            <div className="text-center p-2 rounded bg-white/5">
              <div className="text-xl font-bold text-green-400">
                {Math.round(profile.analytics.readRate * 100)}%
              </div>
              <div className="text-xs text-gray-500">Read Rate</div>
            </div>
            <div className="text-center p-2 rounded bg-white/5">
              <div className="text-xl font-bold text-blue-400">
                {Math.round(profile.analytics.actionRate * 100)}%
              </div>
              <div className="text-xs text-gray-500">Action Rate</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Top Domains</div>
            {profile.analytics.topDomains.map(d => (
              <div key={d.domain} className="flex items-center justify-between text-sm">
                <span className="text-gray-300 capitalize">{d.domain}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 rounded bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded"
                      style={{
                        width: `${Math.min(100, (d.count / Math.max(1, profile.analytics.totalReceived)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-gray-500 text-xs w-8 text-right">{d.count}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Learning Signal Summary */}
          <div className="pt-2 border-t border-white/5 space-y-1">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Learning Signals</div>
            <div className="flex gap-3 text-xs">
              <span className="text-green-400 flex items-center gap-1">
                <Eye className="w-3 h-3" /> Reads train relevance
              </span>
              <span className="text-red-400 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Dismisses reduce score
              </span>
              <span className="text-blue-400 flex items-center gap-1">
                <MousePointer className="w-3 h-3" /> Clicks boost priority
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className={`${panel} p-4 space-y-4`}>
          <h3 className="text-white font-medium text-sm flex items-center gap-2">
            <Settings className="w-4 h-4 text-gray-400" />
            Notification Settings
          </h3>

          {/* Interest Profile (drag to reorder) */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Interest Profile (drag to reorder priority)
            </div>
            <div className="space-y-1">
              {orderedInterests.map((interest, idx) => {
                const DomainIcon = domainIcons[interest.id] || Globe;
                return (
                  <div
                    key={interest.id}
                    draggable
                    onDragStart={() => handleDragStart(interest.id)}
                    onDragOver={(e) => handleDragOver(e, interest.id)}
                    onDragEnd={() => setDraggedInterest(null)}
                    className={`flex items-center gap-2 p-2 rounded border transition-colors cursor-grab active:cursor-grabbing ${
                      draggedInterest === interest.id
                        ? 'border-purple-500/50 bg-purple-500/10'
                        : 'border-white/5 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                    <span className="text-xs text-gray-500 w-4">{idx + 1}</span>
                    <DomainIcon className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-200 flex-1">{interest.label}</span>
                    <div className="w-16 h-1.5 rounded bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded"
                        style={{ width: `${interest.weight * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Routing Rules */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Priority Routing Rules</div>
            {rules.map(rule => {
              const cfg = bucketConfig[rule.bucket];
              const BucketIcon = cfg.icon;
              return (
                <div key={rule.id} className="flex items-center gap-2 p-2 rounded bg-white/5">
                  <span className="text-sm text-gray-300 flex-1 capitalize">{rule.domain}</span>
                  {rule.condition && (
                    <span className="text-xs text-gray-500 italic">{rule.condition}</span>
                  )}
                  <select
                    value={rule.bucket}
                    onChange={(e) => onUpdateRule(rule.id, { bucket: e.target.value as PriorityBucket })}
                    className="bg-white/10 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none"
                  >
                    <option value="immediate">Immediate</option>
                    <option value="daily">Daily Digest</option>
                    <option value="weekly">Weekly</option>
                    <option value="archive">Archive</option>
                  </select>
                  <BucketIcon className={`w-4 h-4 ${cfg.color}`} />
                </div>
              );
            })}
          </div>

          {/* Quiet Hours */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500 uppercase tracking-wider">Quiet Hours</div>
              <button
                onClick={() => setQuietEnabled(!quietEnabled)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                {quietEnabled ? (
                  <ToggleRight className="w-5 h-5 text-purple-400" />
                ) : (
                  <ToggleLeft className="w-5 h-5" />
                )}
              </button>
            </div>
            {quietEnabled && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <BellOff className="w-3.5 h-3.5 text-gray-500" />
                  <input
                    type="time"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                    className="bg-white/10 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none"
                  />
                </div>
                <span className="text-gray-600 text-xs">to</span>
                <div className="flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-gray-500" />
                  <input
                    type="time"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                    className="bg-white/10 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-white/5">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              activeTab === tab.key
                ? 'bg-purple-500/20 text-purple-300'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notification Feed */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
        {grouped.length === 0 && (
          <div className="text-center py-8 text-gray-600">
            <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No notifications in this category</p>
          </div>
        )}

        {grouped.map((group) => {
          const primary = group[0];
          const isGroup = group.length > 1;
          const isExpanded = expandedNotif === primary.id;
          const DomainIcon = domainIcons[primary.domain] || Bell;
          const cfg = bucketConfig[primary.bucket];

          return (
            <div
              key={primary.id}
              className={`rounded-lg border transition-colors ${
                primary.read
                  ? 'border-white/5 bg-white/[0.02]'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              <div
                className="flex items-start gap-3 p-3 cursor-pointer"
                onClick={() => {
                  handleRead(primary.id);
                  handleClick(primary.id);
                }}
              >
                {/* Score Badge */}
                <div
                  className={`shrink-0 w-10 h-10 rounded-lg ${scoreBg(primary.importanceScore)} flex flex-col items-center justify-center`}
                >
                  <span className={`text-xs font-bold ${scoreColor(primary.importanceScore)}`}>
                    {primary.importanceScore}
                  </span>
                  <DomainIcon className={`w-3 h-3 ${scoreColor(primary.importanceScore)} opacity-60`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className={`text-sm font-medium truncate ${primary.read ? 'text-gray-400' : 'text-white'}`}>
                      {isGroup
                        ? `${group.length} ${primary.domain} notifications`
                        : primary.title}
                    </h4>
                    {!primary.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                    {isGroup
                      ? primary.title
                      : primary.message}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-gray-600">{relativeTime(primary.timestamp)}</span>
                    <span className={`text-[10px] ${cfg.color} flex items-center gap-0.5`}>
                      <cfg.icon className="w-2.5 h-2.5" />
                      {cfg.label}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpandedNotif(isExpanded ? null : primary.id); }}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    title="Why am I seeing this?"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-gray-600" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDismiss(primary.id); }}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5 text-gray-600" />
                  </button>
                </div>
              </div>

              {/* Expanded: "Why am I seeing this?" */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="p-2 rounded bg-blue-500/10 border border-blue-500/20">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Info className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-xs font-medium text-blue-300">Why am I seeing this?</span>
                    </div>
                    <p className="text-xs text-blue-200/70">{primary.reason}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                      <span>Score: {primary.importanceScore}/100</span>
                      <span>Bucket: {cfg.label}</span>
                      <span>Domain: {primary.domain}</span>
                    </div>
                  </div>

                  {/* Grouped items */}
                  {isGroup && (
                    <div className="space-y-1">
                      {group.map((n, i) => (
                        <div
                          key={n.id}
                          className="flex items-center gap-2 p-2 rounded bg-white/[0.03] text-xs"
                        >
                          <span className="text-gray-600 w-4">{i + 1}.</span>
                          <span className={`flex-1 truncate ${n.read ? 'text-gray-500' : 'text-gray-300'}`}>
                            {n.title}
                          </span>
                          <span className="text-gray-600">{relativeTime(n.timestamp)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action button */}
                  {primary.action && (
                    <button
                      onClick={() => handleClick(primary.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-purple-500/20 text-purple-300 text-xs hover:bg-purple-500/30 transition-colors"
                    >
                      <ChevronRight className="w-3 h-3" />
                      {primary.action.label}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: Learning Signal Indicator */}
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
          <TrendingUp className="w-3 h-3" />
          <span>ML model learns from your reads, dismisses, and clicks</span>
        </div>
        <span className="text-[10px] text-gray-600">
          {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

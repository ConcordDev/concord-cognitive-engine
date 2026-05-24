'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Bell, Quote, Coins, Compass, Calendar, Monitor, MessageSquare,
  Shield, Trophy, Check, CheckCheck, Settings, Filter,
  ChevronRight, Sparkles, ExternalLink,
} from 'lucide-react';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

export type NotificationType =
  | 'citation'
  | 'royalty'
  | 'discovery'
  | 'event'
  | 'system'
  | 'social'
  | 'moderation'
  | 'milestone';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number; // ms since epoch
  read: boolean;
  action?: {
    label: string;
    type: 'view-dtu' | 'go-to-event' | 'open-profile';
    target: string;
  };
}

export interface DailyDigest {
  date: string;
  royaltiesEarned: number;
  citationsReceived: number;
  eventsAttended: number;
  summary: string;
}

export type NotificationPreferences = Record<NotificationType, boolean>;

interface NotificationFeedProps {
  notifications: Notification[];
  preferences: NotificationPreferences;
  dailyDigest?: DailyDigest;
  onRead: (id: string) => void;
  onReadAll: () => void;
  onAction: (notificationId: string, actionType: string, target: string) => void;
  onPreferenceChange: (type: NotificationType, enabled: boolean) => void;
}

// ── Type Config ───────────────────────────────────────────────────

const typeConfig: Record<
  NotificationType,
  { icon: React.ComponentType<{ className?: string }>; color: string; bgColor: string; label: string }
> = {
  citation: { icon: Quote, color: 'text-blue-400', bgColor: 'bg-blue-500/20', label: 'Citation' },
  royalty: { icon: Coins, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', label: 'Royalty' },
  discovery: { icon: Compass, color: 'text-teal-400', bgColor: 'bg-teal-500/20', label: 'Discovery' },
  event: { icon: Calendar, color: 'text-purple-400', bgColor: 'bg-purple-500/20', label: 'Event' },
  system: { icon: Monitor, color: 'text-gray-400', bgColor: 'bg-gray-500/20', label: 'System' },
  social: { icon: MessageSquare, color: 'text-green-400', bgColor: 'bg-green-500/20', label: 'Social' },
  moderation: { icon: Shield, color: 'text-red-400', bgColor: 'bg-red-500/20', label: 'Moderation' },
  milestone: { icon: Trophy, color: 'text-amber-400', bgColor: 'bg-amber-500/20', label: 'Milestone' },
};

// ── Relative Time ─────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ── Action button labels ──────────────────────────────────────────

const actionLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  'view-dtu': { label: 'View DTU', icon: <ExternalLink className="w-3 h-3" /> },
  'go-to-event': { label: 'Go to Event', icon: <ChevronRight className="w-3 h-3" /> },
  'open-profile': { label: 'Open Profile', icon: <ExternalLink className="w-3 h-3" /> },
};

// ── Component ─────────────────────────────────────────────────────

export default function NotificationFeed({
  notifications,
  preferences,
  dailyDigest,
  onRead,
  onReadAll,
  onAction,
  onPreferenceChange,
}: NotificationFeedProps) {
  const [activeFilter, setActiveFilter] = useState<NotificationType | 'all'>('all');
  const [showPreferences, setShowPreferences] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const filteredNotifications = useMemo(() => {
    let list = notifications.filter((n) => preferences[n.type]);
    if (activeFilter !== 'all') {
      list = list.filter((n) => n.type === activeFilter);
    }
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [notifications, activeFilter, preferences]);

  const handleAction = useCallback(
    (notif: Notification) => {
      if (notif.action) {
        onAction(notif.id, notif.action.type, notif.action.target);
      }
    },
    [onAction],
  );

  return (
    <div className={`${panel} w-80 flex flex-col max-h-[80vh]`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-medium">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={onReadAll}
                className="p-1 rounded hover:bg-white/5 transition-colors"
                title="Mark all read"
              >
                <CheckCheck className="w-3.5 h-3.5 text-gray-500 hover:text-cyan-400" />
              </button>
            )}
            <button
              onClick={() => setShowPreferences((s) => !s)}
              className="p-1 rounded hover:bg-white/5 transition-colors"
              title="Preferences"
            >
              <Settings className="w-3.5 h-3.5 text-gray-500 hover:text-cyan-400" />
            </button>
          </div>
        </div>

        {/* Preferences panel */}
        {showPreferences && (
          <div className="mb-2 p-2 rounded bg-white/5 border border-white/5">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
              Enable / Disable
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(Object.keys(typeConfig) as NotificationType[]).map((type) => {
                const cfg = typeConfig[type];
                return (
                  <button
                    key={type}
                    onClick={() => onPreferenceChange(type, !preferences[type])}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors ${
                      preferences[type]
                        ? `${cfg.color} bg-white/5 border border-white/10`
                        : 'text-gray-600 border border-transparent'
                    }`}
                  >
                    <cfg.icon className="w-3 h-3" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors flex items-center gap-1 ${
              activeFilter === 'all'
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            <Filter className="w-3 h-3" />
            All
          </button>
          {(Object.keys(typeConfig) as NotificationType[]).map((type) => {
            const cfg = typeConfig[type];
            return (
              <button
                key={type}
                onClick={() => setActiveFilter(type)}
                className={`px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
                  activeFilter === type
                    ? `${cfg.bgColor} ${cfg.color} border border-current/40`
                    : 'text-gray-500 hover:text-gray-300 border border-transparent'
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Daily Digest */}
      {dailyDigest && activeFilter === 'all' && (
        <div className="px-4 py-3 border-b border-white/5">
          <div className="p-2.5 rounded bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-white/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[10px] text-cyan-400 font-medium uppercase tracking-wider">
                Daily Digest
              </span>
              <span className="text-[9px] text-gray-600 ml-auto">{dailyDigest.date}</span>
            </div>
            <p className="text-[11px] text-gray-300 mb-2">{dailyDigest.summary}</p>
            <div className="flex gap-3 text-[10px]">
              <span className="flex items-center gap-1 text-yellow-400">
                <Coins className="w-3 h-3" />
                {dailyDigest.royaltiesEarned} royalties
              </span>
              <span className="flex items-center gap-1 text-blue-400">
                <Quote className="w-3 h-3" />
                {dailyDigest.citationsReceived} citations
              </span>
              <span className="flex items-center gap-1 text-purple-400">
                <Calendar className="w-3 h-3" />
                {dailyDigest.eventsAttended} events
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {filteredNotifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Bell className="w-8 h-8 text-gray-700 mx-auto mb-2" />
            <p className="text-xs text-gray-500">All caught up!</p>
            <p className="text-[10px] text-gray-600 mt-1">
              Build something to start earning notifications.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredNotifications.map((notif) => {
              const cfg = typeConfig[notif.type];
              const Icon = cfg.icon;
              return (
                <div
                  key={notif.id}
                  className={`px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer ${
                    !notif.read ? 'bg-white/[0.02]' : ''
                  }`}
                  onClick={() => !notif.read && onRead(notif.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  <div className="flex items-start gap-2.5">
                    {/* Unread dot */}
                    <div className="mt-1 flex-shrink-0 w-4 flex justify-center">
                      {!notif.read && (
                        <div className="w-2 h-2 rounded-full bg-cyan-400" />
                      )}
                    </div>

                    {/* Icon */}
                    <div
                      className={`flex-shrink-0 w-7 h-7 rounded flex items-center justify-center ${cfg.bgColor}`}
                    >
                      <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-white truncate">
                          {notif.title}
                        </span>
                        <span className="text-[9px] text-gray-600 flex-shrink-0 ml-2">
                          {relativeTime(notif.timestamp)}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">
                        {notif.message}
                      </p>

                      {/* Action button */}
                      {notif.action && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction(notif);
                          }}
                          className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${cfg.color} bg-white/5 hover:bg-white/10 transition-colors`}
                        >
                          {actionLabels[notif.action.type]?.icon}
                          {actionLabels[notif.action.type]?.label || notif.action.label}
                        </button>
                      )}
                    </div>

                    {/* Mark read */}
                    {!notif.read && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRead(notif.id);
                        }}
                        className="flex-shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
                        title="Mark as read"
                      >
                        <Check className="w-3 h-3 text-gray-600 hover:text-cyan-400" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

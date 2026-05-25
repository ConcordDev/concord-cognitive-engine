'use client';

/**
 * InitiativeSettings — Settings panel for Concord's proactive initiative system.
 *
 * Allows users to configure:
 *   - Enable/disable initiatives globally
 *   - Max per day slider (1-10)
 *   - Quiet hours time pickers
 *   - Channel toggles (in-app, push, SMS, email)
 *   - Double text toggle
 *   - Response backoff info display
 *   - Preview of what each trigger type looks like
 *
 * Part of Concord Spec 2 — Conversational Initiative (Living Chat).
 */

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Bell,
  BellOff,
  Clock,
  Mail,
  MessageSquare,
  Smartphone,
  Monitor,
  Moon,
  Sun,
  AlertTriangle,
  Sparkles,
  Quote,
  Heart,
  Globe,
  Brain,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Save,
  Info,
  ShieldAlert,
  Sliders,
  Loader2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────

interface ChannelToggles {
  inApp: boolean;
  push: boolean;
  sms: boolean;
  email: boolean;
}

interface InitiativeSettingsData {
  userId: string;
  maxPerDay: number;
  maxPerWeek: number;
  quietStart: string;
  quietEnd: string;
  allowDoubleText: boolean;
  channels: ChannelToggles;
  disabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface BackoffInfo {
  ignoredCount: number;
  lastInitiativeAt: string | null;
  backoffUntil: string | null;
}

interface TriggerInfo {
  id: string;
  label: string;
  description: string;
  priority: string;
}

interface ChannelInfo {
  id: string;
  label: string;
  description: string;
  requiresOptIn: boolean;
}

interface SettingsResponse {
  ok: boolean;
  settings: InitiativeSettingsData;
  backoff: BackoffInfo | null;
  limits: { maxPerDay: number; maxPerWeek: number; minGapMs: number };
  availableTriggers: TriggerInfo[];
  availableChannels: ChannelInfo[];
}

interface InitiativeSettingsProps {
  className?: string;
  apiBase?: string;
}

// ── Trigger Preview Config ─────────────────────────────────────────────

const TRIGGER_PREVIEWS: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  borderColor: string;
  exampleMessage: string;
}> = {
  substrateDiscovery: {
    icon: Sparkles,
    color: 'text-blue-400',
    bgColor: 'bg-blue-950/40',
    borderColor: 'border-blue-500/30',
    exampleMessage: 'I found something interesting in your healthcare domain: "New CRISPR Therapy Results" scored 85 on the CRETI scale. Want to take a look?',
  },
  citationAlert: {
    icon: Quote,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-950/40',
    borderColor: 'border-yellow-500/30',
    exampleMessage: 'Your DTU "Quantum Computing Primer" was just cited in "Advanced Physics Review". Your knowledge is spreading!',
  },
  genuineCheckIn: {
    icon: Heart,
    color: 'text-zinc-400',
    bgColor: 'bg-zinc-800/40',
    borderColor: 'border-zinc-600/30',
    exampleMessage: "Hey! It's been 5 days -- just checking in. 12 new DTUs landed while you were away. Want a quick catch-up?",
  },
  pendingWorkReminder: {
    icon: Clock,
    color: 'text-orange-400',
    bgColor: 'bg-orange-950/40',
    borderColor: 'border-orange-500/30',
    exampleMessage: 'You left "Machine Learning Notes" in progress 3 days ago, plus 2 other drafts. Want to pick back up?',
  },
  worldEventConnection: {
    icon: Globe,
    color: 'text-purple-400',
    bgColor: 'bg-purple-950/40',
    borderColor: 'border-purple-500/30',
    exampleMessage: 'Something happening in the world connects to your finance domain: "Federal Reserve Rate Decision". Want me to analyze the implications for your substrate?',
  },
  reflectiveFollowUp: {
    icon: Brain,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-950/40',
    borderColor: 'border-emerald-500/30',
    exampleMessage: "I've been thinking about our earlier conversation about neural networks. I made a connection that might interest you.",
  },
  morningContext: {
    icon: Sun,
    color: 'text-amber-400',
    bgColor: 'bg-amber-950/40',
    borderColor: 'border-amber-500/30',
    exampleMessage: 'Good morning! 7 new DTUs arrived overnight. Activity in: healthcare, finance, education. Your substrate is quiet -- a good day to explore.',
  },
};

// ── Channel Icons ──────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  inApp: Monitor,
  push: Bell,
  sms: Smartphone,
  email: Mail,
};

// ── Main Component ─────────────────────────────────────────────────────

export function InitiativeSettings({ className, apiBase = '' }: InitiativeSettingsProps) {
  // State
  const [settings, setSettings] = useState<InitiativeSettingsData | null>(null);
  const [backoff, setBackoff] = useState<BackoffInfo | null>(null);
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [channelInfos, setChannelInfos] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ── Fetch settings on mount ──────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/initiative/settings`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: SettingsResponse = await res.json();
      if (!data.ok) throw new Error('Failed to load settings');

      setSettings(data.settings);
      setBackoff(data.backoff);
      setTriggers(data.availableTriggers || []);
      setChannelInfos(data.availableChannels || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load initiative settings');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ── Save settings ────────────────────────────────────────────────

  const saveSettings = useCallback(async () => {
    if (!settings) return;

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`${apiBase}/api/initiative/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxPerDay: settings.maxPerDay,
          maxPerWeek: settings.maxPerWeek,
          quietStart: settings.quietStart,
          quietEnd: settings.quietEnd,
          allowDoubleText: settings.allowDoubleText,
          channels: settings.channels,
          disabled: settings.disabled,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.ok) throw new Error('Failed to save settings');

      setSettings(data.settings);
      setDirty(false);
      setSuccessMessage('Settings saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [apiBase, settings]);

  // ── Update helpers ───────────────────────────────────────────────

  const updateSetting = useCallback(<K extends keyof InitiativeSettingsData>(
    key: K,
    value: InitiativeSettingsData[K],
  ) => {
    setSettings(prev => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
    setDirty(true);
    setSuccessMessage(null);
  }, []);

  const updateChannel = useCallback((channel: keyof ChannelToggles, value: boolean) => {
    setSettings(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        channels: { ...prev.channels, [channel]: value },
      };
    });
    setDirty(true);
    setSuccessMessage(null);
  }, []);

  // ── Loading state ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={cn(ds.panel, className)}>
        <div className="flex items-center gap-3 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading initiative settings...</span>
        </div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className={cn(ds.panel, className)}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
        <button
          onClick={() => { setLoading(true); fetchSettings(); }}
          className={cn(ds.btnSecondary, 'mt-3')}
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neon-cyan/10">
            <MessageSquare className="w-5 h-5 text-neon-cyan" />
          </div>
          <div>
            <h2 className={ds.heading3}>Conversational Initiative</h2>
            <p className={ds.textMuted}>Control when and how Concord reaches out to you</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-yellow-400 flex items-center gap-1">
              <Info className="w-3 h-3" />
              Unsaved changes
            </span>
          )}
          <button
            onClick={saveSettings}
            disabled={saving || !dirty}
            className={cn(ds.btnPrimary, 'text-sm')}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          <Save className="w-4 h-4 shrink-0" />
          {successMessage}
        </div>
      )}

      {/* Master toggle */}
      <div className={cn(ds.panel, 'flex items-center justify-between')}>
        <div className="flex items-center gap-3">
          {settings.disabled ? (
            <BellOff className="w-5 h-5 text-zinc-400" />
          ) : (
            <Bell className="w-5 h-5 text-neon-cyan" />
          )}
          <div>
            <p className="text-sm font-medium text-white">
              {settings.disabled ? 'Initiatives Disabled' : 'Initiatives Enabled'}
            </p>
            <p className="text-xs text-zinc-400">
              {settings.disabled
                ? 'Concord will not proactively reach out to you'
                : 'Concord will send proactive messages based on your preferences'}
            </p>
          </div>
        </div>
        <ToggleSwitch
          checked={!settings.disabled}
          onChange={(checked) => updateSetting('disabled', !checked)}
          label="Enable initiatives"
        />
      </div>

      {/* Rest of settings -- only shown when enabled */}
      {!settings.disabled && (
        <>
          {/* Frequency controls */}
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-4">
              <Sliders className="w-4 h-4 text-zinc-400" />
              <h3 className="text-sm font-medium text-white">Frequency</h3>
            </div>

            {/* Max per day */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <label className={ds.label}>Max per day</label>
                <span className="text-sm font-mono text-neon-cyan">{settings.maxPerDay}</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={settings.maxPerDay}
                onChange={(e) => updateSetting('maxPerDay', parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neon-cyan
                  [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:shadow-neon-cyan/30
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-neon-cyan [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                <span>Off</span>
                <span>5/day</span>
                <span>10/day</span>
              </div>
            </div>

            {/* Max per week */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={ds.label}>Max per week</label>
                <span className="text-sm font-mono text-neon-cyan">{settings.maxPerWeek}</span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={settings.maxPerWeek}
                onChange={(e) => updateSetting('maxPerWeek', parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neon-cyan
                  [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:shadow-neon-cyan/30
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-neon-cyan [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                <span>Off</span>
                <span>25/week</span>
                <span>50/week</span>
              </div>
            </div>
          </div>

          {/* Quiet Hours */}
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-4">
              <Moon className="w-4 h-4 text-zinc-400" />
              <h3 className="text-sm font-medium text-white">Quiet Hours</h3>
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Concord will not send initiatives during these hours.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={ds.label}>Start (no messages after)</label>
                <input
                  type="time"
                  value={settings.quietStart}
                  onChange={(e) => updateSetting('quietStart', e.target.value)}
                  className={cn(ds.input, '[&::-webkit-calendar-picker-indicator]:invert')}
                />
              </div>
              <div>
                <label className={ds.label}>End (messages resume)</label>
                <input
                  type="time"
                  value={settings.quietEnd}
                  onChange={(e) => updateSetting('quietEnd', e.target.value)}
                  className={cn(ds.input, '[&::-webkit-calendar-picker-indicator]:invert')}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-400">
              <Clock className="w-3 h-3" />
              <span>
                Quiet from {settings.quietStart} to {settings.quietEnd} (your local time)
              </span>
            </div>
          </div>

          {/* Delivery Channels */}
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-zinc-400" />
              <h3 className="text-sm font-medium text-white">Delivery Channels</h3>
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              Choose how Concord reaches you. At least one channel should be enabled.
            </p>

            <div className="space-y-3">
              {Object.entries(settings.channels).map(([channelId, enabled]) => {
                const channelInfo = channelInfos.find(c => c.id === channelId);
                const ChannelIcon = CHANNEL_ICONS[channelId] || MessageSquare;

                return (
                  <div
                    key={channelId}
                    className={cn(
                      'flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors',
                      enabled
                        ? 'bg-lattice-elevated border-neon-cyan/20'
                        : 'bg-lattice-surface border-lattice-border',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <ChannelIcon className={cn(
                        'w-4 h-4',
                        enabled ? 'text-neon-cyan' : 'text-zinc-400',
                      )} />
                      <div>
                        <p className={cn(
                          'text-sm font-medium',
                          enabled ? 'text-white' : 'text-zinc-400',
                        )}>
                          {channelInfo?.label || channelId}
                        </p>
                        <p className="text-[10px] text-zinc-400">
                          {channelInfo?.description || ''}
                          {channelInfo?.requiresOptIn && (
                            <span className="ml-1 text-yellow-500">(requires opt-in)</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <ToggleSwitch
                      checked={enabled}
                      onChange={(checked) => updateChannel(channelId as keyof ChannelToggles, checked)}
                      label={`Toggle ${channelId}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Double Text */}
          <div className={cn(ds.panel, 'flex items-center justify-between')}>
            <div className="flex items-center gap-3">
              <MessageCircle className="w-5 h-5 text-zinc-400" />
              <div>
                <p className="text-sm font-medium text-white">Allow Double Texting</p>
                <p className="text-xs text-zinc-400">
                  Let Concord send follow-up messages with corrections, additional context,
                  or new thoughts without waiting for your reply
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={settings.allowDoubleText}
              onChange={(checked) => updateSetting('allowDoubleText', checked)}
              label="Allow double text"
            />
          </div>

          {/* Backoff Info */}
          {backoff && (
            <div className={ds.panel}>
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-medium text-white">Response Backoff</h3>
              </div>
              <p className="text-xs text-zinc-400 mb-3">
                Concord adapts its initiative frequency based on your responses.
                Ignoring or dismissing initiatives causes Concord to back off automatically.
              </p>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-lattice-surface border border-lattice-border">
                  <p className="text-[10px] text-zinc-400 mb-1">Ignored Count</p>
                  <p className={cn(
                    'text-lg font-mono',
                    backoff.ignoredCount > 5 ? 'text-orange-400' :
                    backoff.ignoredCount > 0 ? 'text-yellow-400' : 'text-white',
                  )}>
                    {backoff.ignoredCount}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-lattice-surface border border-lattice-border">
                  <p className="text-[10px] text-zinc-400 mb-1">Last Initiative</p>
                  <p className="text-sm text-white">
                    {backoff.lastInitiativeAt
                      ? formatTimeAgo(backoff.lastInitiativeAt)
                      : 'Never'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-lattice-surface border border-lattice-border">
                  <p className="text-[10px] text-zinc-400 mb-1">Backoff Until</p>
                  <p className={cn(
                    'text-sm',
                    backoff.backoffUntil ? 'text-orange-400' : 'text-emerald-400',
                  )}>
                    {backoff.backoffUntil
                      ? formatTimeAgo(backoff.backoffUntil)
                      : 'None'}
                  </p>
                </div>
              </div>

              {backoff.ignoredCount > 0 && (
                <p className="mt-3 text-[10px] text-zinc-400">
                  Responding to initiatives will gradually reduce the ignored count and remove any active backoff.
                </p>
              )}
            </div>
          )}

          {/* Trigger Previews */}
          <div className={ds.panel}>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-medium text-white">Trigger Previews</h3>
              </div>
              {showPreview ? (
                <ChevronUp className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              )}
            </button>
            <p className="text-xs text-zinc-400 mt-1">
              See examples of what each type of initiative looks like
            </p>

            {showPreview && (
              <div className="space-y-3 mt-4">
                {triggers.map((trigger) => {
                  const preview = TRIGGER_PREVIEWS[trigger.id];
                  if (!preview) return null;

                  const Icon = preview.icon;

                  return (
                    <div
                      key={trigger.id}
                      className={cn(
                        'rounded-lg border p-3',
                        preview.bgColor,
                        preview.borderColor,
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className={cn('w-4 h-4', preview.color)} />
                        <span className={cn('text-xs font-medium', preview.color)}>
                          {trigger.label}
                        </span>
                        <span className={cn(
                          'ml-auto text-[10px] px-1.5 py-0.5 rounded-full',
                          trigger.priority === 'high'
                            ? 'bg-red-500/10 text-red-400'
                            : trigger.priority === 'low'
                            ? 'bg-zinc-700/50 text-zinc-400'
                            : 'bg-blue-500/10 text-blue-400',
                        )}>
                          {trigger.priority}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed mb-2">
                        {preview.exampleMessage}
                      </p>
                      <p className="text-[10px] text-zinc-400">
                        {trigger.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Toggle Switch Sub-Component ────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 ease-in-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-lattice-void',
        checked ? 'bg-neon-cyan' : 'bg-zinc-700',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0',
          'transition duration-200 ease-in-out',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

// ── Utility ────────────────────────────────────────────────────────────

function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diff = now - then;

  // Future date (backoff until)
  if (diff < 0) {
    const absDiff = Math.abs(diff);
    const hours = Math.floor(absDiff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `in ${days}d`;
    if (hours > 0) return `in ${hours}h`;
    const mins = Math.floor(absDiff / (1000 * 60));
    return `in ${mins}m`;
  }

  // Past date
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default InitiativeSettings;

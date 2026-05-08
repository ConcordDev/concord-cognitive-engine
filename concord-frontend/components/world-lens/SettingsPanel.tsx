'use client';

import React, { useState, useCallback } from 'react';
import {
  Settings, Monitor, Volume2, Gamepad2, Bell, Lock, Globe, Eye,
  Sun, Cloud, Users, Sparkles, Trees, Headphones,
  Save, X, RotateCcw, Keyboard,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
type ProfileVisibility = 'public' | 'friends' | 'private';
type MeasurementUnit = 'metric' | 'imperial';
type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
type SettingsTab = 'graphics' | 'audio' | 'controls' | 'notifications' | 'privacy' | 'language' | 'accessibility';

interface GraphicsSettings {
  qualityPreset: QualityPreset;
  shadows: boolean;
  particles: boolean;
  weatherEffects: boolean;
  buildingDetail: boolean;
  npcDensity: boolean;
}

interface AudioSettings {
  master: number;
  music: number;
  ambient: number;
  sfx: number;
  dialogue: number;
  spatialAudio: boolean;
}

interface KeyBinding {
  action: string;
  key: string;
}

interface NotificationSettings {
  citation: boolean;
  royalty: boolean;
  event: boolean;
  social: boolean;
  system: boolean;
  dailyDigest: boolean;
  dndStart: string;
  dndEnd: string;
}

interface PrivacySettings {
  profileVisibility: ProfileVisibility;
  worldVisibility: boolean;
  activityStatus: boolean;
  allowDMs: boolean;
}

interface LanguageSettings {
  language: string;
  measurementUnit: MeasurementUnit;
  dateFormat: DateFormat;
}

interface AllSettings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: KeyBinding[];
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  language: LanguageSettings;
}

interface SettingsPanelProps {
  settings: AllSettings;
  onSave: (settings: AllSettings) => void;
  onCancel: () => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const TABS: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'graphics', label: 'Graphics', icon: Monitor },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'controls', label: 'Controls', icon: Gamepad2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'language', label: 'Language', icon: Globe },
  { id: 'accessibility', label: 'Accessibility', icon: Eye },
];

const QUALITY_PRESETS: { value: QualityPreset; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Espa\u00f1ol' },
  { code: 'fr', name: 'Fran\u00e7ais' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ja', name: '\u65e5\u672c\u8a9e' },
  { code: 'ko', name: '\ud55c\uad6d\uc5b4' },
  { code: 'zh', name: '\u4e2d\u6587' },
  { code: 'pt', name: 'Portugu\u00eas' },
  { code: 'ru', name: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' },
  { code: 'ar', name: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
  { code: 'hi', name: '\u0939\u093f\u0928\u094d\u0926\u0940' },
];

const _DEFAULT_KEYBINDINGS: KeyBinding[] = [
  { action: 'Move Forward', key: 'W' },
  { action: 'Move Back', key: 'S' },
  { action: 'Move Left', key: 'A' },
  { action: 'Move Right', key: 'D' },
  { action: 'Place Building', key: 'Space' },
  { action: 'Rotate Building', key: 'R' },
  { action: 'Delete Building', key: 'Delete' },
  { action: 'Open Inventory', key: 'I' },
  { action: 'Open Map', key: 'M' },
  { action: 'Open Chat', key: 'Enter' },
  { action: 'Undo', key: 'Ctrl+Z' },
  { action: 'Redo', key: 'Ctrl+Y' },
  { action: 'Quick Save', key: 'F5' },
  { action: 'Toggle HUD', key: 'F1' },
  { action: 'Screenshot', key: 'F12' },
];

/* ── Helpers ──────────────────────────────────────────────────── */

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-10 h-5 rounded-full transition-colors ${
        enabled ? 'bg-cyan-500' : 'bg-white/20'
      } relative`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function Slider({ value, min, max, step, onChange, label, suffix = '%' }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; label: string; suffix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-white/60 w-20">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-cyan-500"
      />
      <span className="text-xs text-white/80 w-12 text-right">{value}{suffix}</span>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

export default function SettingsPanel({ settings, onSave, onCancel }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('graphics');
  const [draft, setDraft] = useState<AllSettings>(JSON.parse(JSON.stringify(settings)));
  const [rebindingAction, setRebindingAction] = useState<string | null>(null);

  const updateGraphics = useCallback(
    <K extends keyof GraphicsSettings>(key: K, value: GraphicsSettings[K]) => {
      setDraft((d) => ({ ...d, graphics: { ...d.graphics, [key]: value } }));
    },
    [],
  );

  const updateAudio = useCallback(
    <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
      setDraft((d) => ({ ...d, audio: { ...d.audio, [key]: value } }));
    },
    [],
  );

  const updateNotifications = useCallback(
    <K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) => {
      setDraft((d) => ({ ...d, notifications: { ...d.notifications, [key]: value } }));
    },
    [],
  );

  const updatePrivacy = useCallback(
    <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) => {
      setDraft((d) => ({ ...d, privacy: { ...d.privacy, [key]: value } }));
    },
    [],
  );

  const updateLanguage = useCallback(
    <K extends keyof LanguageSettings>(key: K, value: LanguageSettings[K]) => {
      setDraft((d) => ({ ...d, language: { ...d.language, [key]: value } }));
    },
    [],
  );

  const rebindKey = useCallback((action: string, newKey: string) => {
    setDraft((d) => ({
      ...d,
      controls: d.controls.map((kb) =>
        kb.action === action ? { ...kb, key: newKey } : kb,
      ),
    }));
    setRebindingAction(null);
  }, []);

  const resetDefaults = useCallback(() => {
    setDraft(JSON.parse(JSON.stringify(settings)));
  }, [settings]);

  return (
    <div className={`${panel} p-0 w-[720px] max-h-[85vh] flex flex-col overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-cyan-400" /> Settings
        </h2>
        <button onClick={onCancel} className="text-white/40 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-white/10 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* ─── Graphics Tab ─────────────────────────────────── */}
        {activeTab === 'graphics' && (
          <>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Quality Preset</h3>
              <div className="flex gap-2">
                {QUALITY_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => updateGraphics('qualityPreset', p.value)}
                    className={`px-4 py-2 text-xs rounded-md border transition-colors ${
                      draft.graphics.qualityPreset === p.value
                        ? 'border-cyan-500 bg-cyan-500/10 text-white'
                        : 'border-white/10 text-white/50 hover:border-white/30'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Individual Settings</h3>
              {([
                ['shadows', 'Shadows', Sun],
                ['particles', 'Particles', Sparkles],
                ['weatherEffects', 'Weather Effects', Cloud],
                ['buildingDetail', 'Building Detail', Trees],
                ['npcDensity', 'NPC Density', Users],
              ] as const).map(([key, label, Icon]) => (
                <div key={key} className="flex items-center justify-between py-1">
                  <span className="text-sm text-white/60 flex items-center gap-2">
                    <Icon className="w-4 h-4" /> {label}
                  </span>
                  <Toggle
                    enabled={draft.graphics[key]}
                    onToggle={() => updateGraphics(key, !draft.graphics[key])}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* ─── Audio Tab ────────────────────────────────────── */}
        {activeTab === 'audio' && (
          <>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
                <Volume2 className="w-4 h-4" /> Volume Levels
              </h3>
              <Slider label="Master" value={draft.audio.master} min={0} max={100} step={1} onChange={(v) => updateAudio('master', v)} />
              <Slider label="Music" value={draft.audio.music} min={0} max={100} step={1} onChange={(v) => updateAudio('music', v)} />
              <Slider label="Ambient" value={draft.audio.ambient} min={0} max={100} step={1} onChange={(v) => updateAudio('ambient', v)} />
              <Slider label="SFX" value={draft.audio.sfx} min={0} max={100} step={1} onChange={(v) => updateAudio('sfx', v)} />
              <Slider label="Dialogue" value={draft.audio.dialogue} min={0} max={100} step={1} onChange={(v) => updateAudio('dialogue', v)} />
            </div>

            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-white/60 flex items-center gap-2">
                <Headphones className="w-4 h-4" /> Spatial Audio
              </span>
              <Toggle
                enabled={draft.audio.spatialAudio}
                onToggle={() => updateAudio('spatialAudio', !draft.audio.spatialAudio)}
              />
            </div>
          </>
        )}

        {/* ─── Controls Tab ─────────────────────────────────── */}
        {activeTab === 'controls' && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
              <Keyboard className="w-4 h-4" /> Key Bindings
            </h3>
            <p className="text-xs text-white/40">Click a key to rebind it. Press Escape to cancel.</p>
            <div className={`${panel} divide-y divide-white/5`}>
              <div className="flex px-3 py-2 text-[10px] text-white/40 uppercase tracking-wider">
                <span className="flex-1">Action</span>
                <span className="w-28 text-center">Key</span>
              </div>
              {draft.controls.map((kb) => (
                <div key={kb.action} className="flex items-center px-3 py-2">
                  <span className="flex-1 text-xs text-white/70">{kb.action}</span>
                  <button
                    onClick={() => setRebindingAction(kb.action)}
                    onKeyDown={(e) => {
                      if (rebindingAction === kb.action && e.key !== 'Escape') {
                        rebindKey(kb.action, e.key.length === 1 ? e.key.toUpperCase() : e.key);
                      } else if (e.key === 'Escape') {
                        setRebindingAction(null);
                      }
                    }}
                    className={`w-28 text-center px-2 py-1 text-xs rounded border transition-colors ${
                      rebindingAction === kb.action
                        ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300 animate-pulse'
                        : 'border-white/10 text-white/60 hover:border-white/30'
                    }`}
                  >
                    {rebindingAction === kb.action ? 'Press key...' : kb.key}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Notifications Tab ────────────────────────────── */}
        {activeTab === 'notifications' && (
          <>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Notification Types</h3>
              {([
                ['citation', 'Citation Alerts'],
                ['royalty', 'Royalty Payments'],
                ['event', 'World Events'],
                ['social', 'Social Activity'],
                ['system', 'System Messages'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between py-1">
                  <span className="text-sm text-white/60">{label}</span>
                  <Toggle
                    enabled={draft.notifications[key]}
                    onToggle={() => updateNotifications(key, !draft.notifications[key])}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between py-2 border-t border-white/10">
              <span className="text-sm text-white/60">Daily Digest Email</span>
              <Toggle
                enabled={draft.notifications.dailyDigest}
                onToggle={() => updateNotifications('dailyDigest', !draft.notifications.dailyDigest)}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-white/70">Do Not Disturb</h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-white/50">From</label>
                  <input
                    type="time"
                    value={draft.notifications.dndStart}
                    onChange={(e) => updateNotifications('dndStart', e.target.value)}
                    className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-white/50">To</label>
                  <input
                    type="time"
                    value={draft.notifications.dndEnd}
                    onChange={(e) => updateNotifications('dndEnd', e.target.value)}
                    className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* ─── Privacy Tab ──────────────────────────────────── */}
        {activeTab === 'privacy' && (
          <>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Profile Visibility</h3>
              <div className="flex gap-2">
                {(['public', 'friends', 'private'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => updatePrivacy('profileVisibility', v)}
                    className={`px-4 py-2 text-xs rounded-md border capitalize transition-colors ${
                      draft.privacy.profileVisibility === v
                        ? 'border-cyan-500 bg-cyan-500/10 text-white'
                        : 'border-white/10 text-white/50 hover:border-white/30'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {([
              ['worldVisibility', 'World Visible to Others'],
              ['activityStatus', 'Show Activity Status'],
              ['allowDMs', 'Allow Direct Messages'],
            ] as const).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between py-2">
                <span className="text-sm text-white/60">{label}</span>
                <Toggle
                  enabled={draft.privacy[key]}
                  onToggle={() => updatePrivacy(key, !draft.privacy[key])}
                />
              </div>
            ))}
          </>
        )}

        {/* ─── Language Tab ─────────────────────────────────── */}
        {activeTab === 'language' && (
          <>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Display Language</h3>
              <div className="grid grid-cols-2 gap-2">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => updateLanguage('language', lang.code)}
                    className={`px-3 py-2 text-sm rounded-md border text-left transition-colors ${
                      draft.language.language === lang.code
                        ? 'border-cyan-500 bg-cyan-500/10 text-white'
                        : 'border-white/10 text-white/50 hover:border-white/30'
                    }`}
                  >
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Measurement Units</h3>
              <div className="flex gap-2">
                {(['metric', 'imperial'] as const).map((u) => (
                  <button
                    key={u}
                    onClick={() => updateLanguage('measurementUnit', u)}
                    className={`px-4 py-2 text-xs rounded-md border capitalize transition-colors ${
                      draft.language.measurementUnit === u
                        ? 'border-cyan-500 bg-cyan-500/10 text-white'
                        : 'border-white/10 text-white/50 hover:border-white/30'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Date Format</h3>
              <div className="flex gap-2">
                {(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => updateLanguage('dateFormat', f)}
                    className={`px-4 py-2 text-xs rounded-md border transition-colors ${
                      draft.language.dateFormat === f
                        ? 'border-cyan-500 bg-cyan-500/10 text-white'
                        : 'border-white/10 text-white/50 hover:border-white/30'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ─── Accessibility Tab (link) ─────────────────────── */}
        {activeTab === 'accessibility' && (
          <div className="text-center py-8 space-y-3">
            <Eye className="w-10 h-10 text-cyan-400 mx-auto" />
            <p className="text-sm text-white/70">
              Full accessibility settings are available in the dedicated Accessibility Panel.
            </p>
            <p className="text-xs text-white/40">
              Colorblind modes, text scaling, screen reader support, reduced motion, keyboard navigation, subtitles, one-handed controls, game speed, and high contrast mode.
            </p>
          </div>
        )}
      </div>

      {/* Footer Buttons */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
        <button
          onClick={resetDefaults}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/30 rounded-md transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-white/60 hover:text-white border border-white/10 hover:border-white/30 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
          >
            <Save className="w-3.5 h-3.5" /> Apply
          </button>
        </div>
      </div>
    </div>
  );
}

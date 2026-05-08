'use client';

import React, { useState, useCallback } from 'react';
import {
  Eye, Type, Ear, Keyboard, Zap, MessageSquare, Hand, Gauge,
  Contrast, RotateCcw, Circle, Triangle, Square,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type ColorblindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';
type OneHandedMode = 'off' | 'left' | 'right';

interface AccessibilitySettings {
  colorblindMode: ColorblindMode;
  textScale: number;
  screenReader: boolean;
  keyboardNavigation: boolean;
  reducedMotion: boolean;
  subtitles: boolean;
  subtitleFontSize: number;
  oneHandedMode: OneHandedMode;
  gameSpeed: number;
  highContrast: boolean;
}

interface AccessibilityPanelProps {
  settings: AccessibilitySettings;
  onChange: (settings: AccessibilitySettings) => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const COLORBLIND_OPTIONS: { value: ColorblindMode; label: string; description: string }[] = [
  { value: 'none',          label: 'None',          description: 'Default color vision' },
  { value: 'protanopia',    label: 'Protanopia',    description: 'Reduced red sensitivity' },
  { value: 'deuteranopia',  label: 'Deuteranopia',  description: 'Reduced green sensitivity' },
  { value: 'tritanopia',    label: 'Tritanopia',    description: 'Reduced blue sensitivity' },
  { value: 'achromatopsia', label: 'Achromatopsia', description: 'Complete color blindness' },
];

const COLORBLIND_PREVIEWS: Record<ColorblindMode, { pass: string; warn: string; fail: string }> = {
  none:          { pass: 'bg-green-500', warn: 'bg-yellow-500', fail: 'bg-red-500' },
  protanopia:    { pass: 'bg-blue-500',  warn: 'bg-yellow-400', fail: 'bg-amber-700' },
  deuteranopia:  { pass: 'bg-blue-400',  warn: 'bg-yellow-300', fail: 'bg-orange-700' },
  tritanopia:    { pass: 'bg-teal-500',  warn: 'bg-pink-400',  fail: 'bg-red-600' },
  achromatopsia: { pass: 'bg-gray-300',  warn: 'bg-gray-500',  fail: 'bg-gray-700' },
};

const _VALIDATION_SHAPES: React.ComponentType<{ className?: string }>[] = [Circle, Triangle, Square];

const KEYBOARD_SHORTCUTS = [
  { key: 'Tab',       action: 'Navigate between UI elements' },
  { key: 'Enter',     action: 'Confirm / select' },
  { key: 'Escape',    action: 'Close panel / cancel' },
  { key: 'Arrow keys', action: 'Move camera / selection' },
  { key: 'Space',     action: 'Place building / interact' },
  { key: '1-9',       action: 'Quick-select toolbar items' },
  { key: '?',         action: 'Open help overlay' },
];

const DEFAULTS: AccessibilitySettings = {
  colorblindMode: 'none',
  textScale: 1.0,
  screenReader: false,
  keyboardNavigation: false,
  reducedMotion: false,
  subtitles: true,
  subtitleFontSize: 16,
  oneHandedMode: 'off',
  gameSpeed: 1.0,
  highContrast: false,
};

/* ── Component ─────────────────────────────────────────────────── */

export default function AccessibilityPanel({ settings, onChange }: AccessibilityPanelProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);

  const update = useCallback(
    <K extends keyof AccessibilitySettings>(key: K, value: AccessibilitySettings[K]) => {
      onChange({ ...settings, [key]: value });
    },
    [settings, onChange],
  );

  const preview = COLORBLIND_PREVIEWS[settings.colorblindMode];

  return (
    <div className={`${panel} p-5 space-y-6 max-h-[80vh] overflow-y-auto`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Eye className="w-5 h-5 text-cyan-400" />
          Accessibility Settings
        </h2>
      </div>

      {/* Colorblind Mode */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
          <Eye className="w-4 h-4" /> Colorblind Mode
        </h3>
        <div className="grid grid-cols-1 gap-2">
          {COLORBLIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update('colorblindMode', opt.value)}
              className={`text-left px-3 py-2 rounded-md border transition-colors ${
                settings.colorblindMode === opt.value
                  ? 'border-cyan-500 bg-cyan-500/10 text-white'
                  : 'border-white/10 text-white/60 hover:border-white/30'
              }`}
            >
              <span className="text-sm font-medium">{opt.label}</span>
              <span className="text-xs text-white/40 ml-2">{opt.description}</span>
            </button>
          ))}
        </div>

        {/* Color Preview */}
        <div className="flex items-center gap-3 p-3 rounded-md bg-white/5">
          <span className="text-xs text-white/50">Validation colors:</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Pass</span>
            <div className={`w-6 h-6 rounded ${preview.pass} flex items-center justify-center`}>
              <Circle className="w-3 h-3 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Warn</span>
            <div className={`w-6 h-6 rounded ${preview.warn} flex items-center justify-center`}>
              <Triangle className="w-3 h-3 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Fail</span>
            <div className={`w-6 h-6 rounded ${preview.fail} flex items-center justify-center`}>
              <Square className="w-3 h-3 text-white" />
            </div>
          </div>
        </div>
      </section>

      {/* Text Scaling */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
          <Type className="w-4 h-4" /> Text Scaling
        </h3>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.75}
            max={2.0}
            step={0.05}
            value={settings.textScale}
            onChange={(e) => update('textScale', parseFloat(e.target.value))}
            className="flex-1 accent-cyan-500"
          />
          <span className="text-sm text-white/80 w-12 text-right">{settings.textScale.toFixed(2)}x</span>
        </div>
        <p
          className="text-white/50 transition-all"
          style={{ fontSize: `${settings.textScale * 14}px` }}
        >
          Live preview: This text scales with your setting.
        </p>
      </section>

      {/* Screen Reader */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <Ear className="w-4 h-4" /> Screen Reader Support
          </h3>
          <button
            onClick={() => update('screenReader', !settings.screenReader)}
            className={`w-10 h-5 rounded-full transition-colors ${
              settings.screenReader ? 'bg-cyan-500' : 'bg-white/20'
            } relative`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.screenReader ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-white/40">
          Narrates: UI element focus, building placement confirmations, validation results,
          NPC dialogue, notification content, menu navigation, and status changes.
        </p>
      </section>

      {/* Keyboard Navigation */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <Keyboard className="w-4 h-4" /> Keyboard Navigation
          </h3>
          <button
            onClick={() => update('keyboardNavigation', !settings.keyboardNavigation)}
            className={`w-10 h-5 rounded-full transition-colors ${
              settings.keyboardNavigation ? 'bg-cyan-500' : 'bg-white/20'
            } relative`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.keyboardNavigation ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <button
          onClick={() => setShowShortcuts(!showShortcuts)}
          className="text-xs text-cyan-400 hover:text-cyan-300 underline"
        >
          {showShortcuts ? 'Hide' : 'Show'} shortcut reference
        </button>
        {showShortcuts && (
          <div className={`${panel} p-3 space-y-1`}>
            {KEYBOARD_SHORTCUTS.map((s) => (
              <div key={s.key} className="flex justify-between text-xs">
                <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono">
                  {s.key}
                </kbd>
                <span className="text-white/50">{s.action}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reduced Motion */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <Zap className="w-4 h-4" /> Reduced Motion
          </h3>
          <button
            onClick={() => update('reducedMotion', !settings.reducedMotion)}
            className={`w-10 h-5 rounded-full transition-colors ${
              settings.reducedMotion ? 'bg-cyan-500' : 'bg-white/20'
            } relative`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.reducedMotion ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-white/40">
          Disables particles, camera shake, animated transitions, and weather effects.
        </p>
      </section>

      {/* Subtitles */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> NPC Dialogue Subtitles
          </h3>
          <button
            onClick={() => update('subtitles', !settings.subtitles)}
            className={`w-10 h-5 rounded-full transition-colors ${
              settings.subtitles ? 'bg-cyan-500' : 'bg-white/20'
            } relative`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.subtitles ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        {settings.subtitles && (
          <div className="flex items-center gap-3">
            <label className="text-xs text-white/50">Font size</label>
            <input
              type="range"
              min={12}
              max={32}
              step={2}
              value={settings.subtitleFontSize}
              onChange={(e) => update('subtitleFontSize', parseInt(e.target.value))}
              className="flex-1 accent-cyan-500"
            />
            <span className="text-sm text-white/80 w-10 text-right">{settings.subtitleFontSize}px</span>
          </div>
        )}
      </section>

      {/* One-Handed Controls */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
          <Hand className="w-4 h-4" /> One-Handed Controls
        </h3>
        <div className="flex gap-2">
          {([['off', 'Off'], ['left', 'Left Hand'], ['right', 'Right Hand']] as const).map(
            ([val, label]) => (
              <button
                key={val}
                onClick={() => update('oneHandedMode', val)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  settings.oneHandedMode === val
                    ? 'border-cyan-500 bg-cyan-500/10 text-white'
                    : 'border-white/10 text-white/50 hover:border-white/30'
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </section>

      {/* Game Speed */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
          <Gauge className="w-4 h-4" /> Game Speed
        </h3>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={settings.gameSpeed}
            onChange={(e) => update('gameSpeed', parseFloat(e.target.value))}
            className="flex-1 accent-cyan-500"
          />
          <span className="text-sm text-white/80 w-12 text-right">{settings.gameSpeed.toFixed(1)}x</span>
        </div>
      </section>

      {/* High Contrast */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <Contrast className="w-4 h-4" /> High Contrast Mode
          </h3>
          <button
            onClick={() => update('highContrast', !settings.highContrast)}
            className={`w-10 h-5 rounded-full transition-colors ${
              settings.highContrast ? 'bg-cyan-500' : 'bg-white/20'
            } relative`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.highContrast ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Reset */}
      <button
        onClick={() => onChange(DEFAULTS)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors text-sm"
      >
        <RotateCcw className="w-4 h-4" /> Reset to Defaults
      </button>
    </div>
  );
}

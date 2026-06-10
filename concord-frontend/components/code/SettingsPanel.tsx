'use client';

import { useEffect, useState } from 'react';
import { X, Save, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface CodeLensSettings {
  editor: {
    fontSize: number;
    fontFamily: string;
    tabSize: number;
    wordWrap: 'on' | 'off';
    minimap: boolean;
    lineNumbers: 'on' | 'off' | 'relative';
    bracketPairColorization: boolean;
    formatOnPaste: boolean;
    formatOnType: boolean;
    cursorBlinking: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
    smoothScrolling: boolean;
  };
  ai: {
    model: 'utility' | 'subconscious' | 'conscious';
    temperature: number;
    maxTokens: number;
    autoIncludeFile: boolean;
    extractCitations: boolean;
  };
  terminal: {
    fontSize: number;
    cursorStyle: 'block' | 'underline' | 'bar';
  };
}

export const DEFAULT_SETTINGS: CodeLensSettings = {
  editor: {
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    tabSize: 2,
    wordWrap: 'on',
    minimap: true,
    lineNumbers: 'on',
    bracketPairColorization: true,
    formatOnPaste: true,
    formatOnType: false,
    cursorBlinking: 'smooth',
    smoothScrolling: true,
  },
  ai: {
    model: 'utility',
    temperature: 0.2,
    maxTokens: 2048,
    autoIncludeFile: true,
    extractCitations: true,
  },
  terminal: {
    fontSize: 13,
    cursorStyle: 'block',
  },
};

const STORAGE_KEY = 'concord:code:settings:v1';

export function loadSettings(): CodeLensSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      editor: { ...DEFAULT_SETTINGS.editor, ...(parsed.editor || {}) },
      ai: { ...DEFAULT_SETTINGS.ai, ...(parsed.ai || {}) },
      terminal: { ...DEFAULT_SETTINGS.terminal, ...(parsed.terminal || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: CodeLensSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage may be full / disabled — fail silently
  }
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onChange: (s: CodeLensSettings) => void;
  initial?: CodeLensSettings;
}

export default function SettingsPanel({ open, onClose, onChange, initial }: SettingsPanelProps) {
  const [tab, setTab] = useState<'editor' | 'ai' | 'terminal'>('editor');
  const [settings, setSettings] = useState<CodeLensSettings>(initial ?? DEFAULT_SETTINGS);

  useEffect(() => {
    if (open) setSettings(initial ?? loadSettings());
  }, [open, initial]);

  const update = (next: CodeLensSettings) => {
    setSettings(next);
    saveSettings(next);
    onChange(next);
  };

  const reset = () => update(DEFAULT_SETTINGS);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-3xl max-h-[80vh] bg-[#0d1117] border border-cyan-500/30 rounded-xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gradient-to-r from-cyan-500/5 to-purple-500/5">
              <div className="flex items-center gap-3">
                <h2 id="settings-title" className="text-sm font-bold text-white">Code Lens Settings</h2>
                <span className="text-[10px] text-gray-400">Persisted to browser · per-user</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={reset}
                  title="Reset to defaults"
                  className="px-2 py-1 text-[11px] text-gray-400 hover:text-white rounded inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close settings"
                  className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>
            <div className="flex flex-1 min-h-0">
              <nav className="w-40 shrink-0 border-r border-white/10 bg-[#0a0e17] py-2 text-sm" aria-label="Settings categories">
                {(['editor', 'ai', 'terminal'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`block w-full text-left px-4 py-1.5 capitalize ${tab === t ? 'bg-cyan-500/15 text-cyan-200 border-l-2 border-cyan-400' : 'text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-transparent'}`}
                  >
                    {t === 'ai' ? 'AI Pair' : t}
                  </button>
                ))}
              </nav>
              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
                {tab === 'editor' && (
                  <>
                    <Row label="Font size">
                      <input
                        type="number" min={10} max={32}
                        value={settings.editor.fontSize}
                        onChange={(e) => update({ ...settings, editor: { ...settings.editor, fontSize: Number(e.target.value) || 14 } })}
                        className="w-20 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
                      />
                    </Row>
                    <Row label="Font family">
                      <input
                        type="text"
                        value={settings.editor.fontFamily}
                        onChange={(e) => update({ ...settings, editor: { ...settings.editor, fontFamily: e.target.value } })}
                        className="w-72 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white text-xs font-mono"
                      />
                    </Row>
                    <Row label="Tab size">
                      <input
                        type="number" min={1} max={8}
                        value={settings.editor.tabSize}
                        onChange={(e) => update({ ...settings, editor: { ...settings.editor, tabSize: Number(e.target.value) || 2 } })}
                        className="w-16 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
                      />
                    </Row>
                    <Row label="Word wrap">
                      <Select
                        value={settings.editor.wordWrap}
                        options={[['on', 'On'], ['off', 'Off']]}
                        onChange={(v) => update({ ...settings, editor: { ...settings.editor, wordWrap: v as 'on' | 'off' } })}
                      />
                    </Row>
                    <Row label="Line numbers">
                      <Select
                        value={settings.editor.lineNumbers}
                        options={[['on', 'On'], ['off', 'Off'], ['relative', 'Relative']]}
                        onChange={(v) => update({ ...settings, editor: { ...settings.editor, lineNumbers: v as 'on' | 'off' | 'relative' } })}
                      />
                    </Row>
                    <Row label="Cursor blinking">
                      <Select
                        value={settings.editor.cursorBlinking}
                        options={[['blink', 'Blink'], ['smooth', 'Smooth'], ['phase', 'Phase'], ['expand', 'Expand'], ['solid', 'Solid']]}
                        onChange={(v) => update({ ...settings, editor: { ...settings.editor, cursorBlinking: v as CodeLensSettings['editor']['cursorBlinking'] } })}
                      />
                    </Row>
                    <Toggle label="Minimap" checked={settings.editor.minimap} onChange={(v) => update({ ...settings, editor: { ...settings.editor, minimap: v } })} />
                    <Toggle label="Bracket pair colourisation" checked={settings.editor.bracketPairColorization} onChange={(v) => update({ ...settings, editor: { ...settings.editor, bracketPairColorization: v } })} />
                    <Toggle label="Format on paste" checked={settings.editor.formatOnPaste} onChange={(v) => update({ ...settings, editor: { ...settings.editor, formatOnPaste: v } })} />
                    <Toggle label="Format on type" checked={settings.editor.formatOnType} onChange={(v) => update({ ...settings, editor: { ...settings.editor, formatOnType: v } })} />
                    <Toggle label="Smooth scrolling" checked={settings.editor.smoothScrolling} onChange={(v) => update({ ...settings, editor: { ...settings.editor, smoothScrolling: v } })} />
                  </>
                )}

                {tab === 'ai' && (
                  <>
                    <Row label="Brain slot">
                      <Select
                        value={settings.ai.model}
                        options={[['utility', 'Utility (qwen 3B, fast)'], ['subconscious', 'Subconscious (qwen 7B, balanced)'], ['conscious', 'Conscious (custom, deep)']]}
                        onChange={(v) => update({ ...settings, ai: { ...settings.ai, model: v as CodeLensSettings['ai']['model'] } })}
                      />
                    </Row>
                    <Row label="Temperature">
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={settings.ai.temperature}
                        onChange={(e) => update({ ...settings, ai: { ...settings.ai, temperature: Number(e.target.value) } })}
                        className="w-48 accent-cyan-400"
                      />
                      <span className="ml-2 text-xs text-cyan-300 font-mono">{settings.ai.temperature.toFixed(2)}</span>
                    </Row>
                    <Row label="Max tokens">
                      <input
                        type="number" min={128} max={8192} step={128}
                        value={settings.ai.maxTokens}
                        onChange={(e) => update({ ...settings, ai: { ...settings.ai, maxTokens: Number(e.target.value) || 2048 } })}
                        className="w-24 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
                      />
                    </Row>
                    <Toggle label="Auto-include open file in chat" checked={settings.ai.autoIncludeFile} onChange={(v) => update({ ...settings, ai: { ...settings.ai, autoIncludeFile: v } })} />
                    <Toggle label="Extract DTU citations from replies" checked={settings.ai.extractCitations} onChange={(v) => update({ ...settings, ai: { ...settings.ai, extractCitations: v } })} />
                  </>
                )}

                {tab === 'terminal' && (
                  <>
                    <Row label="Font size">
                      <input
                        type="number" min={10} max={24}
                        value={settings.terminal.fontSize}
                        onChange={(e) => update({ ...settings, terminal: { ...settings.terminal, fontSize: Number(e.target.value) || 13 } })}
                        className="w-20 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
                      />
                    </Row>
                    <Row label="Cursor style">
                      <Select
                        value={settings.terminal.cursorStyle}
                        options={[['block', 'Block'], ['underline', 'Underline'], ['bar', 'Bar']]}
                        onChange={(v) => update({ ...settings, terminal: { ...settings.terminal, cursorStyle: v as CodeLensSettings['terminal']['cursorStyle'] } })}
                      />
                    </Row>
                  </>
                )}
              </div>
            </div>
            <footer className="px-4 py-2 border-t border-white/10 text-[11px] text-gray-400 flex justify-between bg-[#0a0e17]">
              <span>Changes save automatically · Esc to close</span>
              <span className="inline-flex items-center gap-1 text-green-400"><Save className="w-3 h-3" /> Saved</span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <label className="w-44 text-gray-300 text-xs">{label}</label>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function Select({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white text-xs"
    >
      {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
    </select>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <span className="w-44 text-gray-300 text-xs">{label}</span>
      <button aria-label="Toggle"
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-cyan-500' : 'bg-gray-700'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </button>
    </label>
  );
}

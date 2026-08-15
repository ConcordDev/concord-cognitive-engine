/**
 * SettingsPanel.tsx — game config UI (graphics, audio, controls).
 */

import { useState } from 'react';

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  graphicsQuality: GraphicsQuality;
  renderScale: number;
  shadowQuality: 'off' | 'low' | 'high';
  antiAliasing: boolean;
  bloomEnabled: boolean;
  motionBlurEnabled: boolean;
  audioMasterVolume: number;
  audioMusicVolume: number;
  audioSfxVolume: number;
  audioAmbientVolume: number;
  controlsInvertY: boolean;
  controlsMouseSensitivity: number;
  controlsKeybinds: Record<string, string>;
  language: 'en' | 'es' | 'fr' | 'de' | 'ja' | 'zh';
  chatFilterEnabled: boolean;
  showFps: boolean;
  showDamageNumbers: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  graphicsQuality: 'high',
  renderScale: 1.0,
  shadowQuality: 'high',
  antiAliasing: true,
  bloomEnabled: true,
  motionBlurEnabled: false,
  audioMasterVolume: 1.0,
  audioMusicVolume: 0.6,
  audioSfxVolume: 0.8,
  audioAmbientVolume: 0.5,
  controlsInvertY: false,
  controlsMouseSensitivity: 1.0,
  controlsKeybinds: {
    move_forward: 'W',
    move_back: 'S',
    move_left: 'A',
    move_right: 'D',
    jump: 'Space',
    crouch: 'C',
    interact: 'E',
    inventory: 'I',
    vendor: 'V',
    map: 'M',
    quest_log: 'L',
    emote_wheel: 'B',
    chat: 'Enter',
  },
  language: 'en',
  chatFilterEnabled: true,
  showFps: false,
  showDamageNumbers: true,
};

interface SettingsPanelProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const [draft, setDraft] = useState<Settings>(settings);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft({ ...draft, [key]: value });
  };

  const save = () => {
    onChange(draft);
    onClose();
  };

  const reset = () => setDraft(DEFAULT_SETTINGS);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300,
    }} data-testid="settings-panel">
      <div style={{
        background: 'rgba(20, 20, 25, 0.95)',
        border: '2px solid #d98c33',
        borderRadius: 8,
        padding: 24,
        width: 640,
        maxHeight: '80vh',
        overflowY: 'auto',
        color: '#e0d8c8',
        fontFamily: 'Georgia, serif',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, color: '#d98c33', margin: 0 }}>Settings</h2>
          <button onClick={onClose} style={closeButtonStyle}>×</button>
        </div>

        <Section title="Graphics">
          <SelectRow label="Quality" value={draft.graphicsQuality}
                     options={['low', 'medium', 'high', 'ultra']}
                     onChange={(v) => update('graphicsQuality', v as GraphicsQuality)} />
          <SliderRow label="Render Scale" value={draft.renderScale}
                     min={0.5} max={2.0} step={0.1}
                     onChange={(v) => update('renderScale', v)} />
          <SelectRow label="Shadows" value={draft.shadowQuality}
                     options={['off', 'low', 'high']}
                     onChange={(v) => update('shadowQuality', v as Settings['shadowQuality'])} />
          <ToggleRow label="Anti-aliasing" value={draft.antiAliasing}
                     onChange={(v) => update('antiAliasing', v)} />
          <ToggleRow label="Bloom" value={draft.bloomEnabled}
                     onChange={(v) => update('bloomEnabled', v)} />
          <ToggleRow label="Motion Blur" value={draft.motionBlurEnabled}
                     onChange={(v) => update('motionBlurEnabled', v)} />
        </Section>

        <Section title="Audio">
          <SliderRow label="Master" value={draft.audioMasterVolume} min={0} max={1} step={0.05}
                     onChange={(v) => update('audioMasterVolume', v)} />
          <SliderRow label="Music" value={draft.audioMusicVolume} min={0} max={1} step={0.05}
                     onChange={(v) => update('audioMusicVolume', v)} />
          <SliderRow label="SFX" value={draft.audioSfxVolume} min={0} max={1} step={0.05}
                     onChange={(v) => update('audioSfxVolume', v)} />
          <SliderRow label="Ambient" value={draft.audioAmbientVolume} min={0} max={1} step={0.05}
                     onChange={(v) => update('audioAmbientVolume', v)} />
        </Section>

        <Section title="Controls">
          <ToggleRow label="Invert Y" value={draft.controlsInvertY}
                     onChange={(v) => update('controlsInvertY', v)} />
          <SliderRow label="Mouse Sensitivity" value={draft.controlsMouseSensitivity}
                     min={0.1} max={3.0} step={0.1}
                     onChange={(v) => update('controlsMouseSensitivity', v)} />
        </Section>

        <Section title="Interface">
          <SelectRow label="Language" value={draft.language}
                     options={['en', 'es', 'fr', 'de', 'ja', 'zh']}
                     onChange={(v) => update('language', v as Settings['language'])} />
          <ToggleRow label="Chat Filter" value={draft.chatFilterEnabled}
                     onChange={(v) => update('chatFilterEnabled', v)} />
          <ToggleRow label="Show FPS" value={draft.showFps}
                     onChange={(v) => update('showFps', v)} />
          <ToggleRow label="Damage Numbers" value={draft.showDamageNumbers}
                     onChange={(v) => update('showDamageNumbers', v)} />
        </Section>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <button onClick={reset} style={resetButtonStyle}>Reset to Defaults</button>
          <button onClick={save} style={saveButtonStyle}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 'bold', color: '#d98c33', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span>{label}</span>
      <button onClick={() => onChange(!value)} style={{
        padding: '2px 12px', border: '1px solid #d98c33',
        background: value ? '#3a5a3a' : '#3a3a3a',
        color: value ? '#fff' : '#888',
        borderRadius: 3, cursor: 'pointer',
      }}>
        {value ? 'On' : 'Off'}
      </button>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <span style={{ flex: 1 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(parseFloat(e.target.value))}
             style={{ flex: 2 }} />
      <span style={{ width: 40, textAlign: 'right', color: '#aaa' }}>{value.toFixed(2)}</span>
    </div>
  );
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <span style={{ flex: 1 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        background: '#2a2a30', color: '#e0d8c8', border: '1px solid #d98c33',
        padding: '2px 4px', borderRadius: 3,
      }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

const closeButtonStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#d98c33', cursor: 'pointer', fontSize: 24,
};
const saveButtonStyle: React.CSSProperties = {
  background: '#3a5a3a', color: '#fff', border: 'none', padding: '8px 16px',
  borderRadius: 4, cursor: 'pointer', fontSize: 14,
};
const resetButtonStyle: React.CSSProperties = {
  background: '#5a3a3a', color: '#fff', border: 'none', padding: '8px 16px',
  borderRadius: 4, cursor: 'pointer', fontSize: 14,
};

export { DEFAULT_SETTINGS };
export default SettingsPanel;

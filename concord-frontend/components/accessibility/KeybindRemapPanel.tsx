'use client';

/**
 * KeybindRemapPanel — F2.
 *
 * Per-action keyboard rebinding for combat. Reads the active keybinding
 * profile, lets the player click an action then press a key to rebind it
 * (conflict-swap handled by remapAction), and persists via saveActiveProfile —
 * which fires concordia:keybindings-changed so CombatInputController picks the
 * new binding up instantly. Includes a reset-to-default.
 */

import { useEffect, useState } from 'react';
import {
  type KeyAction, type KeyProfile,
  loadActiveProfile, saveActiveProfile, remapAction, resetToDefault,
} from '@/lib/concordia/keybindings';

const ACTION_LABELS: Record<KeyAction, string> = {
  light: 'Light attack',
  heavy: 'Heavy attack',
  finisher: 'Finisher',
  parry: 'Parry',
  grab: 'Grab',
  kick: 'Kick',
  dodge: 'Dodge',
  modifier: 'Modifier (off-hand)',
};

export default function KeybindRemapPanel() {
  const [profile, setProfile] = useState<KeyProfile>(loadActiveProfile);
  const [listening, setListening] = useState<KeyAction | null>(null);

  useEffect(() => {
    if (!listening) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
      const next = remapAction(profile, listening!, key);
      saveActiveProfile(next);
      setProfile(next);
      setListening(null);
    }
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [listening, profile]);

  return (
    <div data-testid="keybind-remap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontWeight: 600 }}>Combat keybinds</h3>
        <button
          type="button"
          onClick={() => { resetToDefault(); setProfile(loadActiveProfile()); }}
          style={{ fontSize: 12, opacity: 0.8, textDecoration: 'underline' }}
        >
          Reset to default
        </button>
      </div>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(ACTION_LABELS) as KeyAction[]).map((action) => {
          const b = profile.bindings[action];
          const isListening = listening === action;
          return (
            <li key={action} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{ACTION_LABELS[action]}</span>
              <button
                type="button"
                onClick={() => setListening(action)}
                aria-label={`Rebind ${ACTION_LABELS[action]}, currently ${b.key} (${b.variant})`}
                style={{
                  minWidth: 96, padding: '2px 10px', borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.25)',
                  background: isListening ? 'rgba(255,215,106,0.25)' : 'rgba(255,255,255,0.08)',
                  fontFamily: 'monospace',
                }}
              >
                {isListening ? 'Press a key…' : `${b.key.toUpperCase()} · ${b.variant}`}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

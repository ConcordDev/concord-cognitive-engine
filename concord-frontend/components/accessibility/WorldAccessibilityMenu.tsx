'use client';

/**
 * WorldAccessibilityMenu — F4 / G3.2.
 *
 * The world-lens settings menu was a no-op (onMenuOpen={() => {}}). This is
 * the real settings surface: a modal wrapping the store-bound AccessibilityPanel
 * plus the F2 combat keybind remap. Opens on `open`, closes on Escape / backdrop.
 */

import { useEffect } from 'react';
import AccessibilityPanel from '@/components/world-lens/AccessibilityPanel';
import KeybindRemapPanel from './KeybindRemapPanel';
import { useAccessibilitySettings, useSetAccessibility } from '@/hooks/useAccessibilitySettings';
import type { AccessibilitySettings } from '@/store/slices/accessibility';

export default function WorldAccessibilityMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const a11y = useAccessibilitySettings();
  const { setAllAccessibility } = useSetAccessibility();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // The panel uses its own local settings shape (same keys as the slice).
  const settings: AccessibilitySettings = {
    colorblindMode: a11y.colorblindMode,
    textScale: a11y.textScale,
    screenReader: a11y.screenReader,
    keyboardNavigation: a11y.keyboardNavigation,
    reducedMotion: a11y.reducedMotion,
    subtitles: a11y.subtitles,
    subtitleFontSize: a11y.subtitleFontSize,
    oneHandedMode: a11y.oneHandedMode,
    gameSpeed: a11y.gameSpeed,
    highContrast: a11y.highContrast,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Accessibility and controls"
      data-testid="world-accessibility-menu"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '4vh 1rem',
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 540, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} aria-label="Close settings" style={{ padding: '4px 12px', borderRadius: 4, background: 'rgba(255,255,255,0.12)' }}>
            Close (Esc)
          </button>
        </div>
        <AccessibilityPanel settings={settings} onChange={(next) => setAllAccessibility(next)} />
        <div style={{ background: 'rgba(20,20,28,0.92)', borderRadius: 8, padding: 16, color: '#fff' }}>
          <KeybindRemapPanel />
        </div>
      </div>
    </div>
  );
}

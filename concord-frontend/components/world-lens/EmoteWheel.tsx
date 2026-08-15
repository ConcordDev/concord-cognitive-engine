/**
 * EmoteWheel.tsx — 8-slot radial emote wheel.
 *
 * Triggered by B key. Shows 8 emotes in a circle, click or hotkey 1-8 to perform.
 */

import { useState, useEffect } from 'react';

export interface Emote {
  id: string;
  label: string;
  icon: string;     // emoji
  animation: string; // animation state machine trigger
  cooldownMs: number;
  soundCue?: string;
}

export const EMOTES: Emote[] = [
  { id: 'wave',     label: 'Wave',      icon: '👋', animation: 'emote_wave',     cooldownMs: 2000 },
  { id: 'bow',      label: 'Bow',       icon: '🙇', animation: 'emote_bow',      cooldownMs: 4000 },
  { id: 'dance',    label: 'Dance',     icon: '💃', animation: 'emote_dance',    cooldownMs: 8000, soundCue: 'emote_dance.mp3' },
  { id: 'salute',   label: 'Salute',    icon: '🫡', animation: 'emote_salute',   cooldownMs: 4000 },
  { id: 'laugh',    label: 'Laugh',     icon: '😆', animation: 'emote_laugh',    cooldownMs: 4000, soundCue: 'emote_laugh.mp3' },
  { id: 'cry',      label: 'Cry',       icon: '😢', animation: 'emote_cry',      cooldownMs: 4000 },
  { id: 'cheer',    label: 'Cheer',     icon: '🎉', animation: 'emote_cheer',    cooldownMs: 6000, soundCue: 'emote_cheer.mp3' },
  { id: 'sit',      label: 'Sit',       icon: '🪑', animation: 'emote_sit',      cooldownMs: 1000 },
];

interface EmoteWheelProps {
  onSelect?: (emote: Emote) => void;
}

export function EmoteWheel({ onSelect }: EmoteWheelProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<Emote | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
      if (open) {
        const idx = parseInt(e.key);
        if (idx >= 1 && idx <= 8) {
          onSelect?.(EMOTES[idx - 1]);
          setOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onSelect]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 320, height: 320,
      pointerEvents: 'none',
      zIndex: 200,
    }} data-testid="emote-wheel">
      {EMOTES.map((emote, i) => {
        const angle = (i / EMOTES.length) * 2 * Math.PI - Math.PI / 2;
        const radius = 120;
        const x = Math.cos(angle) * radius + 160 - 32;
        const y = Math.sin(angle) * radius + 160 - 32;
        const isHovered = hovered?.id === emote.id;
        return (
          <div key={emote.id}
               onMouseEnter={() => setHovered(emote)}
               onMouseLeave={() => setHovered(null)}
               onClick={() => { onSelect?.(emote); setOpen(false); }}
               style={{
                 position: 'absolute',
                 left: x, top: y,
                 width: 64, height: 64,
                 borderRadius: '50%',
                 background: isHovered ? '#d98c33' : 'rgba(20,20,25,0.85)',
                 border: '2px solid #d98c33',
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 cursor: 'pointer', pointerEvents: 'auto',
                 transform: isHovered ? 'scale(1.15)' : 'scale(1)',
                 transition: 'transform 0.15s',
                 flexDirection: 'column',
                 fontSize: 10,
               }}>
            <span style={{ fontSize: 24 }}>{emote.icon}</span>
            <span style={{ fontSize: 8, color: '#fff' }}>{i + 1}</span>
          </div>
        );
      })}
      {hovered && (
        <div style={{
          position: 'absolute',
          bottom: 0, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(10,10,15,0.92)',
          padding: '4px 8px', borderRadius: 4,
          color: '#e0d8c8', fontSize: 12,
        }}>
          {hovered.label} ({hovered.cooldownMs / 1000}s cooldown)
        </div>
      )}
    </div>
  );
}

export default EmoteWheel;

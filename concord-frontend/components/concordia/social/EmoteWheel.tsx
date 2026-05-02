'use client';

import React, { useEffect, useState, useCallback } from 'react';

// ── Emote definitions ────────────────────────────────────────────────

export const EMOTES = {
  wave:    { label: 'Wave',    icon: '👋', duration: 2000, animation: 'wave'    },
  bow:     { label: 'Bow',     icon: '🙇', duration: 1500, animation: 'bow'     },
  cheer:   { label: 'Cheer',   icon: '🙌', duration: 2000, animation: 'cheer'   },
  point:   { label: 'Point',   icon: '👉', duration: 1000, animation: 'point'   },
  laugh:   { label: 'Laugh',   icon: '😂', duration: 2000, animation: 'laugh'   },
  dance:   { label: 'Dance',   icon: '🕺', duration: 5000, animation: 'dance'   },
  shrug:   { label: 'Shrug',   icon: '🤷', duration: 1500, animation: 'shrug'   },
  thumbup: { label: 'Thumbs Up', icon: '👍', duration: 1000, animation: 'celebrate' },
} as const;

export type EmoteId = keyof typeof EMOTES;

interface EmoteWheelProps {
  onEmote: (emoteId: EmoteId) => void;
  /** Hold key that opens the wheel (defaults to 'KeyZ') */
  holdKey?: string;
  /** Optional close callback — when present, fires after emote selection. */
  onClose?: () => void;
}

const EMOTE_KEYS = Object.keys(EMOTES) as EmoteId[];

// Position emotes around a circle
function slotPosition(index: number, total: number, radius: number) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function EmoteWheel({ onEmote, holdKey = 'KeyZ', onClose }: EmoteWheelProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  void onClose; // legacy prop — kept for compatibility with parent panels that pass it

  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<EmoteId | null>(null);

  useEffect(() => {
    function onDown(e: KeyboardEvent) {
      if (e.code === holdKey) setOpen(true);
    }
    function onUp(e: KeyboardEvent) {
      if (e.code === holdKey) {
        if (hovered) onEmote(hovered);
        setOpen(false);
        setHovered(null);
      }
    }
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [holdKey, hovered, onEmote]);

  const handleTouchEmote = useCallback((id: EmoteId) => {
    onEmote(id);
    setOpen(false);
  }, [onEmote]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
      <div className="relative pointer-events-auto" style={{ width: 220, height: 220 }}>
        {/* Center hub */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-xs text-white/60">
            {hovered ? EMOTES[hovered].label : 'Emote'}
          </div>
        </div>

        {/* Emote slots */}
        {EMOTE_KEYS.map((id, i) => {
          const pos = slotPosition(i, EMOTE_KEYS.length, 90);
          const isActive = hovered === id;
          return (
            <button
              key={id}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => handleTouchEmote(id)}
              className={`absolute w-12 h-12 rounded-full flex flex-col items-center justify-center
                text-lg border transition-all
                ${isActive
                  ? 'bg-white/20 border-white/60 scale-110'
                  : 'bg-black/70 border-white/20 hover:bg-white/10'
                }`}
              style={{
                left: '50%',
                top: '50%',
                transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) ${isActive ? 'scale(1.1)' : ''}`,
              }}
            >
              <span>{EMOTES[id].icon}</span>
            </button>
          );
        })}
      </div>
      <div className="absolute bottom-8 text-xs text-white/30 font-mono pointer-events-none">
        Hold {holdKey === 'KeyZ' ? 'Z' : holdKey} · hover to select · release to emote
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef } from 'react';

const EMOTES: Array<{ id: string; label: string; emoji: string; key: string }> = [
  { id: 'wave', label: 'Wave', emoji: '👋', key: '1' },
  { id: 'clap', label: 'Clap', emoji: '👏', key: '2' },
  { id: 'point', label: 'Point', emoji: '👉', key: '3' },
  { id: 'celebrate', label: 'Celebrate', emoji: '🎉', key: '4' },
  { id: 'sit', label: 'Sit', emoji: '🪑', key: '5' },
  { id: 'inspect', label: 'Inspect', emoji: '🔍', key: '6' },
];

interface EmoteWheelProps {
  onEmote: (emoteId: string) => void;
  onClose: () => void;
}

export function EmoteWheel({ onEmote, onClose }: EmoteWheelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: 1–6 select emotes, Escape closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const match = EMOTES.find((em) => em.key === e.key);
      if (match) {
        onEmote(match.id);
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEmote, onClose]);

  // Click-outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Wheel geometry — place buttons in a circle
  const R = 72; // radius px

  return (
    <div
      ref={rootRef}
      className="fixed z-[60] pointer-events-auto"
      style={{ bottom: '120px', left: '50%', transform: 'translateX(-50%)' }}
    >
      {/* Center label */}
      <div className="relative w-36 h-36">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-[10px] text-white/30 font-mono uppercase tracking-widest">Emote</div>
        </div>

        {/* Spoke buttons */}
        {EMOTES.map((em, i) => {
          const angle = (2 * Math.PI * i) / EMOTES.length - Math.PI / 2;
          const x = Math.cos(angle) * R;
          const y = Math.sin(angle) * R;
          return (
            <button
              key={em.id}
              onClick={() => {
                onEmote(em.id);
                onClose();
              }}
              title={em.label}
              className="absolute flex flex-col items-center gap-0.5 -translate-x-1/2 -translate-y-1/2 group"
              style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` }}
            >
              <div
                className="w-10 h-10 rounded-full bg-black/80 border border-white/15 flex items-center justify-center text-xl
                group-hover:border-white/40 group-hover:bg-white/10 transition-all shadow-lg shadow-black/40"
              >
                {em.emoji}
              </div>
              <div className="text-[8px] text-white/40 group-hover:text-white/70 font-mono">
                [{em.key}] {em.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

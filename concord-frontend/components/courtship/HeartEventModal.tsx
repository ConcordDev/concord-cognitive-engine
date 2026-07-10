'use client';

/**
 * HeartEventModal — reveals an authored "heart event" scene.
 *
 * Real data only: the scene object rendered here is exactly what
 * `courtship.interact` (server/domains/courtship.js → romance-engine.js
 * #courtInteraction → heart-events.js#checkHeartEvent) returned the moment
 * an affinity crossing fired it — authored vignette content from
 * `content/heart-events/*.json`, never LLM-generated, never invented client
 * side. This modal is a pure display of that server response; it fires only
 * when the backend actually returned a `heartEvent` object.
 */

import { Heart, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export interface HeartEventScene {
  milestoneId: string;
  threshold: number;
  title: string;
  scene: Array<{ speaker: string; line: string }>;
  affinityBonus?: number;
}

interface Props {
  scene: HeartEventScene;
  partnerLabel: string;
  onClose: () => void;
}

export function HeartEventModal({ scene, partnerLabel, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
        role="button"
        tabIndex={-1}
        onKeyDown={() => {}}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="heart-event-title"
        data-testid="heart-event-modal"
        className="relative w-full max-w-lg rounded-xl border border-pink-500/40 bg-zinc-950 shadow-2xl shadow-pink-900/30 overflow-hidden animate-scale-in"
      >
        <div className="flex items-center justify-between gap-2 border-b border-pink-500/30 bg-gradient-to-r from-pink-950/60 to-zinc-950 px-5 py-3">
          <div className="flex items-center gap-2 text-pink-200">
            <Heart size={16} className="fill-pink-400 text-pink-400" aria-hidden="true" />
            <span id="heart-event-title" className="font-semibold text-sm">{scene.title}</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close scene"
            className="rounded p-1 text-pink-300/70 hover:bg-pink-500/10 hover:text-pink-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-[10px] uppercase tracking-wide text-pink-400/60">
            with {partnerLabel} &middot; milestone {Math.round(scene.threshold * 100)}%
          </p>
          {scene.scene.map((line, i) => (
            <div key={i} className={line.speaker === 'narrator' ? 'italic text-zinc-400' : 'text-pink-50'}>
              {line.speaker !== 'narrator' && (
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-pink-400/70">
                  {line.speaker}:
                </span>
              )}
              <span className="text-sm leading-relaxed">{line.line}</span>
            </div>
          ))}
        </div>

        {typeof scene.affinityBonus === 'number' && scene.affinityBonus > 0 && (
          <div className="border-t border-pink-500/20 bg-pink-950/20 px-5 py-2 text-[11px] text-pink-300">
            +{Math.round(scene.affinityBonus * 100)}% affinity from this moment
          </div>
        )}
      </div>
    </div>
  );
}

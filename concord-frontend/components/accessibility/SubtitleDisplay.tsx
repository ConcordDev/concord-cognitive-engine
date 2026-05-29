'use client';

/**
 * SubtitleDisplay — F1.
 *
 * TLOU2-style captions: a speaker label + the spoken line, queued so back-to-
 * back dialogue lines don't clobber each other. Gated on the a11y `subtitles`
 * setting; font size driven by `subtitleFontSize`. Fed by the dialogue path
 * via the `concordia:subtitle` window event: { speaker?, text, durationMs? }.
 *
 * Mount once in the world lens.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccessibilitySettings } from '@/hooks/useAccessibilitySettings';
import { subtitleDurationMs, enqueueCue, type SubtitleCue } from '@/lib/accessibility/subtitle';

let _cueSeq = 0;

export default function SubtitleDisplay() {
  const a11y = useAccessibilitySettings();
  const [active, setActive] = useState<SubtitleCue | null>(null);
  const queueRef = useRef<SubtitleCue[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    setActive(next);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (next) {
      timerRef.current = setTimeout(advance, next.durationMs);
    }
  }, []);

  useEffect(() => {
    function onSubtitle(e: Event) {
      const detail = (e as CustomEvent).detail as { speaker?: string; text?: string; durationMs?: number } | undefined;
      if (!detail?.text) return;
      const cue: SubtitleCue = {
        id: `sub_${++_cueSeq}`,
        speaker: detail.speaker,
        text: detail.text,
        durationMs: detail.durationMs ?? subtitleDurationMs(detail.text),
      };
      queueRef.current = enqueueCue(queueRef.current, cue);
      // Start playback if idle.
      if (!timerRef.current) advance();
    }
    window.addEventListener('concordia:subtitle', onSubtitle);
    return () => {
      window.removeEventListener('concordia:subtitle', onSubtitle);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [advance]);

  if (!a11y.subtitles || !active) return null;

  const fontSize = Math.max(12, Math.min(36, Number(a11y.subtitleFontSize) || 16));

  return (
    <div
      data-testid="subtitle-display"
      aria-hidden="true"
      style={{
        position: 'fixed',
        bottom: '12%',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '70ch',
        textAlign: 'center',
        zIndex: 60,
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          background: 'rgba(0,0,0,0.72)',
          color: '#fff',
          padding: '0.35em 0.7em',
          borderRadius: 6,
          fontSize: `${fontSize}px`,
          lineHeight: 1.35,
          textShadow: '0 1px 2px rgba(0,0,0,0.9)',
        }}
      >
        {active.speaker && (
          <strong style={{ color: '#ffd76a', marginRight: '0.5em' }}>{active.speaker}:</strong>
        )}
        {active.text}
      </span>
    </div>
  );
}

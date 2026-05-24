'use client';

import { useEffect, useState } from 'react';

/**
 * TutorialCinematic — opening title sequence shown the first time a player
 * enters the world. 6 seconds total: black fade-in (0.5s) → three title
 * cards (1.5s each, crossfading) → fade-out (0.5s) → done.
 *
 * Persists "seen" state in localStorage so it doesn't replay on refresh.
 * Renders nothing once dismissed.
 *
 * Inputs: onDone callback fires once the cinematic completes (or is
 * skipped via the Skip button).
 */

const STORAGE_KEY = 'concordia:tutorial:cinematic-seen';

interface Card {
  text: string;
  sub?: string;
}

const CARDS: Card[] = [
  {
    text: 'Welcome to Concordia.',
    sub: 'A walled city built on the principle that all knowledge is sovereign.',
  },
  {
    text: 'Four factions wrote the Compact.',
    sub: 'It has held for seventy-five years. Some of it has been honored.',
  },
  {
    text: 'You arrived at the east gate this morning.',
    sub: 'Nobody is waiting for you. Whatever you make of this place is yours.',
  },
];

const CARD_MS = 2400;
const FADE_MS = 500;

interface Props {
  onDone?: () => void;
  /** Force-show even if previously seen. Defaults to false. */
  force?: boolean;
}

export default function TutorialCinematic({ onDone, force = false }: Props) {
  const [shown, setShown] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (force) return true;
    try {
      return localStorage.getItem(STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [cardIdx, setCardIdx] = useState(0);
  const [phase, setPhase] = useState<'in' | 'cards' | 'out' | 'done'>('in');

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    const inT = setTimeout(() => { if (!cancelled) setPhase('cards'); }, FADE_MS);
    return () => { cancelled = true; clearTimeout(inT); };
  }, [shown]);

  useEffect(() => {
    if (!shown || phase !== 'cards') return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      if (cardIdx + 1 < CARDS.length) {
        setCardIdx((c) => c + 1);
      } else {
        setPhase('out');
      }
    }, CARD_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [shown, phase, cardIdx]);

  useEffect(() => {
    if (!shown || phase !== 'out') return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      setPhase('done');
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* persistence best-effort */ }
      setShown(false);
      onDone?.();
    }, FADE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [shown, phase, onDone]);

  const skip = () => {
    setPhase('done');
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* best-effort */ }
    setShown(false);
    onDone?.();
  };

  if (!shown) return null;

  const card = CARDS[cardIdx];
  const opacity = phase === 'in' ? 1 : phase === 'cards' ? 1 : phase === 'out' ? 0 : 0;
  const cardVisible = phase === 'cards';

  return (
    <div
      className="fixed inset-0 z-[80] bg-black flex items-center justify-center pointer-events-auto"
      style={{ opacity, transition: `opacity ${FADE_MS}ms ease-in-out` }}
      onClick={skip} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      {/* Letterbox bars for cinematic feel */}
      <div className="absolute top-0 left-0 right-0 h-16 bg-black z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-black z-10" />

      {/* Title card crossfade */}
      <div
        key={cardIdx}
        className="text-center px-8 max-w-2xl"
        style={{
          opacity: cardVisible ? 1 : 0,
          transition: 'opacity 600ms ease-in-out',
          animation: cardVisible ? 'cardIn 800ms ease-out' : undefined,
        }}
      >
        <h1
          className="text-3xl md:text-5xl font-light tracking-wide text-amber-100 mb-4"
          style={{ textShadow: '0 0 24px rgba(253,224,71,0.3)' }}
        >
          {card.text}
        </h1>
        {card.sub && (
          <p className="text-sm md:text-base text-amber-100/60 italic max-w-lg mx-auto">
            {card.sub}
          </p>
        )}
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); skip(); }}
        className="absolute bottom-6 right-6 text-xs text-amber-100/50 hover:text-amber-100 px-3 py-1 border border-amber-100/20 rounded transition-colors"
      >
        Skip ›
      </button>

      <style jsx>{`
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

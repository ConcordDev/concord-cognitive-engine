'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  tutorialManager,
  TutorialHint as THint,
  TutorialStep,
  TUTORIAL_TOPICS,
  PlayerAction,
} from '@/lib/concordia/onboarding/tutorial';

// ── Hint toast ───────────────────────────────────────────────────────

function HintToast({ hint, onDismiss }: { hint: THint; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, hint.duration);
    return () => clearTimeout(t);
  }, [hint.duration, onDismiss]);

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-300 bg-black/90 border border-white/20 rounded-xl px-4 py-3 flex items-center gap-3 shadow-xl max-w-sm">
      <div className="flex-1">
        <div className="text-sm text-white">{hint.message}</div>
        {hint.controls && hint.controls.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {hint.controls.slice(0, 3).map((k, i) => (
              <kbd
                key={i}
                className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded text-xs text-white/70 font-mono"
              >
                {k}
              </kbd>
            ))}
          </div>
        )}
      </div>
      <button onClick={onDismiss} className="text-white/30 hover:text-white text-xs">
        ✕
      </button>
    </div>
  );
}

// ── Drop Hints offer — shown once after tutorial completes or is skipped ──

function DropHintsOffer({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="animate-in slide-in-from-bottom-4 duration-300 bg-black/90 border border-cyan-500/30 rounded-xl px-4 py-3 flex items-center gap-3 shadow-xl max-w-sm">
      <span className="text-lg">💡</span>
      <div className="flex-1">
        <div className="text-sm text-white font-medium">Drop hints?</div>
        <div className="text-xs text-white/50 mt-0.5">
          Get contextual tips while you explore. Toggle anytime.
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onAccept}
          className="px-2.5 py-1 bg-cyan-500/20 text-cyan-300 rounded-lg text-xs hover:bg-cyan-500/30 transition-colors"
        >
          Yes
        </button>
        <button onClick={onDecline} className="text-white/30 hover:text-white text-xs px-1">
          No
        </button>
      </div>
    </div>
  );
}

// ── Help menu (replay any tutorial + hints toggle) ───────────────────

function HelpMenu({
  hintsEnabled,
  onToggleHints,
  onClose,
}: {
  hintsEnabled: boolean;
  onToggleHints: () => void;
  onClose: () => void;
}) {
  const topics = Object.entries(TUTORIAL_TOPICS).filter(([, v]) => v !== '');
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="bg-black/90 border border-white/10 rounded-2xl p-5 min-w-[280px]"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-white">Tutorials</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            ✕
          </button>
        </div>

        {/* Drop Hints toggle */}
        <button
          onClick={onToggleHints}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors mb-3"
        >
          <span className="text-sm text-white/80 flex items-center gap-2">
            <span>💡</span> Drop Hints
          </span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${hintsEnabled ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/10 text-white/40'}`}
          >
            {hintsEnabled ? 'ON' : 'OFF'}
          </span>
        </button>

        <div className="space-y-1">
          {topics.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                tutorialManager.replay(key as TutorialStep);
                onClose();
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            onClick={() => {
              tutorialManager.skip();
              onClose();
            }}
            className="w-full text-xs text-white/30 hover:text-white/60 py-1"
          >
            Skip all tutorials
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function TutorialOverlay() {
  const [hint, setHint] = useState<THint | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hintsEnabled, setHintsEnabled] = useState(tutorialManager.hintsEnabled);
  const [showDropHintsOffer, setShowDropHintsOffer] = useState(false);
  // track whether we've already shown the offer this session
  const offerShownRef = React.useRef(false);

  useEffect(() => {
    tutorialManager.onHint(setHint);
    tutorialManager.start();
    return () => tutorialManager.onHint(() => undefined);
  }, []);

  // Listen for tutorial action events dispatched from anywhere in the world
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<{ action: PlayerAction }>).detail?.action;
      if (action) tutorialManager.advance(action);
    };
    window.addEventListener('concordia:tutorial-action', handler);
    return () => window.removeEventListener('concordia:tutorial-action', handler);
  }, []);

  // Watch for tutorial completion / skip to offer Drop Hints once
  useEffect(() => {
    if (tutorialManager.isDone && !offerShownRef.current && !tutorialManager.hintsEnabled) {
      offerShownRef.current = true;
      setShowDropHintsOffer(true);
      const t = setTimeout(() => setShowDropHintsOffer(false), 8000);
      return () => clearTimeout(t);
    }
  }, [hint]); // re-check whenever a hint fires (including null = tutorial ended)

  const dismiss = useCallback(() => setHint(null), []);

  const handleToggleHints = useCallback(() => {
    tutorialManager.toggleHints();
    setHintsEnabled(tutorialManager.hintsEnabled);
    setShowDropHintsOffer(false);
  }, []);

  const handleAcceptHints = useCallback(() => {
    tutorialManager.enableHints();
    setHintsEnabled(true);
    setShowDropHintsOffer(false);
  }, []);

  const handleDeclineHints = useCallback(() => {
    setShowDropHintsOffer(false);
  }, []);

  // Keep overlay mounted if hints are enabled (even after tutorial done)
  if (tutorialManager.isDone && !hintsEnabled && !helpOpen && !showDropHintsOffer)
    return (
      <button
        onClick={() => setHelpOpen(true)}
        className="absolute bottom-4 left-4 text-xs text-white/30 hover:text-white/60 font-mono bg-black/40 px-2 py-1 rounded-lg border border-white/5"
      >
        ? Help
      </button>
    );

  return (
    <>
      {hint && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
          <HintToast hint={hint} onDismiss={dismiss} />
        </div>
      )}

      {showDropHintsOffer && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
          <DropHintsOffer onAccept={handleAcceptHints} onDecline={handleDeclineHints} />
        </div>
      )}

      {/* Bottom-left controls */}
      <div className="absolute bottom-4 left-4 z-40 pointer-events-auto flex items-center gap-2">
        {/* Drop Hints pill — visible once tutorial is done */}
        {tutorialManager.isDone && (
          <button
            onClick={handleToggleHints}
            title={hintsEnabled ? 'Hints ON — click to turn off' : 'Hints OFF — click to turn on'}
            className={`text-xs font-mono px-2 py-1 rounded-lg border transition-colors ${
              hintsEnabled
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/30'
                : 'bg-black/40 text-white/30 border-white/5 hover:text-white/60'
            }`}
          >
            💡 {hintsEnabled ? 'Hints ON' : 'Hints'}
          </button>
        )}

        {/* Help button — always visible */}
        <button
          onClick={() => setHelpOpen(true)}
          className="text-xs text-white/30 hover:text-white/60 font-mono bg-black/40 px-2 py-1 rounded-lg border border-white/5"
        >
          ? Help
        </button>
      </div>

      {helpOpen && (
        <HelpMenu
          hintsEnabled={hintsEnabled}
          onToggleHints={handleToggleHints}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  );
}

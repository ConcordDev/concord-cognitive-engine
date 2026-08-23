/**
 * TutorialFirstCycle.tsx — onboarding flow for first-time players.
 *
 * Walks the player through:
 * 1. Wake in concordia-hub
 * 2. Meet Lord Curator Asbir Thelane (greeting + first quest)
 * 3. Visit the Ring of Doors (8 portals)
 * 4. Talk to Velka Ironhand (merchant + buy a starter weapon)
 * 5. Enter a portal to first sub-world
 */

import { useState, useEffect } from 'react';

export type TutorialStep =
  | 'wake'
  | 'asbir'
  | 'rings-of-doors'
  | 'velka'
  | 'enter-portal'
  | 'complete';

interface TutorialFirstCycleProps {
  currentStep: TutorialStep;
  onStepComplete?: (step: TutorialStep) => void;
  playerName: string;
}

const STEP_TEXT: Record<TutorialStep, { title: string; body: string; hint?: string }> = {
  wake: {
    title: 'Wake in the Hub',
    body: 'You open your eyes at the Three Pillars of Concord. The sun is on your face. Somewhere, a brass bell rings once.',
    hint: 'Press WASD to move. Press E to interact.',
  },
  asbir: {
    title: 'Lord Curator Asbir Thelane',
    body: 'A tall man in archive-gray approaches. "I am Asbir Thelane. For nineteen years I have kept the Concordant Archive honest. You must be the new arrival."',
    hint: 'Approach Asbir and press E to greet him.',
  },
  'rings-of-doors': {
    title: 'The Ring of Doors',
    body: 'Around you stand eight stone archways, each marked with a different sigil. Eight worlds, eight ways to die, eight ways to come home.',
    hint: 'Walk to any archway. Each leads to a different world. You can return to the hub at any time.',
  },
  velka: {
    title: 'Velka Ironhand, Master of the Bazaar',
    body: 'A broad-shouldered merchant in leather with iron-reinforced gauntlets. "Velka Ironhand. First refusal on disputes. Anything you want, I sell — and I sell anything you have."',
    hint: 'Open the vendor (V) and buy a starter weapon. The Concordian Knife costs 50 gold.',
  },
  'enter-portal': {
    title: 'Step Through',
    body: 'You take the first step into the archway. Light bends. The hum of refusal-field emitters fades behind you. The world ahead is not Concordia.',
    hint: 'You are now in [world]. Combat is enabled. Other players may attack you.',
  },
  complete: {
    title: 'You are Concordian',
    body: 'You have walked through your first door. The hub will remember you.',
  },
};

export function TutorialFirstCycle({ currentStep, onStepComplete, playerName: _playerName }: TutorialFirstCycleProps) {
  const [shown, setShown] = useState(false);
  const step = STEP_TEXT[currentStep];

  useEffect(() => {
    setShown(true);
    const timer = setTimeout(() => setShown(false), 12000);
    return () => clearTimeout(timer);
  }, [currentStep]);

  if (currentStep === 'complete') return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 100,
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: 500,
      background: 'rgba(10, 10, 15, 0.92)',
      border: '2px solid #d98c33',
      borderRadius: 8,
      padding: 16,
      color: '#e0d8c8',
      fontFamily: 'Georgia, serif',
      opacity: shown ? 1 : 0.3,
      transition: 'opacity 0.5s',
      zIndex: 90,
    }} data-testid="tutorial-overlay">
      <div style={{ fontSize: 11, color: '#d98c33', marginBottom: 4, letterSpacing: 1 }}>
        FIRST CYCLE
      </div>
      <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
        {step.body.replace('[world]', currentStep === 'enter-portal' ? 'a sub-world' : '')}
      </div>
      {step.hint && (
        <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>
          {step.hint}
        </div>
      )}
      <button
        onClick={() => onStepComplete?.(currentStep)}
        style={{
          marginTop: 8,
          background: '#3a5a3a',
          color: '#fff',
          border: 'none',
          padding: '6px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Continue
      </button>
    </div>
  );
}

export default TutorialFirstCycle;

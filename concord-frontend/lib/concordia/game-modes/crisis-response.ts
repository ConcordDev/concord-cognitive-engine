import { GameMode, registerGameMode } from '../game-mode-orchestrator';

const crisisResponseMode: GameMode = {
  id: 'crisis-response',
  name: 'Crisis Response',
  description: 'A world crisis has been detected. Respond based on your skills to help resolve it.',
  icon: '⚠',
  stages: [
    {
      id: 'brief',
      name: 'Briefing',
      description: 'Review the crisis and your assigned role.',
      inputMode: 'exploration',
      advanceWhen: { type: 'action', action: 'crisis_accept' },
    },
    {
      id: 'respond',
      name: 'Respond',
      description: 'Take action: combatants use skills, creators build counter-DTUs, diplomats dialogue.',
      inputMode: 'exploration',
      lensId: 'crisis-ops', // Phase V — opens the active-crisis dispatch lens.
      advanceWhen: {
        type: 'any',
        triggers: [
          { type: 'event', event: 'world:crisis-resolved' },
          { type: 'event', event: 'skill:xp-awarded' },
          { type: 'event', event: 'creation:placed' },
          { type: 'time', ms: 300_000 }, // 5 min fallback
        ],
      },
    },
    {
      id: 'resolve',
      name: 'Resolution',
      description: 'The crisis resolves. Your contribution is recorded.',
      inputMode: 'exploration',
      advanceWhen: { type: 'time', ms: 4000 },
    },
  ],
};

registerGameMode(crisisResponseMode);
export default crisisResponseMode;

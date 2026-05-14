import { GameMode, registerGameMode } from '../game-mode-orchestrator';

const masterForgeMode: GameMode = {
  id: 'master-forge',
  name: 'Master Forge',
  description: 'Intentional hybridization: cycle through skill pairs from your hotbar to discover new hybrid skills.',
  icon: '⚗',
  stages: [
    {
      id: 'select',
      name: 'Select Pair',
      description: 'The HUD shows recommended skill pairs based on your history.',
      inputMode: 'exploration',
      advanceWhen: { type: 'action', action: 'forge_start' },
    },
    {
      id: 'use_a',
      name: 'Activate Skill A',
      description: 'Use the first skill in the pair.',
      inputMode: 'combat',
      lensId: 'forge', // Phase V — opens the ForgeWorkbench during the cast.
      advanceWhen: { type: 'event', event: 'skill:xp-awarded' },
    },
    {
      id: 'use_b',
      name: 'Activate Skill B',
      description: 'Now use the second skill — hybrid detection fires.',
      inputMode: 'combat',
      lensId: 'forge',
      advanceWhen: {
        type: 'any',
        triggers: [
          { type: 'event', event: 'hybrid:created' },
          { type: 'time', ms: 15000 },
        ],
      },
    },
    {
      id: 'result',
      name: 'Result',
      description: 'Hybrid revealed or new pair suggested.',
      inputMode: 'exploration',
      advanceWhen: { type: 'time', ms: 5000 },
    },
  ],
};

registerGameMode(masterForgeMode);
export default masterForgeMode;

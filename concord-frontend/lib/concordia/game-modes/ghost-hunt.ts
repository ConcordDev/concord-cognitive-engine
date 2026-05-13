import { GameMode, registerGameMode } from '../game-mode-orchestrator';

const ghostHuntMode: GameMode = {
  id: 'ghost-hunt',
  name: 'Ghost Hunt',
  description: 'Track and defeat your nemesis. They move between zones — follow the radar and confront them in combat.',
  icon: '☠',
  stages: [
    {
      id: 'hunt',
      name: 'Hunt',
      description: 'Your nemesis location is shown in the HUD. Travel to their world.',
      inputMode: 'exploration',
      advanceWhen: { type: 'action', action: 'ghost_hunt_enter_zone' },
    },
    {
      id: 'track',
      name: 'Track',
      description: 'Zone proximity indicator active. Get close to engage.',
      inputMode: 'exploration',
      lensId: 'ghost-tracker', // Phase V — residue list opens here.
      advanceWhen: {
        type: 'any',
        triggers: [
          { type: 'action', action: 'ghost_hunt_engage' },
          { type: 'time', ms: 300_000 },
        ],
      },
    },
    {
      id: 'confront',
      name: 'Confront',
      description: 'Combat engaged. Defeat your nemesis.',
      inputMode: 'combat',
      lensId: 'ghost-tracker',
      advanceWhen: {
        type: 'any',
        triggers: [
          { type: 'event', event: 'nemesis:defeated' },
          { type: 'time', ms: 600_000 }, // 10 min
        ],
      },
    },
    {
      id: 'resolve',
      name: 'Victory',
      description: 'Nemesis defeated. CC awarded. Chronicle entry written.',
      inputMode: 'exploration',
      advanceWhen: { type: 'time', ms: 5000 },
    },
  ],
};

registerGameMode(ghostHuntMode);
export default ghostHuntMode;

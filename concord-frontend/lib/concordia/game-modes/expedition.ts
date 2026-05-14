import { GameMode, registerGameMode } from '../game-mode-orchestrator';

export const EXPEDITION_WORLDS = [
  'concordia-hub',
  'fable-world',
  'superhero-world',
  'wasteland-world',
  'crime-city',
  'war-zone',
] as const;

// Expedition is a multi-world journey: arrive, act (skill use or quest), record.
// The orchestrator loops through 3 stages × 6 worlds (18 stages total).

function worldStages(worldId: string, index: number) {
  return [
    {
      id: `arrive-${worldId}`,
      name: `Travel: ${worldId}`,
      description: `Travel to ${worldId}. (${index + 1}/6)`,
      inputMode: 'exploration' as const,
      lensId: 'expedition-journal', // Phase V — journal opens on arrival.
      advanceWhen: { type: 'event' as const, event: `world:arrived:${worldId}` },
    },
    {
      id: `act-${worldId}`,
      name: 'Act',
      description: 'Use a skill or complete a quest in this world.',
      inputMode: 'exploration' as const,
      lensId: 'expedition-journal',
      advanceWhen: {
        type: 'any' as const,
        triggers: [
          { type: 'event' as const, event: 'skill:xp-awarded' },
          { type: 'event' as const, event: 'quest:completed' },
        ],
      },
    },
    {
      id: `record-${worldId}`,
      name: 'Chronicle',
      description: 'Your deeds in this world are recorded.',
      inputMode: 'exploration' as const,
      lensId: 'expedition-journal',
      advanceWhen: { type: 'time' as const, ms: 3000 },
      onEnter: () => {
        fetch('/api/worlds/expedition/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worldId }),
        }).catch(() => {});
      },
    },
  ];
}

const expeditionMode: GameMode = {
  id: 'expedition',
  name: 'World Expedition',
  description: 'Visit all 6 worlds. Use a skill or complete a quest in each. Earn the World Walker achievement.',
  icon: '🌍',
  stages: EXPEDITION_WORLDS.flatMap((w, i) => worldStages(w, i)),
  onComplete: () => {
    fetch('/api/worlds/expedition/complete', { method: 'POST' }).catch(() => {});
  },
};

registerGameMode(expeditionMode);
export default expeditionMode;

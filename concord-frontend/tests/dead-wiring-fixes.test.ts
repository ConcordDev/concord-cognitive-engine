// Verified dead-wiring fixes from the fan-out audit: fake-data panels, dead
// buttons, and the orphaned world-tint event — now wired to real data / real
// consumers / honest feedback.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('QuestPanel — real quests, demo only as fallback', () => {
  const src = read('components/world-lens/QuestPanel.tsx');
  it('fetches the real quest endpoint', () => {
    expect(src).toMatch(/\/api\/worlds\/\$\{encodeURIComponent\(wid\)\}\/quests\?status=/);
  });
  it('adapts backend rows defensively + only falls back to demo when empty', () => {
    expect(src).toMatch(/function adaptQuest/);
    expect(src).toMatch(/if \(!cancelled && rows\.length\) setQuests/);
  });
  it('is mounted with a worldId', () => {
    expect(read('app/lenses/world/page.tsx')).toMatch(/<QuestPanel worldId=/);
  });
});

describe('world-tint — orphaned event now has a consumer', () => {
  const src = read('components/world/WorldTintOverlay.tsx');
  it('listens for concordia:world-tint and renders a DOM wash', () => {
    expect(src).toMatch(/addEventListener\('concordia:world-tint'/);
    expect(src).toMatch(/data-testid="world-tint-overlay"/);
  });
  it('self-decays so a quiet source does not leave a stuck tint', () => {
    expect(src).toMatch(/TTL_MS/);
  });
  it('is mounted in the world lens', () => {
    expect(read('app/lenses/world/page.tsx')).toMatch(/<WorldTintOverlay \/>/);
  });
});

describe('WorldInteractionSink — real router + honest fallback', () => {
  const src = read('components/world/concordia-hud/WorldInteractionSink.tsx');
  it('routes building/workbench to the real building-interact router', () => {
    expect(src).toMatch(/concordia:building-interact/);
  });
  it('drops the orphaned interaction dispatches', () => {
    for (const dead of ['enter-building', 'open-door', 'open-loot', 'read-sign', 'open-workbench', 'pickup-item']) {
      expect(src).not.toMatch(new RegExp(`'concordia:${dead}'`));
    }
  });
});

describe('NPCActionMenu — Trade/Hire give honest feedback (no backend yet)', () => {
  const src = read('components/world/NPCActionMenu.tsx');
  it('no longer dispatches the orphaned trade/hire events', () => {
    expect(src).not.toMatch(/concordia:trade-with-npc/);
    expect(src).not.toMatch(/concordia:hire-npc/);
  });
  it('uses the flash affordance instead', () => {
    expect(src).toMatch(/showFlash\(`Trading with/);
    expect(src).toMatch(/showFlash\(`Hiring/);
  });
});

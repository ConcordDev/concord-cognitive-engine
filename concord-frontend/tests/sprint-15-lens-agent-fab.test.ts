// concord-frontend/tests/sprint-15-lens-agent-fab.test.ts
//
// Sprint 15 acceptance — LensAgentFab is mounted in every flagship
// lens so they reach chat-lens baseline depth (Agent Mode, voice,
// per-message model picker, streaming, inline tool calls).

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const LENSES_TO_CHECK = [
  'studio', 'code', 'music', 'creator', 'marketplace', 'legal',
];

const PANEL_PATH = path.resolve(__dirname, '..', 'components/lens/LensAgentPanel.tsx');
const FAB_PATH = path.resolve(__dirname, '..', 'components/lens/LensAgentFab.tsx');

describe('Sprint 15 — LensAgentPanel reusable', () => {
  test('LensAgentPanel.tsx exists', () => {
    expect(fs.existsSync(PANEL_PATH)).toBe(true);
  });

  test('LensAgentPanel calls chat_agent.do macro', () => {
    const src = fs.readFileSync(PANEL_PATH, 'utf8');
    expect(src).toContain("'chat_agent'");
    expect(src).toContain("'do'");
  });

  test('LensAgentPanel renders per-lens system prompt preamble', () => {
    const src = fs.readFileSync(PANEL_PATH, 'utf8');
    expect(src).toContain('lensPrompt');
    expect(src).toMatch(/operating inside.*lens/i);
  });

  test('LensAgentPanel has voice mic + per-message model picker + provider chips', () => {
    const src = fs.readFileSync(PANEL_PATH, 'utf8');
    expect(src).toContain('SpeechRecognition');
    expect(src).toContain('brain slot');
    expect(src).toContain('anthropic');
    expect(src).toContain('openai');
    expect(src).toContain('xai');
    expect(src).toContain('google');
  });

  test('LensAgentPanel renders image + video + DTU artifacts', () => {
    const src = fs.readFileSync(PANEL_PATH, 'utf8');
    expect(src).toMatch(/image_b64/);
    expect(src).toMatch(/<video/);
    expect(src).toMatch(/lenses\/dtu/);
  });

  test('LensAgentFab.tsx exists and dynamic-imports the panel', () => {
    expect(fs.existsSync(FAB_PATH)).toBe(true);
    const src = fs.readFileSync(FAB_PATH, 'utf8');
    expect(src).toContain('next/dynamic');
    expect(src).toContain('LensAgentPanel');
  });
});

describe.each(LENSES_TO_CHECK)('Sprint 15 — %s lens mounts LensAgentFab', (lens) => {
  const pagePath = path.resolve(__dirname, '..', `app/lenses/${lens}/page.tsx`);

  test(`${lens} imports LensAgentFab`, () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).toContain("from '@/components/lens/LensAgentFab'");
  });

  test(`${lens} mounts <LensAgentFab lensId="${lens}" ...>`, () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).toContain(`lensId="${lens}"`);
    expect(src).toContain('lensPrompt=');
  });
});

describe('Sprint 15 — Lighthouse bundle fix', () => {
  test('chat lens uses dynamic import for AgentModePanel + InitiativeBell', () => {
    const chatPath = path.resolve(__dirname, '..', 'app/lenses/chat/page.tsx');
    const src = fs.readFileSync(chatPath, 'utf8');
    // Should NOT have static `import AgentModePanel from` anymore — only
    // dynamic via next/dynamic.
    expect(src).not.toMatch(/^import AgentModePanel from/m);
    expect(src).not.toMatch(/^import InitiativeBell from/m);
    // Dynamic form is present.
    expect(src).toMatch(/dynamic.*AgentModePanel/);
    expect(src).toMatch(/dynamic.*InitiativeBell/);
  });
});

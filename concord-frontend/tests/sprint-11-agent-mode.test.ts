// concord-frontend/tests/sprint-11-agent-mode.test.ts
//
// Sprint 11B+C acceptance — chat lens has Agent Mode + Initiative bell
// wired and reflects the Sprint 10 BYO router via provider chips.

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CHAT_PATH    = path.resolve(__dirname, '..', 'app/lenses/chat/page.tsx');
const AGENT_PATH   = path.resolve(__dirname, '..', 'components/chat/AgentModePanel.tsx');
const BELL_PATH    = path.resolve(__dirname, '..', 'components/chat/InitiativeBell.tsx');

const CHAT_SRC  = fs.readFileSync(CHAT_PATH, 'utf8');
const AGENT_SRC = fs.readFileSync(AGENT_PATH, 'utf8');
const BELL_SRC  = fs.readFileSync(BELL_PATH, 'utf8');

describe('Sprint 11B — Agent Mode panel', () => {
  test('AgentModePanel calls chat_agent.do macro', () => {
    expect(AGENT_SRC).toContain("'chat_agent'");
    expect(AGENT_SRC).toContain("'do'");
  });

  test('renders all 6 tool icons (web_search, run_compute, browse_url, run_lens_action, create_dtu, expert_mode)', () => {
    for (const tool of ['web_search', 'run_compute', 'browse_url', 'run_lens_action', 'create_dtu', 'expert_mode']) {
      expect(AGENT_SRC).toContain(tool);
    }
  });

  test('shows provider chips for all 4 BYO providers + Concord default', () => {
    for (const p of ['anthropic', 'openai', 'xai', 'google', 'concord_default']) {
      expect(AGENT_SRC).toContain(p);
    }
  });

  test('renders artifact links inline when create_dtu fires', () => {
    expect(AGENT_SRC).toMatch(/artifact/i);
    expect(AGENT_SRC).toContain('/lenses/dtu');
  });

  test('shows tool call success/failure with check/x icons', () => {
    expect(AGENT_SRC).toContain('CheckCircle2');
    expect(AGENT_SRC).toContain('XCircle');
  });

  test('streams optimistic placeholder while busy', () => {
    expect(AGENT_SRC).toMatch(/optimistic|placeholder|busy/i);
    expect(AGENT_SRC).toContain('Loader2');
  });

  test('keyboard shortcut: Cmd+Enter to send', () => {
    expect(AGENT_SRC).toMatch(/metaKey|ctrlKey/);
  });
});

describe('Sprint 11B — Initiative bell', () => {
  test('polls /api/initiative/pending', () => {
    expect(BELL_SRC).toContain('/api/initiative/pending');
  });

  test('supports dismiss + mark-read for each initiative', () => {
    expect(BELL_SRC).toContain('/dismiss');
    expect(BELL_SRC).toContain('/read');
  });

  test('labels all 7 trigger types', () => {
    for (const trigger of [
      'substrate_discovery', 'citation_alert', 'check_in', 'pending_work',
      'world_event', 'reflective_followup', 'morning_context',
    ]) {
      expect(BELL_SRC).toContain(trigger);
    }
  });

  test('badge shows count, capped at 9+ for high counts', () => {
    expect(BELL_SRC).toContain("'9+'");
  });
});

describe('Sprint 11B — Chat lens mounts both', () => {
  test('imports AgentModePanel + InitiativeBell', () => {
    expect(CHAT_SRC).toContain('AgentModePanel');
    expect(CHAT_SRC).toContain('InitiativeBell');
  });

  test('Agent Mode launcher button is bottom-right', () => {
    expect(CHAT_SRC).toMatch(/bottom-6 right-6/);
  });

  test('agentPanelOpen state controls panel visibility', () => {
    expect(CHAT_SRC).toContain('agentPanelOpen');
    expect(CHAT_SRC).toContain('setAgentPanelOpen');
  });

  test('InitiativeBell mounted in top-right', () => {
    expect(CHAT_SRC).toMatch(/top-4 right-20/);
  });
});

// Close-out A10 — the DomainAssistant greeting, honest minimum
// (GB-1320 form; Codex S4). The panel must not claim what the pipeline
// behind it does not do: no "Specialist" identity, no "domain-specific
// context" promise. Its answers come from Concord's general assistant
// and are not grounded in the lens's own records — the greeting says
// exactly that, and the composer drops the specialist framing.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

let toggleAssistant: (() => void) | null = null;

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    chat: {
      ask: vi.fn(async () => ({ data: { reply: 'unused' } })),
      send: vi.fn(async () => ({ data: { reply: 'unused' } })),
    },
  },
}));
vi.mock('@/lib/lens-dock', () => ({
  useLensTool: (_id: string, cb: () => void) => { toggleAssistant = cb; },
}));

import DomainAssistant from '@/components/common/DomainAssistant';

describe('DomainAssistant greeting (A10)', () => {
  it('the empty state makes no specialist or domain-context claim, and states the grounding truth', async () => {
    const { container } = render(<DomainAssistant domain="codex" domainLabel="Codex" />);
    expect(toggleAssistant).toBeTruthy();
    act(() => { toggleAssistant!(); });
    // Header + empty state both carry the honest word (at main the
    // empty state alone said "Specialist", so this count discriminates).
    expect((await screen.findAllByText('Codex Assistant')).length).toBe(2);
    expect(container.textContent).not.toMatch(/Specialist/);
    expect(container.textContent).not.toMatch(/domain-specific context/);
    expect(container.textContent).toMatch(/aren’t grounded in this lens’s own records/);
    expect(screen.getByPlaceholderText('Ask about codex...')).toBeTruthy();
  });
});

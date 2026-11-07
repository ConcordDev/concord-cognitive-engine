// Close-out A3, Genus 1 (FE half) — DomainAssistant must send a REAL
// chat mode. ChatRequest.mode is a closed union (overview/deep/…); the
// component used to cast the domain string as the mode, a mode the
// pipeline cannot serve — the empty reply came back as the canned
// greeting. The domain now rides the specialist prefix in the message.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const askCalls: Array<{ message: string; mode: unknown }> = [];
let toggleAssistant: (() => void) | null = null;

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    chat: {
      ask: vi.fn(async (message: string, mode: unknown) => {
        askCalls.push({ message, mode });
        return { data: { reply: 'There are 3 open items.' } };
      }),
      send: vi.fn(async () => ({ data: { reply: 'unused' } })),
    },
  },
}));
vi.mock('@/lib/lens-dock', () => ({
  useLensTool: (_id: string, cb: () => void) => { toggleAssistant = cb; },
}));

import DomainAssistant from '@/components/common/DomainAssistant';

describe('DomainAssistant request shape (A3)', () => {
  beforeEach(() => { askCalls.length = 0; toggleAssistant = null; });

  it('sends mode overview with the domain in the specialist prefix — never the domain as mode', async () => {
    render(<DomainAssistant domain="nonprofit" domainLabel="Nonprofit" />);
    expect(toggleAssistant).toBeTruthy();
    act(() => { toggleAssistant!(); });
    const box = await screen.findByPlaceholderText(/ask the nonprofit specialist/i);
    fireEvent.change(box, { target: { value: 'How many campaigns do I have?' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() => expect(askCalls.length).toBe(1));
    expect(askCalls[0].mode).toBe('overview');
    expect(askCalls[0].message).toContain('You are a Nonprofit specialist.');
    expect(askCalls[0].message).toContain('How many campaigns do I have?');
    expect(await screen.findByText('There are 3 open items.')).toBeTruthy();
  });
});

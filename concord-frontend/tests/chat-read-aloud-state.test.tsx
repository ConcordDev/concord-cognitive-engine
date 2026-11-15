// FIX-chat-010 — Read aloud gains a visible playing state and a working
// stop. Behavioural pins on the lib state machine (mocked
// speechSynthesis): the speaking id is set on speak, cleared on
// end/error/stop, moves across messages, and a stale utterance cannot
// clear a newer one. Plus the panel wiring pin: the message button
// toggles to a stop control while its message speaks.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class FakeUtterance {
  text: string;
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; }
}
const spoken: FakeUtterance[] = [];
const synth = {
  cancel: vi.fn(),
  speak: vi.fn((u: FakeUtterance) => { spoken.push(u); }),
  getVoices: () => [],
};

import { speakText, stopSpeaking, getSpeakingId, useSpeakingId } from '@/lib/chat/read-aloud';

beforeEach(() => {
  spoken.length = 0;
  synth.cancel.mockClear();
  synth.speak.mockClear();
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
  stopSpeaking();
});
afterEach(() => cleanup());

describe('read-aloud speaking state', () => {
  it('speaking id is set on speak and cleared when the utterance ends', () => {
    expect(speakText('hello world', 'm1')).toBe(true);
    expect(getSpeakingId()).toBe('m1');
    act(() => { spoken[0].onend?.(); });
    expect(getSpeakingId()).toBeNull();
  });

  it('an utterance error also clears the state', () => {
    speakText('hello', 'm1');
    act(() => { spoken[0].onerror?.(); });
    expect(getSpeakingId()).toBeNull();
  });

  it('stopSpeaking cancels and clears immediately', () => {
    speakText('hello', 'm1');
    stopSpeaking();
    expect(synth.cancel).toHaveBeenCalled();
    expect(getSpeakingId()).toBeNull();
  });

  it('speaking a second message moves the state; the stale end cannot clear it', () => {
    speakText('first', 'm1');
    speakText('second', 'm2');
    expect(getSpeakingId()).toBe('m2');
    act(() => { spoken[0].onend?.(); });
    expect(getSpeakingId()).toBe('m2');
    act(() => { spoken[1].onend?.(); });
    expect(getSpeakingId()).toBeNull();
  });

  it('useSpeakingId reflects the state in a component', () => {
    function Probe() { return <div>{useSpeakingId() ?? 'none'}</div>; }
    render(<Probe />);
    expect(screen.getByText('none')).toBeTruthy();
    act(() => { speakText('hi there', 'm9'); });
    expect(screen.getByText('m9')).toBeTruthy();
    act(() => { stopSpeaking(); });
    expect(screen.getByText('none')).toBeTruthy();
  });
});

describe('ChatWorkspacePanel wiring (source pin)', () => {
  const src = readFileSync(resolve(__dirname, '../components/chat/ChatWorkspacePanel.tsx'), 'utf8');
  it('the message button toggles to a stop control while its message speaks', () => {
    expect(src).toContain('speakingId === message.id');
    expect(src).toContain('stopSpeaking()');
    expect(src).toContain('Stop reading');
    expect(src).toContain('speakText(message.content, message.id)');
    expect(src).toContain('speakText(last.content, last.id)');
  });
});

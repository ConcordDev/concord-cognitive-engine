// The workspace's voice + text bar: the status line reflects the recogniser's
// real state, Space toggles the mic outside text fields, replies are spoken
// only while voice is on, and a final transcript is sent like typed text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const speak = vi.fn();
let voice = { supported: true, listening: false, speaking: false, interim: '', voiceUnavailable: false };
let lastOpts: { enabled: boolean; onFinalTranscript: (t: string) => void } | null = null;
vi.mock('@/components/conkay/useConKayVoice', () => ({
  useConKayVoice: (opts: { enabled: boolean; onFinalTranscript: (t: string) => void }) => {
    lastOpts = opts;
    return { ...voice, usingServerStt: false, ttsAmplitudeRef: { current: 0 }, speak, cancelSpeak: vi.fn() };
  },
}));
vi.mock('@/components/conkay/useMicAmplitude', () => ({ useMicAmplitude: () => ({ current: 0.4 }) }));

import { VoiceComposer } from '@/components/conkay/workspace/VoiceComposer';

beforeEach(() => {
  voice = { supported: true, listening: false, speaking: false, interim: '', voiceUnavailable: false };
  speak.mockReset();
  lastOpts = null;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => cleanup());

describe('VoiceComposer', () => {
  it('sends typed text and clears the field; Send is disabled while busy or empty', () => {
    const onSend = vi.fn();
    const { rerender } = render(<VoiceComposer busy={false} onSend={onSend} speakText={null} />);
    expect((screen.getByLabelText('Send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Message ConKay'), { target: { value: 't_w = 8' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalledWith('t_w = 8');
    expect((screen.getByLabelText('Message ConKay') as HTMLInputElement).value).toBe('');
    rerender(<VoiceComposer busy onSend={onSend} speakText={null} />);
    fireEvent.change(screen.getByLabelText('Message ConKay'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Message ConKay').closest('form')!);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('turns voice on, shows Listening only while the recogniser listens, and sends a final transcript', () => {
    const onSend = vi.fn();
    const { rerender } = render(<VoiceComposer busy={false} onSend={onSend} speakText={null} />);
    expect(screen.getByText(/tap the mic and speak/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Start voice input'));
    expect(lastOpts?.enabled).toBe(true);
    expect(screen.getByText('Starting microphone…')).toBeTruthy();
    voice = { ...voice, listening: true };
    rerender(<VoiceComposer busy={false} onSend={onSend} speakText={null} />);
    expect(screen.getByText(/Listening… \(tap mic or press Space to stop\)/)).toBeTruthy();
    voice = { ...voice, interim: 'web thickness' };
    rerender(<VoiceComposer busy={false} onSend={onSend} speakText={null} />);
    expect(screen.getByText('“web thickness”')).toBeTruthy();
    act(() => lastOpts!.onFinalTranscript('  run fea  '));
    expect(onSend).toHaveBeenCalledWith('run fea');
  });

  it('speaks each new reply once, only while voice is on', () => {
    const { rerender } = render(<VoiceComposer busy={false} onSend={vi.fn()} speakText={{ id: 'a', text: 'Done.' }} />);
    expect(speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Start voice input'));
    expect(speak).toHaveBeenCalledWith('Done.');
    rerender(<VoiceComposer busy={false} onSend={vi.fn()} speakText={{ id: 'a', text: 'Done.' }} />);
    expect(speak).toHaveBeenCalledTimes(1);
    voice = { ...voice, speaking: true };
    rerender(<VoiceComposer busy={false} onSend={vi.fn()} speakText={{ id: 'b', text: 'Next.' }} />);
    expect(speak).toHaveBeenLastCalledWith('Next.');
    expect(screen.getByText('ConKay is speaking…')).toBeTruthy();
  });

  it('Space toggles the mic, except while typing', () => {
    render(<VoiceComposer busy={false} onSend={vi.fn()} speakText={null} />);
    fireEvent.keyDown(window, { code: 'Space' });
    expect(screen.getByLabelText('Stop voice input')).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('Message ConKay'), { code: 'Space' });
    expect(screen.getByLabelText('Stop voice input')).toBeTruthy();
    fireEvent.keyDown(window, { code: 'Space' });
    expect(screen.getByLabelText('Start voice input')).toBeTruthy();
  });

  it('says so when this browser has no voice input, and disables the mic', () => {
    voice = { ...voice, supported: false };
    render(<VoiceComposer busy={false} onSend={vi.fn()} speakText={null} />);
    expect(screen.getByText(/Voice input is not available in this browser/)).toBeTruthy();
    expect((screen.getByLabelText('Start voice input') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when transcription is unavailable', () => {
    voice = { ...voice, voiceUnavailable: true };
    render(<VoiceComposer busy={false} onSend={vi.fn()} speakText={null} />);
    expect(screen.getByText(/Voice transcription is unavailable right now/)).toBeTruthy();
  });
});

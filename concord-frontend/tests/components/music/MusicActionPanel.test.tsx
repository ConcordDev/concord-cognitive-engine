import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async (importOriginal) => {
  const ReactM = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = ReactM.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactM.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLElement>) =>
      React.createElement('div', { ...props, ref }, children)),
  }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

const runDomain = vi.fn();
const lensRun = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { MusicActionPanel } from '@/components/music/MusicActionPanel';

describe('MusicActionPanel', () => {
  beforeEach(() => {
    runDomain.mockReset(); lensRun.mockReset(); apiPost.mockReset(); apiDelete.mockReset();
  });

  it('renders the workbench header and all eight action tiles', () => {
    render(<MusicActionPanel />);
    expect(screen.getByText('Music workbench')).toBeInTheDocument();
    ['BPM', 'Key', 'Chords', 'Setlist', 'Mint', 'DM', 'Publish', 'Production'].forEach((l) =>
      expect(screen.getByText(l)).toBeInTheDocument()
    );
  });

  it('BPM analyze without audio meta shows a validation error', async () => {
    render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('BPM'));
    await waitFor(() => expect(screen.getByText('Paste audio meta JSON.')).toBeInTheDocument());
  });

  it('BPM analyze with valid meta shows the result tile', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { bpm: 128, confidence: 0.9, tempoBand: 'house' } } });
    const { container } = render(<MusicActionPanel />);
    const meta = container.querySelectorAll('textarea')[0];
    fireEvent.change(meta, { target: { value: '{"sampleRate":44100}' } });
    fireEvent.click(screen.getByText('BPM'));
    await waitFor(() => expect(screen.getByText('BPM 128.')).toBeInTheDocument());
    expect(screen.getByText('128')).toBeInTheDocument();
  });

  it('BPM analyze with malformed JSON shows a parse error', async () => {
    const { container } = render(<MusicActionPanel />);
    fireEvent.change(container.querySelectorAll('textarea')[0], { target: { value: 'not json' } });
    fireEvent.click(screen.getByText('BPM'));
    // JSON.parse throws -> pickMessage surfaces the message in an err feedback
    await waitFor(() => {
      const alert = container.querySelector('[class*="text-red-300"]');
      expect(alert).toBeTruthy();
    });
  });

  it('Key detect with valid meta shows the key tile', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { key: 'C', scale: 'major', relativeKey: 'A minor' } } });
    const { container } = render(<MusicActionPanel />);
    fireEvent.change(container.querySelectorAll('textarea')[0], { target: { value: '{}' } });
    fireEvent.click(screen.getByText('Key'));
    await waitFor(() => expect(screen.getByText('Key: C major.')).toBeInTheDocument());
  });

  it('Chords requires input then analyzes a progression', async () => {
    render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('Chords'));
    await waitFor(() => expect(screen.getByText('Add chords.')).toBeInTheDocument());

    runDomain.mockResolvedValue({ data: { ok: true, result: { progression: ['C', 'G', 'Am'], commonPattern: 'I-V-vi', analysis: 'pop' } } });
    fireEvent.change(screen.getByPlaceholderText('Chords (space-separated)'), { target: { value: 'C G Am' } });
    fireEvent.click(screen.getByText('Chords'));
    await waitFor(() => expect(screen.getByText('Progression analyzed.')).toBeInTheDocument());
  });

  it('Setlist requires input then plans a setlist', async () => {
    const { container } = render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('Setlist'));
    await waitFor(() => expect(screen.getByText(/Add setlist/)).toBeInTheDocument());

    runDomain.mockResolvedValue({ data: { ok: true, result: { tracks: [], totalMinutes: 42, energyArc: 'build' } } });
    fireEvent.change(container.querySelectorAll('textarea')[1], { target: { value: 'Track One 128 Am' } });
    fireEvent.click(screen.getByText('Setlist'));
    await waitFor(() => expect(screen.getByText('Setlist: 42min.')).toBeInTheDocument());
  });

  it('Mint creates a DTU and shows the minted id', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { dtu: { id: 'dtu-abcdef12345' } } } });
    render(<MusicActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Track title'), { target: { value: 'My Track' } });
    fireEvent.click(screen.getByText('Mint'));
    await waitFor(() => expect(screen.getByText(/Music DTU dtu-abcd/)).toBeInTheDocument());
  });

  it('Mint with no DTU id reports an error', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('Mint'));
    await waitFor(() => expect(screen.getByText('No DTU id.')).toBeInTheDocument());
  });

  it('DM requires a recipient then sends a brief', async () => {
    render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(screen.getByText('Recipient required.')).toBeInTheDocument());

    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'msg-1' } } });
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'user-2' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(screen.getByText('Sent. 60s to recall.')).toBeInTheDocument());
    expect(apiPost).toHaveBeenCalledWith('/api/social/dm', expect.objectContaining({ toUserId: 'user-2' }));
  });

  it('Publish creates and publishes a public track DTU', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { id: 'pub-track-9999' } } });
    apiPost.mockResolvedValue({ data: { ok: true } });
    render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('Publish'));
    await waitFor(() => expect(screen.getByText(/Published pub-trac/)).toBeInTheDocument());
  });

  it('Agent (Production) returns moves and renders them', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { reply: 'Compress the drums.' } } });
    render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('Production'));
    await waitFor(() => expect(screen.getByText('Compress the drums.')).toBeInTheDocument());
    expect(screen.getByText('Production moves ready.')).toBeInTheDocument();
  });

  it('Agent with an empty reply shows the empty error', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('Production'));
    await waitFor(() => expect(screen.getByText('Agent returned empty.')).toBeInTheDocument());
  });

  it('BPM macro returning ok:false surfaces the handler error', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'analysis declined' } } });
    const { container } = render(<MusicActionPanel />);
    fireEvent.change(container.querySelectorAll('textarea')[0], { target: { value: '{}' } });
    fireEvent.click(screen.getByText('BPM'));
    await waitFor(() => expect(screen.getByText('analysis declined')).toBeInTheDocument());
  });

  it('Chord macro returning an empty envelope surfaces the empty-response error', async () => {
    runDomain.mockResolvedValue({});
    render(<MusicActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Chords (space-separated)'), { target: { value: 'C G' } });
    fireEvent.click(screen.getByText('Chords'));
    await waitFor(() => expect(screen.getByText('empty response')).toBeInTheDocument());
  });

  it('full pipeline: analyze BPM, Key, Chords, Setlist then mint and DM with rich context', async () => {
    const { container } = render(<MusicActionPanel />);
    // Track title
    fireEvent.change(screen.getByPlaceholderText('Track title'), { target: { value: 'Epic' } });
    // BPM
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { bpm: 174, tempoBand: 'dnb' } } });
    fireEvent.change(container.querySelectorAll('textarea')[0], { target: { value: '{}' } });
    fireEvent.click(screen.getByText('BPM'));
    await waitFor(() => expect(screen.getByText('BPM 174.')).toBeInTheDocument());
    // Key
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { key: 'F', scale: 'minor' } } });
    fireEvent.click(screen.getByText('Key'));
    await waitFor(() => expect(screen.getByText('Key: F minor.')).toBeInTheDocument());
    // Chords
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { progression: ['Fm', 'Ab'], commonPattern: 'i-III' } } });
    fireEvent.change(screen.getByPlaceholderText('Chords (space-separated)'), { target: { value: 'Fm Ab' } });
    fireEvent.click(screen.getByText('Chords'));
    await waitFor(() => expect(screen.getByText('Progression analyzed.')).toBeInTheDocument());
    // Setlist
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { tracks: [], totalMinutes: 30, energyArc: 'peak' } } });
    fireEvent.change(container.querySelectorAll('textarea')[1], { target: { value: 'A 120 Cm' } });
    fireEvent.click(screen.getByText('Setlist'));
    await waitFor(() => expect(screen.getByText('Setlist: 30min.')).toBeInTheDocument());
    // Mint — with all analysis populated, the meta payload exercises every branch
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { dtu: { id: 'minted-deadbeef' } } } });
    fireEvent.click(screen.getByText('Mint'));
    await waitFor(() => expect(screen.getByText(/Music DTU minted-d/)).toBeInTheDocument());
    // mint tile relabels to "Saved" once the DTU id lands
    expect(screen.getByText('Saved')).toBeInTheDocument();
    // DM — body interpolates bpm/key/chords/mintedDtuId branches
    apiPost.mockResolvedValueOnce({ data: { ok: true, message: { id: 'm9' } } });
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'collab-1' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(screen.getByText('Sent. 60s to recall.')).toBeInTheDocument());
  });

  it('DM send failure surfaces the error', async () => {
    apiPost.mockResolvedValue({ data: { ok: false, error: 'recipient blocked' } });
    render(<MusicActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'user-9' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(screen.getByText('recipient blocked')).toBeInTheDocument());
  });

  it('Publish failure (no DTU id) surfaces the error', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<MusicActionPanel />);
    fireEvent.click(screen.getByText('Publish'));
    await waitFor(() => expect(screen.getByText('No DTU id.')).toBeInTheDocument());
  });
});

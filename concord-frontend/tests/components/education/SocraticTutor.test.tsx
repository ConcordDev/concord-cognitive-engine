import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SocraticTutor } from '@/components/education/SocraticTutor';

describe('SocraticTutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollTo = vi.fn();
    lensRun.mockResolvedValue({ data: { ok: true, result: { text: 'What do you think the first step is?' } } });
  });

  it('renders the greeting with subject and hint tier', () => {
    render(<SocraticTutor subject="algebra" level="middle school" />);
    expect(screen.getByText(/think through algebra problems/)).toBeInTheDocument();
    expect(screen.getByText('Hint tier 1/3')).toBeInTheDocument();
  });

  it('sends a student message and renders the tutor reply', async () => {
    render(<SocraticTutor subject="algebra" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a question/), { target: { value: 'How do I solve 2x=4?' } });
    fireEvent.click(screen.getByText('Ask'));
    expect(screen.getByText('How do I solve 2x=4?')).toBeInTheDocument();
    expect(await screen.findByText('What do you think the first step is?')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tutor-ask' }),
    );
  });

  it('sends on Enter without shift', async () => {
    render(<SocraticTutor />);
    const textarea = screen.getByPlaceholderText(/Ask a question/);
    fireEvent.change(textarea, { target: { value: 'help me' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(screen.getByText('help me')).toBeInTheDocument();
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('does not send on shift+Enter', () => {
    render(<SocraticTutor />);
    const textarea = screen.getByPlaceholderText(/Ask a question/);
    fireEvent.change(textarea, { target: { value: 'multiline' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('escalates hints via the Bigger hint button', async () => {
    render(<SocraticTutor />);
    // send one message so the Bigger-hint button appears
    fireEvent.change(screen.getByPlaceholderText(/Ask a question/), { target: { value: 'q1' } });
    fireEvent.click(screen.getByText('Ask'));
    await screen.findByText('What do you think the first step is?');
    fireEvent.click(screen.getByText('Bigger hint'));
    expect(screen.getByText('Could you give me a small nudge?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Hint tier 2/3')).toBeInTheDocument());
  });

  it('resets the conversation and hint tier', async () => {
    render(<SocraticTutor subject="geometry" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a question/), { target: { value: 'first' } });
    fireEvent.click(screen.getByText('Ask'));
    await screen.findByText('What do you think the first step is?');
    fireEvent.click(screen.getByTitle('Reset'));
    await waitFor(() => expect(screen.queryByText('first')).not.toBeInTheDocument());
    expect(screen.getByText('Hint tier 1/3')).toBeInTheDocument();
  });

  it('renders an error message when the request rejects', async () => {
    lensRun.mockRejectedValue(new Error('network down'));
    render(<SocraticTutor />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a question/), { target: { value: 'q' } });
    fireEvent.click(screen.getByText('Ask'));
    expect(await screen.findByText(/Error: network down/)).toBeInTheDocument();
  });

  it('falls back to a no-response message when reply is empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<SocraticTutor />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a question/), { target: { value: 'q' } });
    fireEvent.click(screen.getByText('Ask'));
    expect(await screen.findByText('(no response — try again)')).toBeInTheDocument();
  });

  it('shows lesson-context indicator when context is provided', () => {
    render(<SocraticTutor context="Chapter 3 notes" />);
    expect(screen.getByText('Lesson context loaded')).toBeInTheDocument();
  });

  it('does not send an empty draft', () => {
    render(<SocraticTutor />);
    fireEvent.click(screen.getByText('Ask'));
    expect(lensRun).not.toHaveBeenCalled();
  });
});

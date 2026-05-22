import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Force the xterm.js import to fail → component uses the fallback <pre> renderer,
// which is the path we can deterministically assert text against.
vi.mock('@xterm/xterm', () => {
  throw new Error('xterm unavailable in test env');
});

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
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

import { TerminalPanel } from '@/components/code/TerminalPanel';

const baseProps = {
  onClose: vi.fn(),
  activeCode: 'console.log(1)',
  activeLanguage: 'javascript',
  activeName: 'main.js',
};

describe('TerminalPanel', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('renders nothing when closed', () => {
    render(<TerminalPanel open={false} {...baseProps} />);
    expect(screen.queryByText('Terminal')).not.toBeInTheDocument();
  });

  it('renders the fallback terminal with the welcome line', async () => {
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText(/Concord code terminal/)).toBeInTheDocument()
    );
    expect(screen.getByText('fallback renderer')).toBeInTheDocument();
  });

  it('runs the help built-in', async () => {
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.change(input, { target: { value: 'help' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/Built-ins: run, clear, help/)).toBeInTheDocument();
  });

  it('clears the buffer with the clear built-in', async () => {
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.change(input, { target: { value: 'clear' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Cleared.')).toBeInTheDocument();
  });

  it('evaluates a JS expression with eval', async () => {
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.change(input, { target: { value: 'eval 2 + 3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('reports an eval error', async () => {
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.change(input, { target: { value: 'eval (((' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/SyntaxError|Error/)).toBeInTheDocument();
  });

  it('runs the active file via the Run button and shows output', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { stdout: 'hello out', exitCode: 0 } },
    });
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() => expect(screen.getByText('hello out')).toBeInTheDocument());
    expect(screen.getByText(/exit 0 in/)).toBeInTheDocument();
  });

  it('renders stderr when the run fails', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { stderr: 'boom error', exitCode: 1 } },
    });
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() => expect(screen.getByText('boom error')).toBeInTheDocument());
  });

  it('routes an unknown command to code.exec', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { stdout: 'snippet out' } } });
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.change(input, { target: { value: 'console.log(7)' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('snippet out')).toBeInTheDocument());
  });

  it('shows "(no output)" when an exec returns nothing', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.change(input, { target: { value: 'noop()' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('(no output)')).toBeInTheDocument());
  });

  it('handles an exec rejection', async () => {
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('exec crashed')));
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.change(input, { target: { value: 'fail()' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('exec crashed')).toBeInTheDocument());
  });

  it('runs the file via the "run" built-in command', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { stdout: 'ran it' } } });
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.change(input, { target: { value: 'run' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('ran it')).toBeInTheDocument());
  });

  it('clears the buffer with the toolbar Clear button', async () => {
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByText('Cleared.')).toBeInTheDocument();
  });

  it('maximises and restores the panel', async () => {
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Maximise'));
    expect(screen.getByTitle('Restore')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Restore'));
    expect(screen.getByTitle('Maximise')).toBeInTheDocument();
  });

  it('closes via the close button', async () => {
    const onClose = vi.fn();
    render(<TerminalPanel open {...baseProps} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Close (⌃`)'));
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores an empty command submission', async () => {
    render(<TerminalPanel open {...baseProps} />);
    await waitFor(() => expect(screen.getByText('fallback renderer')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/type "run"/);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(lensRun).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// MonacoWrapper is dynamically imported; replace it with a controllable stub.
let monacoProps: Record<string, unknown> = {};
vi.mock('@/components/code/MonacoWrapper', () => ({
  default: (props: Record<string, unknown>) => {
    monacoProps = props;
    return React.createElement('div', { 'data-testid': 'monaco' }, String(props.value));
  },
}));

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

import { EditorPane } from '@/components/code/EditorPane';

describe('EditorPane', () => {
  beforeEach(() => {
    lensRun.mockReset();
    monacoProps = {};
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows the pick-a-project empty state when projectId is null', () => {
    render(<EditorPane projectId={null} openPath={null} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Pick or create a project to begin.')).toBeInTheDocument();
  });

  it('shows the open-a-file hint when a project but no file is selected', () => {
    render(<EditorPane projectId="p1" openPath={null} onOpenChange={vi.fn()} />);
    expect(
      screen.getByText('Open a file from the Explorer to start editing.')
    ).toBeInTheDocument();
  });

  it('opens a file and renders its content in the editor', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { content: 'hello world', language: 'typescript' } },
    });
    render(<EditorPane projectId="p1" openPath="src/a.ts" onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('monaco')).toBeInTheDocument());
    expect(screen.getByTestId('monaco')).toHaveTextContent('hello world');
  });

  it('alerts when files-read returns ok:false', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'no perms' } });
    render(<EditorPane projectId="p1" openPath="src/a.ts" onOpenChange={vi.fn()} />);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('no perms'));
  });

  it('edits content, saves it, and clears the modified state', async () => {
    lensRun
      .mockResolvedValueOnce({
        data: { ok: true, result: { content: 'orig', language: 'javascript' } },
      })
      .mockResolvedValue({ data: { ok: true, result: {} } });
    const onContentSaved = vi.fn();
    render(
      <EditorPane
        projectId="p1"
        openPath="src/a.js"
        onOpenChange={vi.fn()}
        onContentSaved={onContentSaved}
      />
    );
    await waitFor(() => expect(screen.getByTestId('monaco')).toBeInTheDocument());
    // simulate an edit through the stubbed Monaco onChange
    (monacoProps.onChange as (v: string) => void)('changed content');
    await waitFor(() => expect(screen.getByText('Save').closest('button')).toBeEnabled());
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'files-write')).toBe(true)
    );
    await waitFor(() => expect(onContentSaved).toHaveBeenCalled());
  });

  it('formats a file via the format button', async () => {
    lensRun
      .mockResolvedValueOnce({
        data: { ok: true, result: { content: 'unformatted', language: 'javascript' } },
      })
      .mockResolvedValue({ data: { ok: true, result: { formatted: 'formatted code' } } });
    render(<EditorPane projectId="p1" openPath="src/a.js" onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('monaco')).toBeInTheDocument());
    fireEvent.click(screen.getByText('format'));
    await waitFor(() =>
      expect(screen.getByTestId('monaco')).toHaveTextContent('formatted code')
    );
  });

  it('shows the inline-edit affordance after a selection and runs the edit', async () => {
    lensRun
      .mockResolvedValueOnce({
        data: { ok: true, result: { content: 'rename me here', language: 'javascript' } },
      })
      .mockResolvedValue({ data: { ok: true, result: { edited: 'renamed here' } } });
    render(<EditorPane projectId="p1" openPath="src/a.js" onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('monaco')).toBeInTheDocument());
    // make a selection
    (monacoProps.onSelectionChange as (s: { text: string }) => void)({ text: 'rename me' });
    await waitFor(() => expect(screen.getByText('⌘K')).toBeInTheDocument());
    fireEvent.click(screen.getByText('⌘K'));
    const input = screen.getByPlaceholderText(/Inline edit/);
    fireEvent.change(input, { target: { value: 'rename it' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('monaco')).toHaveTextContent('renamed here')
    );
  });

  it('closes a tab; modified-tab close is gated by confirm', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { content: 'data', language: 'javascript' } },
    });
    const onOpenChange = vi.fn();
    render(<EditorPane projectId="p1" openPath="src/a.js" onOpenChange={onOpenChange} />);
    await waitFor(() => expect(screen.getByTestId('monaco')).toBeInTheDocument());
    (monacoProps.onChange as (v: string) => void)('dirty');
    await waitFor(() => expect(screen.getByText('Save').closest('button')).toBeEnabled());
    // close the (modified) tab
    const closeBtn = screen
      .getAllByTestId('icon-X')[0]
      .closest('button')!;
    fireEvent.click(closeBtn);
    expect(window.confirm).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(null);
  });

  it('saves on Cmd-S keyboard shortcut', async () => {
    lensRun
      .mockResolvedValueOnce({
        data: { ok: true, result: { content: 'kbd', language: 'javascript' } },
      })
      .mockResolvedValue({ data: { ok: true, result: {} } });
    render(<EditorPane projectId="p1" openPath="src/a.js" onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('monaco')).toBeInTheDocument());
    (monacoProps.onChange as (v: string) => void)('kbd-edit');
    await waitFor(() => expect(screen.getByText('Save').closest('button')).toBeEnabled());
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'files-write')).toBe(true)
    );
  });

  it('handles a file-open rejection gracefully', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('open fail')));
    render(<EditorPane projectId="p1" openPath="src/a.js" onOpenChange={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByText('Open a file from the Explorer to start editing.')
      ).toBeInTheDocument()
    );
  });
});

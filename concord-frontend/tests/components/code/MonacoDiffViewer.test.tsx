import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

let lastDiffProps: Record<string, unknown> = {};

vi.mock('@monaco-editor/react', () => {
  return {
    DiffEditor: (props: Record<string, unknown>) => {
      lastDiffProps = props;
      return React.createElement('div', { 'data-testid': 'diff-editor' }, 'diff');
    },
  };
});

import MonacoDiffViewer from '@/components/code/MonacoDiffViewer';

describe('MonacoDiffViewer', () => {
  beforeEach(() => {
    lastDiffProps = {};
  });

  it('renders the diff editor with original + modified', async () => {
    render(<MonacoDiffViewer original="a" modified="b" />);
    await waitFor(() => expect(screen.getByTestId('diff-editor')).toBeInTheDocument());
    expect(lastDiffProps.original).toBe('a');
    expect(lastDiffProps.modified).toBe('b');
  });

  it('resolves a default language to javascript', async () => {
    render(<MonacoDiffViewer original="a" modified="b" />);
    await waitFor(() => expect(lastDiffProps.language).toBe('javascript'));
  });

  it('resolves a known alias and passes unknown through', async () => {
    const { rerender } = render(<MonacoDiffViewer original="a" modified="b" language="ts" />);
    await waitFor(() => expect(lastDiffProps.language).toBe('typescript'));
    rerender(<MonacoDiffViewer original="a" modified="b" language="haskell" />);
    await waitFor(() => expect(lastDiffProps.language).toBe('haskell'));
  });

  it('honours the renderSideBySide option', async () => {
    render(<MonacoDiffViewer original="a" modified="b" renderSideBySide={false} />);
    await waitFor(() =>
      expect((lastDiffProps.options as { renderSideBySide: boolean }).renderSideBySide).toBe(false)
    );
  });

  it('applies a custom className wrapper', async () => {
    const { container } = render(
      <MonacoDiffViewer original="a" modified="b" className="custom-wrap" />
    );
    await waitFor(() => expect(screen.getByTestId('diff-editor')).toBeInTheDocument());
    expect(container.querySelector('.custom-wrap')).toBeInTheDocument();
  });

  it('onMount defines and sets the diff theme', async () => {
    render(<MonacoDiffViewer original="a" modified="b" />);
    await waitFor(() => expect(lastDiffProps.onMount).toBeTypeOf('function'));
    const monaco = { editor: { defineTheme: vi.fn(), setTheme: vi.fn() } };
    (lastDiffProps.onMount as (e: unknown, m: unknown) => void)({}, monaco);
    expect(monaco.editor.defineTheme).toHaveBeenCalledWith(
      'concord-dark-diff',
      expect.any(Object)
    );
    expect(monaco.editor.setTheme).toHaveBeenCalledWith('concord-dark-diff');
  });
});

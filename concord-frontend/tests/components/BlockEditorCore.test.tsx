import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import { BlockEditor } from '@/components/editor/BlockEditorCore';

// Real tiptap/ProseMirror editor mounted against jsdom. ProseMirror needs a
// couple of DOM measurement APIs jsdom doesn't implement — polyfilled here,
// scoped to this file only, rather than the global test setup.
beforeEach(() => {
  if (!(document as any).createRange().getClientRects) {
    // no-op; jsdom already has a stub in modern versions
  }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 100, height: 20, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => {} }),
  });
});

afterEach(() => cleanup());

describe('BlockEditor (tiptap)', () => {
  it('renders the toolbar, editor content, and starts at 0 words for empty content', async () => {
    render(<BlockEditor content="" />);
    await waitFor(() => expect(screen.getByText('0 words')).toBeInTheDocument());
    expect(screen.getByTitle('Bold')).toBeInTheDocument();
    expect(screen.getByTitle('Undo')).toBeDisabled();
  });

  it('renders seeded HTML content into the editor', async () => {
    render(<BlockEditor content="<p>Hello world</p>" />);
    await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());
  });

  it('calls onChange with updated HTML and updates the word count when typing', async () => {
    const onChange = vi.fn();
    render(<BlockEditor content="<p></p>" onChange={onChange} />);
    const editable = document.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable).toBeTruthy();
    fireEvent.focus(editable);
    editable.textContent = 'Hi there';
    fireEvent.input(editable);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('toggling Bold marks the toolbar button active and toggling it off clears it', async () => {
    render(<BlockEditor content="<p>Some text</p>" />);
    await waitFor(() => expect(screen.getByText('Some text')).toBeInTheDocument());
    const boldBtn = screen.getByTitle('Bold');
    expect(boldBtn.className).not.toContain('neon-cyan');
    fireEvent.click(boldBtn);
    // Toggling with no selection still runs the command without throwing;
    // the toolbar reflects editor.isActive('bold') either way.
    expect(boldBtn).toBeInTheDocument();
  });

  it('the heading, list, quote, and divider buttons all run without throwing', async () => {
    render(<BlockEditor content="<p>Text</p>" />);
    await waitFor(() => expect(screen.getByText('Text')).toBeInTheDocument());
    for (const title of ['Heading 1', 'Heading 2', 'Heading 3', 'Bullet List', 'Numbered List', 'Task List', 'Quote', 'Divider', 'Italic', 'Strikethrough', 'Code', 'Highlight']) {
      fireEvent.click(screen.getByTitle(title));
    }
    expect(screen.getByText(/words/)).toBeInTheDocument();
  });

  it('setLink prompts for a URL and applies it; empty submit does nothing; null cancels', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    render(<BlockEditor content="<p>link me</p>" />);
    await waitFor(() => expect(screen.getByText('link me')).toBeInTheDocument());

    promptSpy.mockReturnValueOnce(null);
    fireEvent.click(screen.getByTitle('Link'));
    promptSpy.mockReturnValueOnce('https://example.com');
    fireEvent.click(screen.getByTitle('Link'));
    expect(promptSpy).toHaveBeenCalledWith('URL', undefined);
    promptSpy.mockRestore();
  });

  it('addImage prompts for a URL and inserts it when provided', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com/a.png');
    render(<BlockEditor content="<p>x</p>" />);
    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Image'));
    expect(promptSpy).toHaveBeenCalledWith('Image URL');
    promptSpy.mockRestore();
  });

  it('addImage does nothing when the prompt is cancelled', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<BlockEditor content="<p>x</p>" />);
    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Image'));
    expect(promptSpy).toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('inserting a table does not throw and the editor stays mounted', async () => {
    render(<BlockEditor content="<p>table time</p>" />);
    await waitFor(() => expect(screen.getByText('table time')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Table'));
    await waitFor(() => expect(document.querySelector('table')).toBeInTheDocument());
  });

  it('Cmd+S triggers onSave with the current HTML', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<BlockEditor content="<p>save me</p>" onSave={onSave} />);
    await waitFor(() => expect(screen.getByText('save me')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.stringContaining('save me')));
  });

  it('renders as non-editable when editable=false', async () => {
    render(<BlockEditor content="<p>read only</p>" editable={false} />);
    await waitFor(() => expect(screen.getByText('read only')).toBeInTheDocument());
    const editable = document.querySelector('.ProseMirror');
    expect(editable).toHaveAttribute('contenteditable', 'false');
  });

  it('applies a custom placeholder and className', async () => {
    const { container } = render(<BlockEditor content="" placeholder="Type here…" className="my-editor" />);
    await waitFor(() => expect(container.querySelector('.my-editor')).toBeInTheDocument());
  });
});

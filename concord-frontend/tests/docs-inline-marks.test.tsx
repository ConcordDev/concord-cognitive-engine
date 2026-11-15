// FIX-docs-003 — inline rich text for Docs blocks. Pins: the mark
// parser/renderer (bold and the whole set, escape-first, unsafe links
// dropped, unbalanced markers literal, code spans exempt), the
// selection toggle helpers, and BlockEditorRow's contract — marks
// render when the row is not being edited, Ctrl+B wraps the selection
// while editing, and the toolbar carries the mark buttons.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { parseInlineMarks, renderInlineMarks, toggleMark, applyLinkMark } from '@/components/docs/inline-marks';
import { BlockEditorRow } from '@/components/docs/BlockEditorRow';
import type { Block } from '@/components/docs/types';

afterEach(() => cleanup());

describe('parseInlineMarks', () => {
  it('parses bold, italic, strike, code and links', () => {
    const segs = parseInlineMarks('a **bold** and *it* ~~gone~~ `x**y` [site](https://example.com) end');
    const byText = Object.fromEntries(segs.map((s) => [s.text, s]));
    expect(byText['bold'].bold).toBe(true);
    expect(byText['it'].italic).toBe(true);
    expect(byText['gone'].strike).toBe(true);
    expect(byText['x**y'].code).toBe(true);
    expect(byText['site'].href).toBe('https://example.com');
  });

  it('nests italic inside bold', () => {
    const segs = parseInlineMarks('**a *b* c**');
    const b = segs.find((s) => s.text === 'b');
    expect(b?.bold).toBe(true);
    expect(b?.italic).toBe(true);
  });

  it('unbalanced markers render literally', () => {
    const segs = parseInlineMarks('a **bold');
    expect(segs.every((s) => !s.bold)).toBe(true);
    expect(segs.map((s) => s.text).join('')).toBe('a **bold');
  });

  it('an unsafe link URL drops the link, keeping the label as text', () => {
    const segs = parseInlineMarks('[click](javascript:alert(1))');
    expect(segs.some((s) => s.href)).toBe(false);
  });
});

describe('renderInlineMarks', () => {
  it('renders marks as elements and user HTML as inert text', () => {
    const { container } = render(<div>{renderInlineMarks('**b** <img src=x onerror=alert(1)>')}</div>);
    expect(container.querySelector('strong')?.textContent).toBe('b');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('toggleMark / applyLinkMark', () => {
  it('wraps and unwraps a selection', () => {
    const wrapped = toggleMark('hello world', 6, 11, '**');
    expect(wrapped.value).toBe('hello **world**');
    const unwrapped = toggleMark(wrapped.value, wrapped.selStart, wrapped.selEnd, '**');
    expect(unwrapped.value).toBe('hello world');
  });

  it('an empty selection inserts a marker pair with the caret between', () => {
    const r = toggleMark('ab', 1, 1, '*');
    expect(r.value).toBe('a**b');
    expect(r.selStart).toBe(2);
  });

  it('applyLinkMark wraps and selects the URL portion', () => {
    const r = applyLinkMark('see docs', 4, 8);
    expect(r.value).toBe('see [docs](https://)');
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('https://');
  });
});

const baseBlock: Block = { id: 'b1', type: 'paragraph', text: 'a **bold** word', checked: false };
const rowProps = {
  cursors: [],
  onChange: () => {},
  onDelete: () => {},
  onUp: () => {},
  onDown: () => {},
  onFocus: () => {},
};

describe('BlockEditorRow inline marks', () => {
  it('renders marks when not editing; Ctrl+B wraps while editing', () => {
    const { container } = render(<BlockEditorRow block={baseBlock} {...rowProps} />);
    // not editing: the mark renders as a <strong>, markers not shown raw
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    // click to edit: the textarea carries the raw marked text
    fireEvent.click(screen.getByLabelText('Edit block text'));
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe('a **bold** word');
    // select "a" and press Ctrl+B -> wraps in **
    ta.setSelectionRange(0, 1);
    fireEvent.keyDown(ta, { key: 'b', ctrlKey: true });
    expect(ta.value).toBe('**a** **bold** word');
    // the format toolbar is present while editing
    expect(screen.getByLabelText('Bold (Ctrl+B)')).toBeTruthy();
    expect(screen.getByLabelText('Link (Ctrl+K)')).toBeTruthy();
  });

  it('plain text without marks renders unchanged', () => {
    const { container } = render(
      <BlockEditorRow block={{ ...baseBlock, text: 'just plain text' }} {...rowProps} />,
    );
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('just plain text');
  });
});

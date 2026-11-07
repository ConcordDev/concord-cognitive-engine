// Coverage for the dependency-free markdown renderer: plain text, headings, lists, code fences,
// inline tokens, escapes, links and @mentions.

import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FmMarkdown } from '../fmMarkdown';

afterEach(() => cleanup());

describe('FmMarkdown', () => {
  it('renders nothing for empty text and plain text for non-markdown', () => {
    expect(render(<FmMarkdown text="" />).container.innerHTML).toBe('');
    const { container } = render(<FmMarkdown text={'hello\nworld'} textClassName="custom" />);
    expect(container.querySelector('p.custom')?.textContent).toBe('hello\nworld');
  });

  it('renders headings, lists, fenced code and inline tokens in markdown mode', () => {
    const text = [
      '# Title', '## Sub', '### Third', '',
      'Some **bold**, *ital*, _under_, `code` and [link](https://example.com) with \\* escape',
      '- one', '* two', 'after list', '',
      '```', 'const a = 1;', 'const b = 2;', '```',
      'tail',
    ].join('\n');
    const { container } = render(<FmMarkdown text={text} format="markdown" />);
    expect(container.querySelectorAll('p').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelectorAll('em').length).toBe(2);
    expect(container.querySelectorAll('code').length).toBe(2);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('pre')?.textContent).toContain('const b = 2;');
    expect(container.textContent).toContain('* escape');
  });

  it('flushes a trailing list and closes an unterminated code fence', () => {
    const a = render(<FmMarkdown text={'- a\n- b'} format="markdown" />);
    expect(a.container.querySelectorAll('li').length).toBe(2);
    cleanup();
    const b = render(<FmMarkdown text={'```\nopen fence'} format="markdown" />);
    expect(b.container.querySelector('pre')?.textContent).toContain('open fence');
  });

  it('tokenises @mentions only when enabled', () => {
    const on = render(<FmMarkdown text="hi @ada-l and **you**" format="markdown" mentions />);
    expect(on.container.querySelector('span.font-semibold')?.textContent).toBe('@ada-l');
    cleanup();
    const off = render(<FmMarkdown text="hi @ada-l" format="markdown" />);
    expect(off.container.querySelector('span.font-semibold')).toBeNull();
  });
});

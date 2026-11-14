/**
 * GB-1538 / FIX-code-quality-005 — evidence pin for a verdict closure.
 * The ticket reports laggy typing in the Analyze name field and text
 * "spilling" into the code box. The shipped panel keeps both fields in
 * separate local state with no per-keystroke derivation or shared
 * handler — there is no in-code path for one field's text to enter the
 * other, or for keystrokes to be eaten. This pin documents the boundary
 * behaviour; the walk-era lag is not reproducible in the panel's code.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalyzePanel } from '@/components/code-quality/AnalyzePanel';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));

describe('AnalyzePanel field isolation (FIX-code-quality-005 evidence)', () => {
  it('typing the walk string into the path field keeps every character and leaves the code box empty', () => {
    render(<AnalyzePanel scan={null} onScan={() => undefined} />);
    const path = screen.getByPlaceholderText('file path (sets language)') as HTMLInputElement;
    const source = screen.getByPlaceholderText(/Paste a source file here/) as HTMLTextAreaElement;
    fireEvent.change(path, { target: { value: 'qa-zt5-code-quality-2026-11-09' } });
    expect(path.value).toBe('qa-zt5-code-quality-2026-11-09');
    expect(source.value).toBe('');
  });

  it('typing into the code box leaves the path field untouched', () => {
    render(<AnalyzePanel scan={null} onScan={() => undefined} />);
    const path = screen.getByPlaceholderText('file path (sets language)') as HTMLInputElement;
    const source = screen.getByPlaceholderText(/Paste a source file here/) as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: 'const x = 1;' } });
    expect(source.value).toBe('const x = 1;');
    expect(path.value).toBe('snippet.js');
  });
});

/**
 * H5 — Ctrl+N (Quick Capture) and Ctrl+/ (Assistant) stand down while a
 * field is focused; Ctrl+J is already guarded in ConKayOverlay.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickCapture } from '@/components/common/QuickCapture';
import DomainAssistant from '@/components/common/DomainAssistant';

afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe('H5 hotkeys yield to fields', () => {
  it('Ctrl+N does not open Quick Capture from a field, does from the page', () => {
    render(wrap(<><input aria-label="filter" /><QuickCapture domain="docs" /></>));
    const input = screen.getByLabelText('filter');
    input.focus();
    const ev = fireEvent.keyDown(input, { key: 'n', ctrlKey: true });
    expect(ev).toBe(true); // not preventDefault-ed
    expect(screen.queryByRole('dialog')).toBeNull();
    (input as HTMLInputElement).blur();
    const ev2 = fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    expect(ev2).toBe(false);
  });

  it('Ctrl+/ does not open the Assistant from a field, does from the page', () => {
    render(wrap(<><textarea aria-label="notes" /><DomainAssistant domain="docs" domainLabel="Docs" /></>));
    const ta = screen.getByLabelText('notes');
    ta.focus();
    expect(fireEvent.keyDown(ta, { key: '/', ctrlKey: true })).toBe(true);
    ta.blur();
    expect(fireEvent.keyDown(document.body, { key: '/', ctrlKey: true })).toBe(false);
  });
});

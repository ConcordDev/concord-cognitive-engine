/**
 * Linguistics 'Open a text' FAB focus target (FIX-linguistics-006).
 *
 * The FAB switched to the analyze view and then tried to focus a
 * <textarea> — but AnalyzePanel's text field is an <input>, so the
 * focus loop retried 20 frames and silently gave up: no modal, no
 * focus, no feedback — a dead click whenever the analyze view was
 * already showing. The panel now marks its field
 * data-open-text-target and the FAB's selector targets it first.
 */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { render } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));

import { AnalyzePanel } from '@/components/linguistics/AnalyzePanel';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('linguistics open-a-text target (FIX-linguistics-006)', () => {
  it('the analyze text field carries the focus target marker', () => {
    const { container } = render(<AnalyzePanel />);
    const field = container.querySelector('[data-open-text-target]');
    expect(field).not.toBeNull();
    expect(field?.tagName).toBe('INPUT');
  });

  it("the FAB's focus selector reaches the marked field, not only textareas", () => {
    const page = read('app/lenses/linguistics/page.tsx');
    expect(page).toContain('[data-open-text-target]');
    expect(page).toContain("setActive('analyze')");
  });
});

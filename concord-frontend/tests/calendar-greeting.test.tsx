/**
 * Calendar grid northstar greeting.
 *
 * The Calendar concept (docs/lens-northstar/08) opens on the serif
 * headline "Your week, Ramaj" with the period ("October 2026") as the
 * sub-line. The grid workbench's header carries that headline; this
 * pins it with the signed-in username while the period label renders.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast: () => {} }) },
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: () => Promise.resolve({ data: { ok: true, result: { events: [], calendars: [] } } }),
}));
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

import { CalendarGridWorkbench } from '@/components/calendar/CalendarGridWorkbench';

describe('Calendar grid greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', async () => {
    render(<CalendarGridWorkbench />);
    const greeting = await screen.findByTestId('calendar-greeting');
    expect(greeting.textContent).toBe('Your week, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});

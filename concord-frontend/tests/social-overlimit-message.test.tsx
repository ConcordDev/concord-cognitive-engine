// Audit fix sweep (PR #2356) — FIX-social-004: an over-limit post
// showed only a negative counter (-1630) with no message saying what
// was wrong or what to do. Going over the 500-character limit now says
// so in words, with the exact overage.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, data: null }),
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => ({}), { getState: () => ({ addToast: () => {} }) }),
}));
vi.mock('@/components/social/MentionAutocomplete', () => ({
  MentionAutocomplete: ({ value, onChange, renderInput }: {
    value: string;
    onChange: (v: string) => void;
    renderInput: (props: Record<string, unknown>) => React.ReactNode;
  }) => renderInput({ value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }),
}));
vi.mock('@/components/social/invalidate-post-surfaces', () => ({
  invalidatePostSurfaces: vi.fn(),
}));

import { QuickPostComposer } from '@/components/social/QuickPostComposer';

describe('social composer — over the limit says so in words', () => {
  it('shows the overage message and disables Post at 501 characters', () => {
    const view = render(<QuickPostComposer currentUserId="u1" />);
    const area = view.getByLabelText('Post text') as HTMLTextAreaElement;

    fireEvent.change(area, { target: { value: 'x'.repeat(501) } });
    const alert = view.getByRole('alert');
    expect(alert.textContent).toContain('1 over the 500-character limit');
    expect(alert.textContent).toContain('trim to post');
    expect((view.getByRole('button', { name: 'Post' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(area, { target: { value: 'short post' } });
    expect(view.queryByRole('alert')).toBeNull();
    expect((view.getByRole('button', { name: 'Post' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

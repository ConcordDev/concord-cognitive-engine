/**
 * Affect S-AFF-6 — input survival.
 *
 * F9: the strip's session input was bound directly to the context
 * session — every keystroke re-keyed every query in the lens and the
 * strip's loading branch unmounted the input mid-typing. It now edits
 * a local draft and commits on blur/Enter.
 * F10 (shared component): SaveAsDtuButton re-synced its title/tags
 * fields from props on EVERY prop change — callers that re-render on a
 * poll (or embed a fresh timestamp in the title) overwrote the user's
 * typed title mid-edit. The sync now runs only while the modal is
 * closed; once open, the user's edits own the fields.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

type QState = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };
const q: Record<string, QState> = {
  'affect-state': {
    data: { state: { v: 0.5, a: 0.25, s: 0.8, c: 0.8, g: 0.7, t: 0.7, f: 0.2 } },
    isLoading: false, isError: false, error: null,
  },
  'affect-policy': { data: { policy: {} }, isLoading: false, isError: false, error: null },
  'affect-health': { data: { healthy: true, sessions: 1 }, isLoading: false, isError: false, error: null },
  'affect-events': { data: { events: [] }, isLoading: false, isError: false, error: null },
};
const refetch = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = String((opts.queryKey || [])[0] || '');
    const st = q[key] || { data: null, isLoading: false, isError: false, error: null };
    return { ...st, refetch };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    affect: {
      state: vi.fn(), policy: vi.fn(), health: vi.fn(), events: vi.fn(), reset: vi.fn(), emit: vi.fn(),
    },
    dtus: { create: vi.fn() },
  },
  lensRun: vi.fn(),
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
}));

vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  ContentClassLicenseFields: () => null,
  buildContentLicensePayload: () => ({
    contentClass: 'dataset', licenseScopes: ['private'], scopes: [], license: null, meta: {},
  }),
}));

vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: () => null,
}));

import { AffectSessionProvider, useAffectSession } from '@/components/affect/AffectSessionContext';
import { AffectStateStrip } from '@/components/affect/AffectStateStrip';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

function SessionProbe() {
  const { sessionId } = useAffectSession();
  return <div data-testid="session-probe">{sessionId}</div>;
}

describe('Affect S-AFF-6 — the session input survives typing (F9)', () => {
  it('typing edits a draft; the session commits only on blur', () => {
    const { getByLabelText, getByTestId } = render(
      <AffectSessionProvider>
        <AffectStateStrip />
        <SessionProbe />
      </AffectSessionProvider>
    );
    const input = getByLabelText('Affect session id') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'm' } });
    fireEvent.change(input, { target: { value: 'my' } });
    fireEvent.change(input, { target: { value: 'my-session' } });
    // Mid-typing: the input holds the full draft, the session is untouched.
    expect(input.value).toBe('my-session');
    expect(getByTestId('session-probe').textContent).toBe('default');
    fireEvent.blur(input);
    expect(getByTestId('session-probe').textContent).toBe('my-session');
  });

  it('Enter commits; Escape discards the draft', () => {
    const { getByLabelText, getByTestId } = render(
      <AffectSessionProvider>
        <AffectStateStrip />
        <SessionProbe />
      </AffectSessionProvider>
    );
    const input = getByLabelText('Affect session id') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'via-enter' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(getByTestId('session-probe').textContent).toBe('via-enter');
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('via-enter');
    expect(getByTestId('session-probe').textContent).toBe('via-enter');
  });
});

describe('Affect S-AFF-6 — a typed DTU title survives caller re-renders (F10)', () => {
  it('the modal keeps the user title when the title prop changes', () => {
    const { getByLabelText, getByPlaceholderText, rerender } = render(
      <SaveAsDtuButton apiSource="concord-affect" title="Snapshot — T1" content="body" />
    );
    fireEvent.click(getByLabelText('Save as DTU'));
    const titleInput = getByPlaceholderText('Descriptive title') as HTMLInputElement;
    expect(titleInput.value).toBe('Snapshot — T1');
    fireEvent.change(titleInput, { target: { value: 'My own title' } });
    // The caller re-renders on its poll with a fresh timestamped title.
    rerender(<SaveAsDtuButton apiSource="concord-affect" title="Snapshot — T2" content="body" />);
    expect((getByPlaceholderText('Descriptive title') as HTMLInputElement).value).toBe('My own title');
  });
});

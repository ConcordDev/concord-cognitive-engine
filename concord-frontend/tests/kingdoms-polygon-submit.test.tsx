/**
 * F5 — With a saved draft present, typing a new polygon and submitting
 * posts the typed polygon (not the hydrated draft).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';
import React, { useEffect, useRef, useState } from 'react';

const SAVED_DRAFT = '[[869144,860000],[869224,860000],[869224,860080],[869144,860080]]';
const TYPED_POLY = '[[920000,860000],[920080,860000],[920080,860080],[920000,860080]]';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/kingdoms' && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ ok: true, kingdomId: 'kdm_new' }),
      };
    }
    return {
      ok: true,
      json: async () => ({ ok: true, kingdoms: [] }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Stand-in DraftedTextarea that races a late drafts.load hydrate against
 * user typing, matching useLensDraft's dirty-before-hydrate rule: once the
 * user has typed, hydrate must not overwrite.
 */
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: (props: {
    onValueChange?: (v: string) => void;
    className?: string;
    rows?: number;
  }) => {
    const [value, setValue] = useState('');
    const touched = useRef(false);
    useEffect(() => {
      const t = setTimeout(() => {
        if (touched.current) return;
        setValue(SAVED_DRAFT);
        props.onValueChange?.(SAVED_DRAFT);
      }, 40);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <textarea
        data-testid="polygon-advanced"
        className={props.className}
        rows={props.rows}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          touched.current = true;
          setValue(next);
          props.onValueChange?.(next);
        }}
      />
    );
  },
}));

vi.mock('@/components/kingdoms/RegionPolygonEditor', () => ({
  RegionPolygonEditor: () => <div data-testid="visual-editor" />,
}));

import { KingdomCreatePanel } from '@/components/kingdoms/KingdomCreatePanel';

describe('kingdoms F5 polygon submit vs draft hydrate', () => {
  it('typing a new polygon then submitting posts the typed polygon', async () => {
    render(<KingdomCreatePanel onCreated={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /advanced: raw json/i }));
    const ta = await screen.findByTestId('polygon-advanced');

    // Type before hydrate lands.
    fireEvent.change(ta, { target: { value: TYPED_POLY } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    // Hydrate must not have clobbered the typed value.
    expect((ta as HTMLTextAreaElement).value).toBe(TYPED_POLY);

    const name = screen.getByPlaceholderText(/Kingdom of/i);
    fireEvent.change(name, { target: { value: 'Second realm' } });
    fireEvent.click(screen.getByRole('button', { name: /found kingdom/i }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (c) => c[0] === '/api/kingdoms' && c[1]?.method === 'POST',
      );
      expect(posts.length).toBe(1);
      const body = JSON.parse(posts[0][1].body as string);
      expect(body.regionPolygon).toEqual(JSON.parse(TYPED_POLY));
      expect(body.regionPolygon).not.toEqual(JSON.parse(SAVED_DRAFT));
    });
  });
});

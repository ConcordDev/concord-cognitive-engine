/**
 * SLICE B7 pin — FIX-grounding-010, NAME leg.
 * The verification mint auto-titled the saved DTU from the claim and
 * offered no name field. The panel now takes an optional name and the
 * create carries it as the DTU title; blank keeps the claim title.
 * (Findability rides the platform Library search layer and deletion
 * the founder's canonical DTU verb — both named in the slice record,
 * neither is this panel's to fix.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { apiPost, lensRun } = vi.hoisted(() => ({ apiPost: vi.fn(), lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => apiPost(...args) },
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { ClaimVerificationPanel } from '@/components/grounding/ClaimVerificationPanel';

let createInput: Record<string, unknown> | null;

beforeEach(() => {
  apiPost.mockReset();
  lensRun.mockReset();
  createInput = null;
  apiPost.mockImplementation(async (_url: string, body: { input?: Record<string, unknown> }) => {
    createInput = body.input || null;
    return { data: { ok: true, result: { dtu: { id: 'dtu_test_1' } } } };
  });
  lensRun.mockImplementation(async () => ({ data: { ok: true, result: {}, error: null } }));
});

describe('FIX-grounding-010 — the mint takes a name', () => {
  it('a typed name becomes the DTU title; the private scope rides along', async () => {
    render(<ClaimVerificationPanel />);
    fireEvent.change(screen.getByLabelText('Claim'), { target: { value: 'The fastest land animal is the cheetah.' } });
    fireEvent.change(screen.getByLabelText(/Saved DTU name/), { target: { value: 'qa-zt2-grounding-2026-11-12-a' } });
    fireEvent.click(screen.getByRole('button', { name: /^Mint/ }));
    await waitFor(() => expect(createInput).toBeTruthy());
    expect(createInput!.title).toBe('qa-zt2-grounding-2026-11-12-a');
    expect((createInput!.meta as { visibility?: string }).visibility).toBe('private');
  });

  it('blank name keeps the claim-derived title', async () => {
    render(<ClaimVerificationPanel />);
    fireEvent.change(screen.getByLabelText('Claim'), { target: { value: 'Water boils at 100C at sea level.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Mint/ }));
    await waitFor(() => expect(createInput).toBeTruthy());
    expect(String(createInput!.title)).toContain('Verification — Water boils at 100C');
  });
});

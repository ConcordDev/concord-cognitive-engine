import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-export-006 premise exercise: an archive password
// under 4 characters must show an error and never reach the server.
// At branch state EncryptedArchive already guards + surfaces it via
// the panel info line; this pin exercises that behaviour end to end.

const h = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => h.lensRun(...a) }));

import { EncryptedArchive } from '@/components/export/ExportToolkit';

beforeEach(() => {
  h.lensRun.mockReset();
  h.lensRun.mockResolvedValue({ data: { ok: true, result: { algorithm: 'xor-fnv', salt: 's', plainChecksum: 'c', ciphertextBase64: 'eA==', byteLength: 10 } } });
});

describe('FIX-export-006 archive password floor', () => {
  it('a 2-char password shows the min-length error and never calls encrypt-archive', async () => {
    render(<EncryptedArchive dtus={[]} />);
    fireEvent.change(screen.getByPlaceholderText('min 4 chars'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: /Encrypt \+ download/ }));
    expect(await screen.findByText('Password must be at least 4 characters')).toBeTruthy();
    expect(h.lensRun.mock.calls.filter((c) => (c as unknown[])[1] === 'encrypt-archive')).toHaveLength(0);
  });

  it('a 4-char password proceeds to encrypt-archive', async () => {
    render(<EncryptedArchive dtus={[]} />);
    fireEvent.change(screen.getByPlaceholderText('min 4 chars'), { target: { value: 'abcd' } });
    fireEvent.click(screen.getByRole('button', { name: /Encrypt \+ download/ }));
    await waitFor(() => expect(h.lensRun.mock.calls.filter((c) => (c as unknown[])[1] === 'encrypt-archive')).toHaveLength(1));
  });
});

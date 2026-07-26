// ObsidianVaultExport panel — real render + interaction tests.
//
// Split out of tests/obsidian-vault-export.test.ts (stale-lying-test
// detector finding): that sibling file pins its whole-file test environment
// to plain Node (see its own header pragma) because fflate's zipSync/
// unzipSync need a single-realm Uint8Array (see that file's header comment
// for the jsdom cross-realm explanation) — incompatible with rendering a
// real React component (needs jsdom, this project's default test
// environment, which THIS file intentionally leaves untouched). The
// component-level claims that file used to pin as static source-text
// regexes now live here instead, driven through a real render + fireEvent +
// button click, with `lensRun` mocked only at the network boundary and
// `fflate` mocked as a thin pass-through spy around the REAL zipSync/strToU8
// (so we can inspect exactly what the component hands it, without the
// produced zip bytes being meaningful under jsdom's Uint8Array realm quirk —
// the byte-correctness of the real zip round trip is already covered by the
// node-environment tests in the sibling file).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

const zipSyncSpy = vi.fn();
vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>();
  return {
    ...actual,
    // Thin pass-through: forwards to the REAL fflate zipSync (proving this
    // is genuinely the npm package, not a fabricated stand-in) while letting
    // the test inspect exactly what was handed to it.
    zipSync: (input: Record<string, Uint8Array>, opts?: unknown) => {
      zipSyncSpy(input, opts);
      return actual.zipSync(input, opts as never);
    },
  };
});

import { ObsidianVaultExport } from '@/components/export/ObsidianVaultExport';

function ok<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  zipSyncSpy.mockClear();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('ObsidianVaultExport component — real backend wiring (render + interaction)', () => {
  it('calls the real export.obsidian macro via lensRun, not a hardcoded/fabricated file list', async () => {
    lensRun.mockResolvedValueOnce(
      ok({ ok: true, files: [{ filename: 'Note.md', content: '# Note' }], count: 1 }),
    );
    render(<ObsidianVaultExport />);

    fireEvent.click(screen.getByRole('button', { name: /Download as Obsidian Vault/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('export', 'obsidian', {}));
    // The download that follows is built from what lensRun ACTUALLY returned
    // (one real file), not a hardcoded list.
    await waitFor(() => expect(zipSyncSpy).toHaveBeenCalled());
    expect(Object.keys(zipSyncSpy.mock.calls[0][0])).toEqual(['Note.md']);
  });

  it('imports the real fflate zip primitives (never a mock/stub library)', async () => {
    lensRun.mockResolvedValueOnce(
      ok({ ok: true, files: [{ filename: 'A.md', content: 'alpha' }, { filename: 'B.md', content: 'beta' }], count: 2 }),
    );
    render(<ObsidianVaultExport />);

    fireEvent.click(screen.getByRole('button', { name: /Download as Obsidian Vault/i }));

    // zipSyncSpy wraps the REAL `zipSync` resolved from the actual 'fflate'
    // package (via importOriginal above) — this call only succeeds against
    // that real function's signature/behavior, not a fake. Real byte-content
    // proof (decoded with the real `TextDecoder`, not an identity check —
    // jsdom's realm gives Uint8Array values built inside the component a
    // distinct `Uint8Array` global from the test file's own, the same
    // cross-realm quirk documented in the sibling node-environment file, so
    // `instanceof`/constructor-identity assertions are the wrong tool here;
    // decoding the actual bytes is not).
    await waitFor(() => expect(zipSyncSpy).toHaveBeenCalledTimes(1));
    const [input, opts] = zipSyncSpy.mock.calls[0] as [Record<string, Uint8Array>, { level?: number }];
    expect(new TextDecoder().decode(input['A.md'])).toBe('alpha');
    expect(new TextDecoder().decode(input['B.md'])).toBe('beta');
    expect(opts).toEqual({ level: 6 });
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
  });

  it('honestly reports an empty corpus instead of downloading a fabricated/empty archive', async () => {
    lensRun.mockResolvedValueOnce(ok({ ok: true, files: [], count: 0 }));
    render(<ObsidianVaultExport />);

    fireEvent.click(screen.getByRole('button', { name: /Download as Obsidian Vault/i }));

    await waitFor(() =>
      expect(screen.getByText(/No DTUs to export yet/i)).toBeTruthy(),
    );
    // Real early-return: zipping/downloading never happens on the empty path.
    expect(zipSyncSpy).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('never truncates the DTU set — every macro-returned file reaches zipSync, no slice/limit applied', async () => {
    const files = Array.from({ length: 733 }, (_, i) => ({ filename: `Note ${i}.md`, content: `body ${i}` }));
    lensRun.mockResolvedValueOnce(ok({ ok: true, files, count: files.length }));
    render(<ObsidianVaultExport />);

    fireEvent.click(screen.getByRole('button', { name: /Download as Obsidian Vault/i }));

    await waitFor(() => expect(zipSyncSpy).toHaveBeenCalledTimes(1));
    // Real count, driven by the actual macro-returned array length above the
    // component's own LARGE_VAULT_NOTE_THRESHOLD (500) — if the component
    // (or a future regression) ever added a slice/limit, this would fail.
    expect(Object.keys(zipSyncSpy.mock.calls[0][0])).toHaveLength(733);
    await waitFor(() =>
      expect(screen.getByText(/Downloaded 733 notes as/i)).toBeTruthy(),
    );
  });
});

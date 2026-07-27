'use client';

/**
 * /lenses/vault — TheVault.
 *
 * A curated archive: open submission, closed admission. This page is the
 * PUBLIC surface — the wall you walk into and the cabinet of admitted records
 * standing on it. Submission and curation are separate surfaces; nothing here
 * can admit, decline, or reveal a decline, and nothing here needs to, because
 * the two public reads it uses (`vault.browse`, `vault.record`) hard-code
 * `status = 'admitted'` in the backend and accept no argument that could widen
 * them (`server/domains/vault.js`, invariant 3).
 *
 * ── The light island ──────────────────────────────────────────────────────
 * The platform shell is dark; museums, archives and paper are not. `LensShell`
 * is explicitly headless — no header, background, padding or min-height — so
 * this lens legitimately owns its entire visible surface, and it takes it: the
 * wall is warm cotton paper from the topbar down. The seam against the dark
 * chrome is deliberate rather than incidental — a brass hairline along the top
 * edge, so the island reads as a framed room you have stepped into rather than
 * as a light panel that failed to inherit the theme. This divergence is a
 * recorded exemption (`app/globals.css`, THEVAULT banner); it is not an
 * oversight for a later theming pass to "fix".
 *
 * ── Honest by construction ────────────────────────────────────────────────
 * Every value rendered on this page comes from a real macro. There is no seed
 * data, no sample record, no example creator, no invented count, and no
 * fallback roster — the archive opens empty and says so. The one substantial
 * body of authored copy (the six-axis rubric on the empty state) describes how
 * decisions are made; it stands in for no record.
 *
 * ── No vanity metrics ─────────────────────────────────────────────────────
 * Nothing here counts views, likes, plays or followers, and nothing is ordered
 * by popularity — the backend's order is `admitted_at DESC`, archival, and it
 * is used as given. The only numbers on the page are dates, identifiers, and
 * the drawer's position in the cabinet, which is a statement of PLACE (the
 * brief's "no infinite feed" rule) rather than a measure of attention.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { LensShell } from '@/components/lens/LensShell';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';

import { CuratorRoster } from '@/components/vault/CuratorRoster';
import { VaultCabinet, VaultCabinetError, VaultCabinetSkeleton } from '@/components/vault/VaultCabinet';
import { VaultEmptyState } from '@/components/vault/VaultEmptyState';
import { DISCIPLINE_KINDS, formatDiscipline } from '@/components/vault/format';
import type {
  VaultCabinetEntry,
  VaultCuratorShape,
  VaultLoadState,
  VaultRecordShape,
} from '@/components/vault/types';

/** Rendered beside the cabinet so the scoped commands are discoverable, not hidden. */
const KEY_HINTS = [
  { keys: 'J', label: 'Next drawer' },
  { keys: 'K', label: 'Previous drawer' },
  { keys: 'O', label: 'Open / close' },
  { keys: 'Esc', label: 'Close' },
] as const;

function VaultLens() {
  const searchParams = useSearchParams();

  const [browseState, setBrowseState] = useState<VaultLoadState>('loading');
  const [everLoaded, setEverLoaded] = useState(false);
  const [records, setRecords] = useState<VaultRecordShape[]>([]);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const [discipline, setDiscipline] = useState<string | null>(null);
  const [curatorFilter, setCuratorFilter] = useState<string | null>(null);

  const [curators, setCurators] = useState<VaultCuratorShape[]>([]);

  const [openId, setOpenId] = useState<string | null>(() => searchParams?.get('record') || null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  /**
   * A record reachable by permanent link but NOT in the current index — the
   * browse read is capped and narrowable, so a linked record can legitimately
   * sit outside it. This is the one place `vault.record` is genuinely needed:
   * re-reading a row we already hold would be theatre.
   */
  const [linkedEntry, setLinkedEntry] = useState<VaultCabinetEntry | null>(null);

  // ── vault.browse — the index ──────────────────────────────────────────────
  const browseSeq = useRef(0);
  const runBrowse = useCallback(async () => {
    const seq = ++browseSeq.current;
    setBrowseState('loading');
    setBrowseError(null);

    const input: Record<string, unknown> = {};
    if (discipline) input.workKind = discipline;
    if (curatorFilter) input.curatorId = curatorFilter;

    const r = await lensRun<{ records?: VaultRecordShape[]; count?: number }>('vault', 'browse', input);
    if (seq !== browseSeq.current) return; // a newer narrowing already superseded this one

    if (!r.data.ok || !r.data.result) {
      setRecords([]);
      setBrowseError(r.data.error);
      setBrowseState('error');
      return;
    }
    setRecords(Array.isArray(r.data.result.records) ? r.data.result.records : []);
    setBrowseState('ready');
    setEverLoaded(true);
  }, [discipline, curatorFilter]);

  useEffect(() => {
    void runBrowse();
  }, [runBrowse]);

  // ── vault.curators — who vouches for the archive ─────────────────────────
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await lensRun<{ curators?: VaultCuratorShape[] }>('vault', 'curators', {});
      if (!alive) return;
      if (r.data.ok && Array.isArray(r.data.result?.curators)) setCurators(r.data.result.curators);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── vault.record — a permanently-linked record outside the current index ──
  const fetchLinkedRecord = useCallback(async (id: string) => {
    setLinkedEntry({ id, record: null, state: 'loading', error: null });
    const r = await lensRun<{ record?: VaultRecordShape }>('vault', 'record', { submissionId: id });
    if (r.data.ok && r.data.result?.record) {
      setLinkedEntry({ id, record: r.data.result.record, state: 'ready', error: null });
    } else {
      setLinkedEntry({
        id,
        record: null,
        state: 'error',
        error: r.data.error || 'No admitted record answers to that identifier.',
      });
    }
  }, []);

  useEffect(() => {
    if (!openId || browseState !== 'ready') return;
    if (records.some((r) => r.id === openId)) {
      if (linkedEntry) setLinkedEntry(null);
      return;
    }
    if (linkedEntry && linkedEntry.id === openId) return; // already resolved, loading, or failed with a retry offered
    void fetchLinkedRecord(openId);
  }, [openId, browseState, records, linkedEntry, fetchLinkedRecord]);

  // ── the cabinet's drawers ────────────────────────────────────────────────
  const entries = useMemo<VaultCabinetEntry[]>(() => {
    const base: VaultCabinetEntry[] = records.map((r) => ({
      id: r.id,
      record: r,
      state: 'ready',
      error: null,
    }));
    if (linkedEntry && !records.some((r) => r.id === linkedEntry.id)) return [linkedEntry, ...base];
    return base;
  }, [records, linkedEntry]);

  /** A record is permanent, so its link is too — kept in the address bar without navigating. */
  const setOpen = useCallback((id: string | null) => {
    setOpenId(id);
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set('record', id);
      else url.searchParams.delete('record');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    } catch {
      /* address-bar sync is a convenience; never let it break the archive */
    }
  }, []);

  const handleToggle = useCallback(
    (id: string) => {
      setOpen(openId === id ? null : id);
      const i = entries.findIndex((e) => e.id === id);
      if (i >= 0) setSelectedIndex(i);
    },
    [openId, entries, setOpen],
  );

  const handleSelectCurator = useCallback((curatorId: string) => {
    setCuratorFilter((prev) => (prev === curatorId ? null : curatorId));
    setSelectedIndex(-1);
  }, []);

  const handleDiscipline = useCallback((kind: string) => {
    setDiscipline((prev) => (prev === kind ? null : kind));
    setSelectedIndex(-1);
  }, []);

  const clearFilters = useCallback(() => {
    setDiscipline(null);
    setCuratorFilter(null);
    setSelectedIndex(-1);
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      setSelectedIndex((prev) => {
        if (entries.length === 0) return -1;
        if (prev < 0) return delta > 0 ? 0 : entries.length - 1;
        return Math.min(entries.length - 1, Math.max(0, prev + delta));
      });
    },
    [entries.length],
  );

  const toggleSelected = useCallback(() => {
    const entry = entries[selectedIndex];
    if (entry) handleToggle(entry.id);
  }, [entries, selectedIndex, handleToggle]);

  useLensCommand(
    [
      { id: 'next-drawer', keys: 'j', description: 'Next drawer', action: () => moveSelection(1) },
      { id: 'prev-drawer', keys: 'k', description: 'Previous drawer', action: () => moveSelection(-1) },
      { id: 'toggle-drawer', keys: 'o', description: 'Open or close the selected drawer', action: toggleSelected },
      { id: 'close-drawer', keys: 'escape', description: 'Close the open drawer', action: () => setOpen(null) },
    ],
    { lensId: 'vault' },
  );

  const filtering = browseState === 'loading' && everLoaded;
  const filterActive = !!discipline || !!curatorFilter;
  const showFilters = browseState !== 'error' && (entries.length > 0 || filterActive || filtering);

  return (
    <LensShell lensId="vault">
      <div className={cn(vault.wall, 'border-t border-vault-brassLine')} data-testid="vault-wall">
        <div className="mx-auto max-w-5xl px-4 pb-24 pt-14 sm:px-8 sm:pt-20">
          {/* ── The wall plaque ─────────────────────────────────────────── */}
          <header className="vault-reveal">
            <p className={vault.label}>Curated archive</p>
            <h1 className={cn(vault.title, 'vault-letterpress-deep mt-4')}>TheVault</h1>
            <p className={cn(vault.body, 'mt-5 max-w-[54ch]')}>
              Creative work that deserves to outlive trends — preserved, contextualised, and admitted only
              when a named human curator has argued for it in writing.
            </p>

            {curators.length > 0 ? (
              <div className="mt-10">
                <CuratorRoster curators={curators} />
              </div>
            ) : null}

            <hr className={cn(vault.divider, 'mt-10')} />
          </header>

          {/* ── Narrowing. Archival axes only — discipline and curator. ──── */}
          {showFilters ? (
            <section aria-label="Narrow the archive" className="mt-8">
              <h2 className={vault.label}>Filed under</h2>
              <ul className="mt-4 flex list-none flex-wrap gap-2 p-0">
                {DISCIPLINE_KINDS.map((kind) => {
                  const active = discipline === kind;
                  return (
                    <li key={kind}>
                      <button
                        type="button"
                        onClick={() => handleDiscipline(kind)}
                        aria-pressed={active}
                        disabled={filtering}
                        className={cn(
                          'rounded-sm border px-3 py-1.5 font-sans text-sm transition-colors disabled:opacity-40',
                          active
                            ? 'border-vault-brass bg-vault-brass text-vault-paper'
                            : 'border-vault-rule bg-vault-card text-vault-graphite hover:border-vault-brassLine hover:text-vault-ink',
                        )}
                      >
                        {formatDiscipline(kind)}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {curatorFilter ? (
                <p className={cn(vault.caption, 'mt-4 flex flex-wrap items-baseline gap-3')}>
                  <span>Showing admissions by {curatorFilter}.</span>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="underline decoration-vault-brassLine underline-offset-4 transition-colors hover:text-vault-brass"
                  >
                    Show the whole archive
                  </button>
                </p>
              ) : null}
            </section>
          ) : null}

          {/* ── The cabinet ─────────────────────────────────────────────── */}
          <section aria-label="Admitted records" className="mt-10">
            {browseState === 'loading' && !everLoaded ? <VaultCabinetSkeleton /> : null}

            {browseState === 'error' ? (
              <VaultCabinetError message={browseError} onRetry={() => void runBrowse()} retrying={false} />
            ) : null}

            {browseState !== 'error' && (browseState === 'ready' || everLoaded) ? (
              entries.length === 0 ? (
                <VaultEmptyState
                  kind={filterActive ? 'filtered' : 'archive'}
                  filterLabel={discipline ? formatDiscipline(discipline) : null}
                  onClearFilter={filterActive ? clearFilters : undefined}
                />
              ) : (
                <div
                  aria-busy={filtering ? true : undefined}
                  className={cn('transition-opacity', filtering ? 'opacity-60' : 'opacity-100')}
                >
                  <VaultCabinet
                    entries={entries}
                    openId={openId}
                    selectedIndex={selectedIndex}
                    onToggle={handleToggle}
                    onRetryEntry={(id) => void fetchLinkedRecord(id)}
                    onSelectCurator={handleSelectCurator}
                    curatorFilter={curatorFilter}
                    shortcuts={KEY_HINTS}
                  />
                </div>
              )
            ) : null}
          </section>
        </div>
      </div>
    </LensShell>
  );
}

/** The paper is laid before anything is read, so the wall never flashes dark. */
function VaultWallFallback() {
  return (
    <div className={cn(vault.wall, 'border-t border-vault-brassLine')} aria-busy="true">
      <div className="mx-auto max-w-5xl px-4 pt-14 sm:px-8 sm:pt-20">
        <p className={vault.label}>Curated archive</p>
        <h1 className={cn(vault.title, 'vault-letterpress-deep mt-4')}>TheVault</h1>
      </div>
    </div>
  );
}

export default function VaultLensPage() {
  return (
    <Suspense fallback={<VaultWallFallback />}>
      <VaultLens />
    </Suspense>
  );
}

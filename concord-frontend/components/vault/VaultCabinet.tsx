'use client';

/**
 * THE CABINET — one continuous piece of furniture holding the drawers.
 *
 * This component exists so that a `VaultRecord` can be a drawer rather than a
 * card. The distinction is owned here, not there: the cabinet carries the ONE
 * plate, the ONE shadow, and the hairlines BETWEEN drawers, so records share
 * edges and read as compartments of a single object. A grid of per-record
 * shadows with gaps between them would be a card wall no matter how the
 * records themselves were styled.
 *
 * It also owns the sense of PLACE the brief requires in place of a feed: an
 * index rail states which drawer the keyboard cursor is on, out of how many
 * are in view. That is a position, not a metric — it counts drawers, never
 * attention. Nothing in the Vault ranks by popularity; the order here is the
 * backend's archival order (most recently admitted first, `admitted_at DESC`).
 *
 * Rendering states are real, not sentinels: the skeleton is shown while a real
 * `vault.browse` round trip is in flight, the alert carries the real error
 * string the macro returned, and the retry button re-dispatches the real call.
 */

import React from 'react';

import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';
import { VaultRecord } from './VaultRecord';
import type { VaultCabinetEntry } from './types';

/** Blank drawer faces shown while the register is being read. Structure only — no content, no names, no numbers. */
const SKELETON_FACES = [0, 1, 2];

export interface VaultCabinetProps {
  entries: VaultCabinetEntry[];
  openId: string | null;
  /** Index of the keyboard cursor within `entries`, or -1. */
  selectedIndex: number;
  onToggle: (id: string) => void;
  onRetryEntry?: (id: string) => void;
  onSelectCurator?: (curatorId: string) => void;
  curatorFilter?: string | null;
  /** Keyboard hints, rendered so the shortcuts are discoverable rather than hidden. */
  shortcuts?: ReadonlyArray<{ keys: string; label: string }>;
}

export function VaultCabinet({
  entries,
  openId,
  selectedIndex,
  onToggle,
  onRetryEntry,
  onSelectCurator,
  curatorFilter,
  shortcuts,
}: VaultCabinetProps) {
  return (
    <div data-testid="vault-cabinet">
      <div className="vault-plate overflow-hidden rounded-sm">
        <ol className="m-0 list-none divide-y divide-vault-rule p-0">
          {entries.map((entry, i) => (
            <VaultRecord
              key={entry.id}
              entry={entry}
              ordinal={i + 1}
              open={openId === entry.id}
              selected={selectedIndex === i}
              onToggle={() => onToggle(entry.id)}
              onRetry={onRetryEntry ? () => onRetryEntry(entry.id) : undefined}
              onSelectCurator={onSelectCurator}
              curatorFilter={curatorFilter}
            />
          ))}
        </ol>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <p className={vault.accession} data-testid="vault-cabinet-position">
          {selectedIndex >= 0
            ? `Drawer ${selectedIndex + 1} of ${entries.length}`
            : `${entries.length} ${entries.length === 1 ? 'drawer' : 'drawers'} in view`}
        </p>

        {shortcuts && shortcuts.length > 0 ? (
          <ul className="flex list-none flex-wrap items-baseline gap-x-5 gap-y-2 p-0">
            {shortcuts.map((s) => (
              <li key={s.keys} className="flex items-baseline gap-2">
                <kbd className="rounded-sm border border-vault-rule bg-vault-card px-1.5 py-0.5 font-sans text-[0.68rem] uppercase tracking-[0.08em] text-vault-graphite">
                  {s.keys}
                </kbd>
                <span className={vault.caption}>{s.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** Pending state for the whole cabinet — real, shown only while `vault.browse` is in flight. */
export function VaultCabinetSkeleton() {
  return (
    <div
      className="vault-plate overflow-hidden rounded-sm"
      aria-busy="true"
      aria-live="polite"
      data-testid="vault-cabinet-loading"
    >
      <p className={cn(vault.caption, 'px-4 pt-5 sm:px-8')}>Reading the register&hellip;</p>
      <div className="mt-4 divide-y divide-vault-rule">
        {SKELETON_FACES.map((k) => (
          <div key={k} className="px-4 py-6 sm:px-8">
            <div className="h-4 w-1/3 rounded-sm bg-vault-sunk" />
            <div className="mt-3 h-3 w-1/5 rounded-sm bg-vault-sunk" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface VaultCabinetErrorProps {
  message: string | null;
  onRetry: () => void;
  retrying?: boolean;
}

/** Failure state — the real macro error, and a retry that re-dispatches the real call. */
export function VaultCabinetError({ message, onRetry, retrying = false }: VaultCabinetErrorProps) {
  return (
    <div role="alert" className="vault-plate rounded-sm px-6 py-10 sm:px-10" data-testid="vault-cabinet-error">
      <p className={vault.label}>The register could not be read</p>
      <p className={cn(vault.bodySm, 'mt-3 max-w-[58ch]')}>
        {message || 'The archive did not answer. Nothing is shown rather than something unverified.'}
      </p>
      <button type="button" onClick={onRetry} disabled={retrying} className={cn(vault.button, 'mt-6')}>
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  );
}

export default VaultCabinet;

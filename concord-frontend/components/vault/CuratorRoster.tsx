'use client';

/**
 * Who vouches for this archive.
 *
 * A curated archive is only worth what its curators are worth, so the roster
 * is public and named — that is the point of `vault.curators` being an
 * unauthenticated read. Every row here comes from that macro; the component
 * has no fallback roster and renders NOTHING when the backend returns none,
 * which is exactly what it returns before a founding curator is installed.
 *
 * Retired curators stay on the roster, flagged. Their past admissions keep
 * their attribution permanently (the backend refuses to reassign it), so
 * quietly dropping them from the roster would orphan real records.
 */

import React from 'react';

import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';
import { formatCuratorRole } from './format';
import type { VaultCuratorShape } from './types';

export interface CuratorRosterProps {
  curators: VaultCuratorShape[];
}

export function CuratorRoster({ curators }: CuratorRosterProps) {
  const rows = Array.isArray(curators) ? curators.filter((c) => c && c.display_name) : [];
  if (rows.length === 0) return null;

  return (
    <div data-testid="vault-curator-roster">
      <h2 className={vault.label}>Curated by</h2>
      <ul className="mt-3 flex list-none flex-wrap gap-x-8 gap-y-2 p-0">
        {rows.map((c) => {
          const role = formatCuratorRole(c.role);
          const retired = !c.active;
          return (
            <li key={c.curator_id} className="flex items-baseline gap-2">
              <span className={cn(vault.attribution, retired ? 'text-vault-gray' : 'text-vault-ink')}>
                {c.display_name}
              </span>
              {role ? <span className={vault.caption}>{role}</span> : null}
              {retired ? <span className={cn(vault.caption, 'italic')}>retired</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default CuratorRoster;

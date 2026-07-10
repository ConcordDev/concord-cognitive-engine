'use client';

/**
 * CaseFileHistory — the caller's own deduction / verdict history.
 *
 * Renders `detective.mine` (server/lib/detective.js `getDeductionsByUser`,
 * reading the `trial_records` table). This was the one macro in the
 * domain with NO frontend caller before this rebuild — a real player's
 * case history existed in the database with nothing showing it back to
 * them. `sentence_data` is a JSON string of `{ correctCount }`; verdict
 * is the two literal values the backend ever writes ('guilty' | 'pending').
 */

import React, { useMemo } from 'react';
import { Gavel, Clock3 } from 'lucide-react';
import { DataTable, EmptyState, type DataTableColumn } from '@/components/ui';
import { statusToken, type StatusKind } from '@/lib/design-system';
import { formatRelativeTime } from '@/lib/utils';

export interface DeductionRecord {
  id: string;
  crime_id: string;
  suspect_id: string | null;
  verdict: string | null;
  sentence_data: string | null;
  processed_at: number;
}

function parseCorrectCount(sentenceData: string | null): number | null {
  if (!sentenceData) return null;
  try {
    const parsed = JSON.parse(sentenceData);
    return typeof parsed?.correctCount === 'number' ? parsed.correctCount : null;
  } catch {
    return null;
  }
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  const kind: StatusKind = verdict === 'guilty' ? 'success' : 'pending';
  const token = statusToken(kind);
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize"
      style={{ ...token.bgStyle, ...token.textStyle }}
    >
      <Gavel className="h-3 w-3" aria-hidden="true" />
      {verdict || 'pending'}
    </span>
  );
}

export interface CaseFileHistoryProps {
  deductions: DeductionRecord[];
  onSelectCase: (crimeId: string) => void;
}

export function CaseFileHistory({ deductions, onSelectCase }: CaseFileHistoryProps) {
  const columns = useMemo<DataTableColumn<DeductionRecord>[]>(() => [
    {
      id: 'crime',
      header: 'Case',
      accessor: (r) => <span className="font-mono text-[11px]">{r.crime_id}</span>,
      sortValue: (r) => r.crime_id,
      sortable: true,
      monospace: true,
    },
    {
      id: 'suspect',
      header: 'Suspect named',
      accessor: (r) => r.suspect_id || '—',
      sortValue: (r) => r.suspect_id || '',
      sortable: true,
    },
    {
      id: 'verdict',
      header: 'Verdict',
      accessor: (r) => <VerdictBadge verdict={r.verdict} />,
      sortValue: (r) => r.verdict || '',
      sortable: true,
    },
    {
      id: 'facts',
      header: 'Facts',
      accessor: (r) => {
        const n = parseCorrectCount(r.sentence_data);
        return n === null ? '—' : `${n}/3`;
      },
      sortValue: (r) => parseCorrectCount(r.sentence_data) ?? -1,
      sortable: true,
      align: 'right',
    },
    {
      id: 'when',
      header: 'When',
      accessor: (r) => (
        <span className="inline-flex items-center gap-1 text-slate-400">
          <Clock3 className="h-3 w-3" aria-hidden="true" />
          {formatRelativeTime(r.processed_at * 1000)}
        </span>
      ),
      sortValue: (r) => r.processed_at,
      sortable: true,
      align: 'right',
    },
  ], []);

  if (deductions.length === 0) {
    return (
      <EmptyState
        icon={<Gavel className="h-8 w-8" />}
        title="No deductions filed yet."
        description="Submit a suspect, weapon, and motive on an open case and it lands here — solved or not."
        compact
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      rows={deductions}
      getRowId={(r) => r.id}
      onRowClick={(r) => onSelectCase(r.crime_id)}
      onRowActivate={(r) => onSelectCase(r.crime_id)}
      density="compact"
      caption="Your deduction history"
      maxHeight="420px"
    />
  );
}

export default CaseFileHistory;

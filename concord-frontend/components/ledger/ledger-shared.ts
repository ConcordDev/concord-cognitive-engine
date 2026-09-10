// Ledger lens — shared types + export helpers. Extracted from ledger/page.tsx.

export interface ManagedParity {
  kind?: string;
  funder: string;
  fundsBothSidesOf: string[];
  detail: string;
}

export interface Lien {
  kind?: string;
  creditor: string;
  debtor: { kind: string; id: string };
  amount?: number;
  collateral: { kind?: string; id: string } | null;
  dueAt?: number;
  detail: string;
}

export interface Anomalies {
  ok?: boolean;
  reason?: string;
  worldId?: string;
  managedParity?: ManagedParity[];
  extractionLiens?: Lien[];
  total?: number;
}

export interface FactionEconomy {
  ok?: boolean;
  reason?: string;
  factionId?: string;
  treasury?: number | null;
  fundedBy?: string[];
  liensAgainst?: { creditor_id: string; amount?: number; collateral_id?: string | null }[];
}

export interface FlowSummaryRow { type: string; n: number; total: number }
export interface FlowSummary { ok?: boolean; reason?: string; byType?: FlowSummaryRow[] }

export function toCsv(parity: ManagedParity[], liens: Lien[]): string {
  const rows: string[] = ['stream,actor,counterparty,amount,detail'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const p of parity) {
    rows.push(['managed_parity', esc(p.funder), esc((p.fundsBothSidesOf || []).join(' & ')), '', esc(p.detail)].join(','));
  }
  for (const l of liens) {
    rows.push(['extraction_lien', esc(l.creditor), esc(l.debtor?.id), esc(l.amount ?? ''), esc(l.detail)].join(','));
  }
  return rows.join('\n');
}

export function download(filename: string, text: string, mime: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

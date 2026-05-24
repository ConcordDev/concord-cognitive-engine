'use client';

/**
 * InventoryReportBuilder — GHG-Protocol / CDP-style inventory report.
 *
 * Calls environment.inventory-report to generate a structured, citable
 * emissions inventory from the user's real logged activities: per-scope
 * line items with EPA factor sources, a summary block, and one-click
 * JSON + CSV export. Nothing is hardcoded — empty inventories say so.
 */

import { useCallback, useState } from 'react';
import { FileText, Loader2, Download, FileJson, ChevronDown, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LineItem {
  date: string;
  factorKey: string;
  amount: number;
  unit: string;
  co2eTonnes: number;
  facility: string | null;
  category: string | null;
  factorSource: string;
  verificationStatus: string;
}

interface ScopeSection {
  scope: number;
  totalTonnes: number;
  lineItemCount: number;
  lineItems: LineItem[];
}

interface Report {
  framework: string;
  organization: string;
  reportingYear: string;
  generatedAt: string;
  methodology: string;
  boundary: string;
  scopes: { scope1: ScopeSection; scope2: ScopeSection; scope3: ScopeSection };
  summary: {
    grossEmissionsTonnes: number;
    scope1Tonnes: number;
    scope2Tonnes: number;
    scope3Tonnes: number;
    retiredOffsetsTonnes: number;
    netEmissionsTonnes: number;
    recsRetiredMwh: number;
    totalLineItems: number;
    verifiedLineItems: number;
    verifiedPct: number;
    activeTargets: Array<{ name: string; targetYear: number; reductionPct: number }>;
  };
}

const FRAMEWORKS = ['GHG_Protocol', 'CDP', 'GRI', 'CSRD'] as const;
type Framework = (typeof FRAMEWORKS)[number];

export function InventoryReportBuilder() {
  const [framework, setFramework] = useState<Framework>('GHG_Protocol');
  const [organization, setOrganization] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(1);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('environment', 'inventory-report', {
        framework,
        organization,
        year,
      });
      if (r.data?.ok) setReport((r.data.result as { report: Report }).report);
    } catch (e) {
      console.error('[InventoryReport] failed', e);
    } finally {
      setLoading(false);
    }
  }, [framework, organization, year]);

  function exportJson() {
    if (!report) return;
    download(
      JSON.stringify(report, null, 2),
      `${report.framework}-inventory-${report.reportingYear}.json`,
      'application/json',
    );
  }

  function exportCsv() {
    if (!report) return;
    const header = [
      'scope',
      'date',
      'factorKey',
      'amount',
      'unit',
      'co2eTonnes',
      'facility',
      'category',
      'verificationStatus',
      'factorSource',
    ];
    const allItems = [
      ...report.scopes.scope1.lineItems,
      ...report.scopes.scope2.lineItems,
      ...report.scopes.scope3.lineItems,
    ];
    const rows = allItems.map((li) => {
      const scope = report.scopes.scope1.lineItems.includes(li)
        ? 1
        : report.scopes.scope2.lineItems.includes(li)
          ? 2
          : 3;
      return [
        scope,
        li.date,
        li.factorKey,
        li.amount,
        li.unit,
        li.co2eTonnes,
        li.facility || '',
        li.category || '',
        li.verificationStatus,
        li.factorSource,
      ];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    download(csv, `${report.framework}-inventory-${report.reportingYear}.csv`, 'text/csv');
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          GHG inventory report
        </span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-2 md:grid-cols-4 gap-2">
        <select
          value={framework}
          onChange={(e) => setFramework(e.target.value as Framework)}
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          {FRAMEWORKS.map((f) => (
            <option key={f} value={f}>
              {f.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          placeholder="Organization name"
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Year"
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button
          onClick={generate}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <FileText className="w-3 h-3" />
          )}
          Generate
        </button>
      </div>

      {!report ? (
        <div className="px-4 py-12 text-center text-xs text-gray-400">
          <FileText className="w-7 h-7 mx-auto mb-2 opacity-30" />
          No report generated yet. Pick a framework and year, then Generate.
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Summary header */}
          <div className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.04] p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-white">
                {report.organization}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                {report.framework.replace(/_/g, ' ')} · {report.reportingYear}
              </span>
            </div>
            <div className="text-[10px] text-gray-400">
              Boundary: {report.boundary} · Generated{' '}
              {new Date(report.generatedAt).toLocaleString()}
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">{report.methodology}</div>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <SummaryTile label="Scope 1" value={`${report.summary.scope1Tonnes.toFixed(1)} t`} tone="rose" />
            <SummaryTile label="Scope 2" value={`${report.summary.scope2Tonnes.toFixed(1)} t`} tone="amber" />
            <SummaryTile label="Scope 3" value={`${report.summary.scope3Tonnes.toFixed(1)} t`} tone="cyan" />
            <SummaryTile label="Gross total" value={`${report.summary.grossEmissionsTonnes.toFixed(1)} t`} tone="emerald" />
            <SummaryTile label="Retired offsets" value={`${report.summary.retiredOffsetsTonnes.toFixed(1)} t`} tone="amber" />
            <SummaryTile label="Net emissions" value={`${report.summary.netEmissionsTonnes.toFixed(1)} t`} tone="emerald" />
            <SummaryTile label="RECs retired" value={`${report.summary.recsRetiredMwh.toFixed(0)} MWh`} tone="cyan" />
            <SummaryTile
              label="Verified"
              value={`${report.summary.verifiedPct}% (${report.summary.verifiedLineItems}/${report.summary.totalLineItems})`}
              tone="emerald"
            />
          </div>

          {report.summary.activeTargets.length > 0 && (
            <div className="rounded-md border border-white/10 bg-white/[0.02] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                Active reduction targets
              </div>
              <ul className="space-y-0.5">
                {report.summary.activeTargets.map((t) => (
                  <li key={t.name} className="text-xs text-gray-300">
                    {t.name} — {t.reductionPct}% by {t.targetYear}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Scope sections */}
          {[report.scopes.scope1, report.scopes.scope2, report.scopes.scope3].map(
            (sec) => (
              <div
                key={sec.scope}
                className="rounded-md border border-white/10 overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(expanded === sec.scope ? null : sec.scope)}
                  className="w-full px-3 py-2 flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.05]"
                >
                  {expanded === sec.scope ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  )}
                  <span className="text-xs font-semibold text-white">
                    Scope {sec.scope}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {sec.lineItemCount} line item{sec.lineItemCount === 1 ? '' : 's'}
                  </span>
                  <span className="ml-auto text-xs font-mono tabular-nums text-emerald-300">
                    {sec.totalTonnes.toFixed(2)} t
                  </span>
                </button>
                {expanded === sec.scope && (
                  <div className="max-h-72 overflow-y-auto">
                    {sec.lineItems.length === 0 ? (
                      <div className="px-3 py-6 text-center text-xs text-gray-400">
                        No Scope {sec.scope} activities for {report.reportingYear}.
                      </div>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead className="text-gray-400 border-b border-white/5">
                          <tr>
                            <th className="text-left px-3 py-1 font-normal">Date</th>
                            <th className="text-left px-2 py-1 font-normal">Factor</th>
                            <th className="text-right px-2 py-1 font-normal">Amount</th>
                            <th className="text-right px-2 py-1 font-normal">tCO₂e</th>
                            <th className="text-left px-2 py-1 font-normal">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {sec.lineItems.map((li, i) => (
                            <tr key={i} className="hover:bg-white/[0.02]">
                              <td className="px-3 py-1 font-mono text-gray-400">
                                {li.date}
                              </td>
                              <td className="px-2 py-1 text-gray-300">
                                {li.factorKey.replace(/_/g, ' ')}
                                {li.facility ? (
                                  <span className="text-gray-600">
                                    {' '}
                                    · {li.facility}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-2 py-1 text-right font-mono text-gray-400">
                                {li.amount.toLocaleString()} {li.unit}
                              </td>
                              <td className="px-2 py-1 text-right font-mono text-emerald-300">
                                {li.co2eTonnes.toFixed(2)}
                              </td>
                              <td className="px-2 py-1">
                                <span
                                  className={cn(
                                    'text-[9px] px-1 py-0.5 rounded',
                                    li.verificationStatus === 'verified'
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : li.verificationStatus === 'rejected'
                                        ? 'bg-rose-500/15 text-rose-300'
                                        : 'bg-white/5 text-gray-400',
                                  )}
                                >
                                  {li.verificationStatus}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ),
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={exportJson}
              className="px-3 py-1.5 text-xs rounded bg-white/5 text-cyan-300 hover:bg-white/10 inline-flex items-center gap-1"
            >
              <FileJson className="w-3 h-3" /> Export JSON
            </button>
            <button
              onClick={exportCsv}
              className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1"
            >
              <Download className="w-3 h-3" /> Export CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'rose' | 'amber' | 'cyan' | 'emerald';
}) {
  const colour =
    tone === 'rose'
      ? 'text-rose-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : tone === 'cyan'
          ? 'text-cyan-300'
          : 'text-emerald-300';
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-2">
      <div className="text-[9px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('text-sm font-mono font-bold tabular-nums', colour)}>{value}</div>
    </div>
  );
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default InventoryReportBuilder;

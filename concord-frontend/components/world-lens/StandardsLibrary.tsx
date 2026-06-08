'use client';

import React, { useState, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
//
// NOTE: There is no backend engineering-standards reference library or
// DTU-compliance-checker macro in the platform today (no `standards` /
// `compliance` domain exists under server/domains/). This panel therefore
// renders an honest empty state rather than fabricated standards data.
// TODO: wire to backend once a `standards.*` / compliance-check macro exists.

interface StandardRule {
  section: string;
  title: string;
  enforcement: 'mandatory' | 'advisory' | 'conditional';
}

interface Standard {
  id: string;
  code: string;
  name: string;
  issuingBody: string;
  category: string;
  ruleCount: number;
  jurisdictions: string[];
  effectiveDate: string;
  rules: StandardRule[];
}

const CATEGORIES = [
  'All',
  'Building Code',
  'Structural',
  'Fire',
  'Seismic',
  'Wind',
  'Plumbing',
  'Electrical',
  'Mechanical',
  'Energy',
  'Accessibility',
];

interface DtuRef {
  id: string;
  name: string;
}

interface ComplianceResult {
  section: string;
  title: string;
  status: 'pass' | 'warning' | 'fail';
  expected: string;
  actual: string;
}

// No backend standards/compliance source — honest empty state, never fabricated.
const STANDARDS: Standard[] = [];
const DTUS: DtuRef[] = [];
const COMPLIANCE: ComplianceResult[] = [];

// ── Helpers ────────────────────────────────────────────────────────────────────

function enforcementBadge(level: string): { text: string; cls: string } {
  if (level === 'mandatory') return { text: 'Mandatory', cls: 'text-red-400 bg-red-400/10 border-red-400/20' };
  if (level === 'advisory') return { text: 'Advisory', cls: 'text-blue-400 bg-blue-400/10 border-blue-400/20' };
  return { text: 'Conditional', cls: 'text-amber-400 bg-amber-400/10 border-amber-400/20' };
}

function complianceStatusBadge(status: string): { text: string; cls: string } {
  if (status === 'pass') return { text: 'PASS', cls: 'text-green-400 bg-green-400/10 border-green-400/20' };
  if (status === 'warning') return { text: 'WARNING', cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' };
  return { text: 'FAIL', cls: 'text-red-400 bg-red-400/10 border-red-400/20' };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function StandardsLibrary() {
  const [tab, setTab] = useState<'browse' | 'compliance'>('browse');

  // Browse state
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [expandedStandard, setExpandedStandard] = useState<string | null>(null);

  // Compliance state
  const [selectedDtu, setSelectedDtu] = useState(DTUS[0]?.id ?? '');
  const [selectedStandard, setSelectedStandard] = useState(STANDARDS[0]?.id ?? '');
  const [complianceRun, setComplianceRun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [pdfGenerated, setPdfGenerated] = useState(false);

  const filteredStandards = useMemo(() => {
    return STANDARDS.filter((s) => {
      const matchesSearch =
        !search ||
        s.code.toLowerCase().includes(search.toLowerCase()) ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.issuingBody.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === 'All' || s.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [search, categoryFilter]);

  const overallCompliance = useMemo(() => {
    const hasFail = COMPLIANCE.some((r) => r.status === 'fail');
    const hasWarning = COMPLIANCE.some((r) => r.status === 'warning');
    if (hasFail) return { label: 'NON-COMPLIANT', cls: 'bg-red-500/20 border-red-500/40 text-red-400' };
    if (hasWarning) return { label: 'COMPLIANT WITH WARNINGS', cls: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400' };
    return { label: 'COMPLIANT', cls: 'bg-green-500/20 border-green-500/40 text-green-400' };
  }, []);

  const handleRunCompliance = () => {
    // No backend compliance-check macro exists; without real standards + DTU
    // data there is nothing to check. Surface the honest empty state below.
    // TODO: wire to backend once a compliance-check macro exists.
    setComplianceRun(true);
    setPdfGenerated(false);
  };

  const handleGeneratePdf = () => {
    setPdfGenerated(true);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full min-h-screen bg-black/80 backdrop-blur-xl text-white p-6">
      <h1 className="text-2xl font-bold mb-1">Standards Library</h1>
      <p className="text-sm text-gray-400 mb-6">Engineering standards reference and compliance checker</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['browse', 'compliance'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white/10 text-white border border-white/20' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t === 'browse' ? 'Browse Standards' : 'Compliance Check'}
          </button>
        ))}
      </div>

      {/* ── Browse Tab ────────────────────────────────────────────────────── */}
      {tab === 'browse' && (
        <div className="space-y-4">
          {/* Search & filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search standards by code, name, or issuer..."
              className="flex-1 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Standards list */}
          {filteredStandards.length === 0 && (
            <p className="text-sm text-gray-400 italic py-8 text-center">
              {STANDARDS.length === 0
                ? 'No standards library connected yet.'
                : 'No standards match your search.'}
            </p>
          )}

          <div className="space-y-3">
            {filteredStandards.map((std) => {
              const isExpanded = expandedStandard === std.id;
              return (
                <div
                  key={std.id}
                  className="border border-white/10 rounded-xl bg-white/5 overflow-hidden"
                >
                  <div
                    className="p-4 cursor-pointer hover:bg-white/[0.03] transition-colors"
                    onClick={() => setExpandedStandard(isExpanded ? null : std.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-bold px-2 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 whitespace-nowrap">
                          {std.code}
                        </span>
                        <div>
                          <h3 className="text-sm font-semibold">{std.name}</h3>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {std.issuingBody} &middot; {std.category} &middot; {std.ruleCount} rules
                          </p>
                        </div>
                      </div>
                      <span className="text-gray-400 text-xs mt-1">{isExpanded ? '[-]' : '[+]'}</span>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      {std.jurisdictions.map((j) => (
                        <span
                          key={j}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400"
                        >
                          {j}
                        </span>
                      ))}
                      <span className="text-[10px] text-gray-400 ml-auto">
                        Effective: {std.effectiveDate}
                      </span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-white/10 p-4 space-y-2 bg-white/[0.02]">
                      <span className="text-[10px] uppercase tracking-wider text-gray-400">Sample Rules</span>
                      {std.rules.map((rule, i) => {
                        const badge = enforcementBadge(rule.enforcement);
                        return (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="text-gray-400 font-mono whitespace-nowrap">{rule.section}</span>
                            <span className="text-gray-300 flex-1 truncate">{rule.title}</span>
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${badge.cls}`}
                            >
                              {badge.text}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Compliance Check Tab ──────────────────────────────────────────── */}
      {tab === 'compliance' && (
        <div className="max-w-2xl space-y-6">
          {/* Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">DTU</label>
              <select
                value={selectedDtu}
                onChange={(e) => {
                  setSelectedDtu(e.target.value);
                  setComplianceRun(false);
                  setPdfGenerated(false);
                }}
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              >
                {DTUS.length === 0 && <option value="">No DTUs available</option>}
                {DTUS.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Standard</label>
              <select
                value={selectedStandard}
                onChange={(e) => {
                  setSelectedStandard(e.target.value);
                  setComplianceRun(false);
                  setPdfGenerated(false);
                }}
                className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              >
                {STANDARDS.length === 0 && <option value="">No standards available</option>}
                {STANDARDS.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleRunCompliance}
            disabled={isRunning || STANDARDS.length === 0 || DTUS.length === 0}
            className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning ? 'Running Compliance Check...' : 'Run Compliance Check'}
          </button>

          {/* Results */}
          {complianceRun && COMPLIANCE.length === 0 && (
            <p className="text-sm text-gray-400 italic py-8 text-center">
              No compliance data — connect a standards library and DTU source to run a real check.
            </p>
          )}
          {complianceRun && COMPLIANCE.length > 0 && (
            <div className="space-y-4">
              {/* Overall banner */}
              <div
                className={`rounded-xl border p-4 text-center text-lg font-bold ${overallCompliance.cls}`}
              >
                {overallCompliance.label}
              </div>

              {/* Section-by-section results */}
              <div className="border border-white/10 rounded-xl bg-white/5 overflow-hidden">
                <div className="p-3 border-b border-white/10">
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Section-by-Section Results</span>
                </div>
                <div className="divide-y divide-white/5">
                  {COMPLIANCE.map((result, i) => {
                    const badge = complianceStatusBadge(result.status);
                    return (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 text-xs">
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${badge.cls}`}
                        >
                          {badge.text}
                        </span>
                        <span className="text-gray-400 font-mono whitespace-nowrap">{result.section}</span>
                        <span className="text-gray-300 flex-1 truncate">{result.title}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Parameter comparison table */}
              <div className="border border-white/10 rounded-xl bg-white/5 overflow-hidden">
                <div className="p-3 border-b border-white/10">
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Parameter Comparison</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-white/5">
                      <th className="text-left px-4 py-2 font-medium">Section</th>
                      <th className="text-left px-4 py-2 font-medium">Parameter</th>
                      <th className="text-left px-4 py-2 font-medium">Expected</th>
                      <th className="text-left px-4 py-2 font-medium">Actual</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {COMPLIANCE.map((result, i) => {
                      const badge = complianceStatusBadge(result.status);
                      return (
                        <tr key={i}>
                          <td className="px-4 py-2 font-mono text-gray-400">{result.section}</td>
                          <td className="px-4 py-2 text-gray-300">{result.title}</td>
                          <td className="px-4 py-2 text-gray-400">{result.expected}</td>
                          <td className="px-4 py-2 text-white font-medium">{result.actual}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${badge.cls}`}
                            >
                              {badge.text}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Generate PDF */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleGeneratePdf}
                  disabled={pdfGenerated}
                  className="px-5 py-2.5 rounded-lg border border-white/10 text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-50 transition-colors"
                >
                  {pdfGenerated ? 'PDF Report Generated' : 'Generate PDF Report'}
                </button>
                {pdfGenerated && (
                  <span className="text-xs text-green-400">compliance-report-{DTUS.find((d) => d.id === selectedDtu)?.name.replace(/\s+/g, '-').toLowerCase()}.pdf</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

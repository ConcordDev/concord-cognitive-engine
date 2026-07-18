'use client';

/**
 * CourtProcedureReference — state civil-procedure rule pointers.
 *
 * Track D (CURATION, reclassified from DATA-SOURCING — see
 * docs/lens-specs/legal-capability-map.md's "No cross-jurisdiction
 * state-specific court rules" finding). A small, authored, cited
 * reference set of real state rules of civil procedure (service of
 * process / time-to-answer / summary judgment) for a representative
 * subset of states — NOT full 50-state coverage, and NOT legal advice.
 * Backed by legal.procedure-reference / legal.procedure-reference-states-list
 * (server/domains/legal.js, content/court-procedure-reference.json).
 */

import { useEffect, useState } from 'react';
import { Gavel, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface StateSummary { state: string; stateCode: string; rulesBody?: string }
interface ProcedureRule { topic: string; citation: string; summary: string }
interface ProcedureResult {
  covered: boolean;
  state?: string;
  stateCode?: string;
  rulesBody?: string;
  source?: string;
  rules?: ProcedureRule[];
  message?: string;
  statesCovered: StateSummary[];
  representativeSubset: boolean;
  disclaimer: string;
}

async function run(name: string, params: Record<string, unknown> = {}) {
  const r = await lensRun('legal', name, params);
  return r.data;
}

export function CourtProcedureReference() {
  const [states, setStates] = useState<StateSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<ProcedureResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await run('procedure-reference-states-list');
      if (r?.ok) {
        const list: StateSummary[] = r.result.statesCovered || [];
        setStates(list);
        if (list.length > 0) setSelected(list[0].stateCode);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      setBusy(true);
      const r = await run('procedure-reference', { state: selected });
      setBusy(false);
      if (r?.ok) setResult(r.result);
    })();
  }, [selected]);

  return (
    <section className="rounded-xl border border-lattice-border bg-black/20 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Gavel className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-gray-100">Court Procedure Reference</h3>
      </div>
      <p className="mb-3 text-xs text-gray-400">
        Service-of-process, time-to-answer, and summary-judgment pointers for a <strong>representative
        subset</strong> of states — not full 50-state coverage, and not a substitute for reading the
        current rule text.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="procedure-state-select" className="text-xs text-gray-400">State</label>
        <select
          id="procedure-state-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border border-lattice-border bg-black/30 px-2 py-1 text-xs text-gray-100"
        >
          {states.length === 0 && <option value="">Loading…</option>}
          {states.map((s) => (
            <option key={s.stateCode} value={s.stateCode}>{s.state} ({s.stateCode})</option>
          ))}
        </select>
        {busy && <span className="text-[10px] text-gray-500">Looking up…</span>}
      </div>

      {result && (
        result.covered ? (
          <div className="space-y-2">
            <div>
              <div className="text-sm font-semibold text-gray-100">{result.state} — {result.rulesBody}</div>
              <div className="text-[10px] text-gray-500">{result.source}</div>
            </div>
            <ul className="space-y-2">
              {(result.rules || []).map((rule, i) => (
                <li key={i} className="rounded border border-lattice-border bg-black/20 p-2">
                  <div className="text-xs font-semibold text-gray-200">{rule.topic}</div>
                  <div className="font-mono text-[10px] text-cyan-300">{rule.citation}</div>
                  <div className="mt-1 text-xs text-gray-400">{rule.summary}</div>
                </li>
              ))}
            </ul>
            <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{result.disclaimer}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs italic text-gray-400">{result.message}</p>
            <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{result.disclaimer}</span>
            </div>
          </div>
        )
      )}
    </section>
  );
}

export default CourtProcedureReference;

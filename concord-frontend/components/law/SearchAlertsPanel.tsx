'use client';

/**
 * SearchAlertsPanel — saved search alerts for case-law (CourtListener
 * opinion search) and docket (CourtListener RECAP Archive) queries. Closes
 * docs/WAVE4_INVENTORY.md row 219 / law-capability-map.md's "GENUINELY
 * MISSING — no persistence/notification substrate for saved searches" gap.
 * Wires law.search-alert-add / -list / -remove / -check.
 *
 * HONESTY, read before changing the copy below: there is NO background
 * scheduler and NO push/email delivery for this lens. An alert is checked
 * ONLY when the user clicks "Check now" here — see the comment above
 * `law.search-alert-add` in server/domains/law.js for the full reasoning.
 * Never word this panel as if results arrive automatically.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, Plus, Loader2, Trash2, RefreshCw, AlertCircle, Gavel, FolderSearch } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type AlertType = 'case_law' | 'docket';

interface AlertRow {
  id: string;
  query: string;
  alertType: AlertType;
  label: string;
  court: string | null;
  checkInterval: string;
  lastCheckedAt: string | null;
  neverChecked: boolean;
  hoursSinceLastCheck: number | null;
  lastCheckTotalResults: number | null;
  seenResultCount: number;
  checkCount: number;
}

interface CheckResult {
  alertId: string;
  alertType: AlertType;
  query: string;
  newResults: Array<{ id?: number; docketId?: number; caseName?: string | null; absoluteUrl?: string | null }>;
  newCount: number;
  totalResults: number;
  totalHits: number | null;
  checkedAt: string;
  firstCheck: boolean;
}

const TYPE_LABEL: Record<AlertType, string> = {
  case_law: 'Case law (CourtListener opinions)',
  docket: 'Docket / filings (RECAP Archive)',
};

export function SearchAlertsPanel() {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ query: '', alertType: 'case_law' as AlertType, label: '', court: '' });
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const [checkResults, setCheckResults] = useState<Record<string, CheckResult>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('law', 'search-alert-list', {});
    setLoading(false);
    if (r.data?.ok) { setAlerts((r.data.result as { alerts: AlertRow[] }).alerts); setListErr(null); }
    else { setListErr(r.data?.error || 'Could not load search alerts.'); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addAlert() {
    const query = form.query.trim();
    if (!query) { setAddErr('A search query is required.'); return; }
    setAdding(true); setAddErr(null);
    const r = await lensRun('law', 'search-alert-add', {
      query,
      alertType: form.alertType,
      label: form.label.trim() || undefined,
      court: form.court.trim() || undefined,
    });
    setAdding(false);
    if (r.data?.ok) {
      setShowAdd(false);
      setForm({ query: '', alertType: 'case_law', label: '', court: '' });
      await load();
    } else {
      setAddErr(r.data?.error || 'Could not create alert.');
    }
  }

  async function checkNow(id: string) {
    setCheckingId(id);
    setCheckErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
    const r = await lensRun('law', 'search-alert-check', { id });
    setCheckingId(null);
    if (r.data?.ok) {
      setCheckResults((prev) => ({ ...prev, [id]: r.data.result as CheckResult }));
      await load();
    } else {
      // Honest failure surfaced verbatim — never rendered as "0 new results".
      setCheckErrors((prev) => ({ ...prev, [id]: r.data?.error || 'Check failed.' }));
    }
  }

  async function remove(id: string) {
    await lensRun('law', 'search-alert-remove', { id });
    setCheckResults((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setCheckErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
    await load();
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="w-4 h-4 text-amber-300" />
        <h2 className="font-semibold text-white">Saved Search Alerts</h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="ml-auto px-2.5 py-1 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />Save a search
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        Checked on demand only — click &quot;Check now&quot; on an alert to re-run its search. There is no
        automatic background checking and no push/email notification; nothing arrives on its own.
      </p>

      {showAdd && (
        <div className="bg-black/40 border border-amber-500/20 rounded-lg p-3 mb-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={form.query}
              onChange={(e) => setForm({ ...form, query: e.target.value })}
              placeholder="Search terms (e.g. qualified immunity, or a citation)"
              className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white"
            />
            <select
              value={form.alertType}
              onChange={(e) => setForm({ ...form, alertType: e.target.value as AlertType })}
              className="bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white"
            >
              <option value="case_law">Case law</option>
              <option value="docket">Docket / filings</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Label (optional)"
              className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white"
            />
            <input
              value={form.court}
              onChange={(e) => setForm({ ...form, court: e.target.value })}
              placeholder="Court code (optional, e.g. scotus)"
              className="w-44 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white"
            />
            <button
              onClick={addAlert}
              disabled={adding}
              className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold disabled:opacity-50 inline-flex items-center gap-1"
            >
              {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
            </button>
          </div>
          {addErr && <p className="text-xs text-rose-400">{addErr}</p>}
        </div>
      )}

      {loading && (
        <p className="text-xs text-gray-400 italic py-4 text-center inline-flex items-center gap-1.5 justify-center w-full">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading alerts…
        </p>
      )}

      {!loading && listErr && (
        <p className="text-xs text-rose-400 py-3 text-center inline-flex items-center gap-1.5 justify-center w-full">
          <AlertCircle className="w-3.5 h-3.5" />{listErr}
        </p>
      )}

      {!loading && !listErr && (!alerts || alerts.length === 0) && (
        <p className="text-xs text-gray-400 italic py-4 text-center">
          No saved search alerts yet. Save a case-law or docket search above to track new results over time.
        </p>
      )}

      {!loading && !listErr && alerts && alerts.length > 0 && (
        <ul className="space-y-1.5">
          {alerts.map((a) => {
            const result = checkResults[a.id];
            const error = checkErrors[a.id];
            const busy = checkingId === a.id;
            return (
              <li key={a.id} className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  {a.alertType === 'docket' ? (
                    <FolderSearch className="w-3.5 h-3.5 text-neon-cyan shrink-0" />
                  ) : (
                    <Gavel className="w-3.5 h-3.5 text-neon-purple shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white truncate">{a.label}</p>
                    <p className="text-[9px] text-gray-400 truncate">
                      {TYPE_LABEL[a.alertType]} · &quot;{a.query}&quot;{a.court ? ` · court: ${a.court}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => void checkNow(a.id)}
                    disabled={busy}
                    className="px-2 py-1 text-[10px] rounded bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 disabled:opacity-50 inline-flex items-center gap-1 shrink-0"
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Check now
                  </button>
                  <button
                    onClick={() => void remove(a.id)}
                    className="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 shrink-0"
                    title="Remove alert"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="mt-1 pl-5 text-[9px] text-gray-500">
                  {a.neverChecked
                    ? 'Never checked yet.'
                    : `Last checked ${a.hoursSinceLastCheck === 0 ? 'just now' : `${a.hoursSinceLastCheck}h ago`} · ${a.lastCheckTotalResults ?? 0} result${a.lastCheckTotalResults === 1 ? '' : 's'} on file`}
                </div>

                {error && (
                  <div className="mt-1.5 pl-5 flex items-center gap-1.5 text-[10px] text-rose-400">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Check failed: {error}
                  </div>
                )}

                {result && !error && (
                  <div className={cn('mt-1.5 pl-5 text-[10px]', result.newCount > 0 ? 'text-amber-300' : 'text-gray-400')}>
                    {result.newCount > 0 ? (
                      <>
                        <p className="font-semibold">
                          {result.newCount} new result{result.newCount === 1 ? '' : 's'}
                          {result.firstCheck ? ' (first check — everything found is new)' : ' since last check'}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {result.newResults.slice(0, 5).map((item, i) => (
                            <li key={item.id ?? item.docketId ?? i} className="truncate">
                              {item.caseName || `Result ${item.id ?? item.docketId ?? i + 1}`}
                            </li>
                          ))}
                          {result.newResults.length > 5 && (
                            <li className="text-gray-500">…and {result.newResults.length - 5} more.</li>
                          )}
                        </ul>
                      </>
                    ) : (
                      <p>No new results since the last check ({result.totalResults} total fetched).</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

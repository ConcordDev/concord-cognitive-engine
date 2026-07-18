'use client';

/**
 * SentinelResearchAccess — the Tier 2 "Research Access" workflow over the
 * `intel.research.*` macro family (docs/lens-specs/sentinel-capability-map.md
 * — this was completely unsurfaced: submit -> await governance approval ->
 * pull tiered data). Sibling to SentinelIntel (which wires the PUBLIC Tier 1
 * `intel.<domain>` feeds); this component wires the governance-controlled
 * RESEARCH tier: research.apply / research.status / research.data /
 * research.synthesis / research.archive, plus research.review for the
 * (rare, role-gated) governance reviewer.
 *
 * Identity + list-by-researcher honesty notes (read before touching this file):
 *   - researcherId is ALWAYS derived server-side from the caller's own
 *     identity (server/server.js `_intelResearcherId(ctx)`); nothing here
 *     sends a researcherId — the server ignores it even if we did.
 *   - There is no backend "list my applications" macro (the underlying
 *     research-partition state in server/lib/foundation-intelligence.js
 *     only supports lookup BY applicationId, not enumeration by
 *     researcher). So "my applications" here is this browser's own record
 *     of applicationIds it has submitted (localStorage), each one
 *     re-verified against the live research.status macro on every render —
 *     never a client-side guess at status. Losing localStorage (different
 *     browser/device, cleared storage) means losing track of an
 *     application's id unless the "Track an application by ID" field is
 *     used to re-add it.
 *   - The review affordance is deliberately NOT a fabricated admin panel.
 *     There is no "list pending applications" export either, so a reviewer
 *     (owner/admin/founder role only — see useAuth().user.role) can approve
 *     or deny a SPECIFIC application by id (e.g. relayed to them by the
 *     applicant), never browse a queue that doesn't exist server-side. The
 *     section only renders for a session whose real, server-issued role is
 *     one of the governance roles; a non-reviewer never sees it.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import {
  FlaskConical, Loader2, Send, CheckCircle2, XCircle, Clock, Gavel, Search, Info,
} from 'lucide-react';

interface ResearchApplication {
  id: string;
  researcherId: string;
  institution: string;
  purpose: string;
  requestedCategories: string[];
  status: 'pending' | 'approved' | 'denied' | string;
  submitted: string;
  reviewed: string | null;
  reviewedBy: string | null;
  decision: string | null;
}

interface TrackedEntry {
  applicationId: string;
  application: ResearchApplication | null;
  error: string | null;
  loading: boolean;
}

const STORAGE_KEY = 'concord:sentinel:researchApplicationIds';

function loadTrackedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveTrackedIds(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // best-effort; loss of persistence just means this browser forgets its own application ids
  }
}

const GOVERNANCE_ROLES = new Set(['owner', 'admin', 'founder']);
const DATA_MACROS = [
  { key: 'research.data', label: 'Data' },
  { key: 'research.synthesis', label: 'Synthesis' },
  { key: 'research.archive', label: 'Archive' },
] as const;

export function SentinelResearchAccess({ onChanged }: { onChanged?: () => void }) {
  const { user, isAuthenticated } = useAuth();
  // Client-side check is a UX honesty gate only — it decides whether to even
  // show the review affordance, never a substitute for the server-side
  // in-handler role check on intel.research.review (see server.js).
  const isReviewer = isAuthenticated && !!user?.role && GOVERNANCE_ROLES.has(user.role);

  // -- Categories (fetched, never hardcoded, so this never drifts from the
  //    server's real RESEARCH_CATEGORIES list) --
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await lensRun('intel', 'classifier.status', {});
      const cats = (r.data?.result as { researchCategories?: string[] } | null)?.researchCategories;
      setCategories(Array.isArray(cats) ? cats : []);
      setCategoriesLoading(false);
    })();
  }, []);

  // -- Apply form --
  const [institution, setInstitution] = useState('');
  const [purpose, setPurpose] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  // -- Tracked applications --
  const [tracked, setTracked] = useState<TrackedEntry[]>([]);
  const [manualId, setManualId] = useState('');

  const refreshOne = useCallback(async (applicationId: string): Promise<TrackedEntry> => {
    const r = await lensRun('intel', 'research.status', { applicationId });
    // intel.research.status's real return shape is { ok, application } (no
    // top-level `.result` field of its own), so after the client's lensRun
    // unwrap, r.data.result IS that { ok, application } object — the
    // application record sits one level under `.application`, not at
    // r.data.result directly.
    const app = r.data?.ok
      ? (r.data.result as { application?: ResearchApplication } | null)?.application ?? null
      : null;
    if (app) {
      return { applicationId, application: app, error: null, loading: false };
    }
    return { applicationId, application: null, error: r.data?.error || 'lookup failed', loading: false };
  }, []);

  const refreshAll = useCallback(async () => {
    const ids = loadTrackedIds();
    setTracked(ids.map((applicationId) => ({ applicationId, application: null, error: null, loading: true })));
    const results = await Promise.all(ids.map(refreshOne));
    setTracked(results);
  }, [refreshOne]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  async function submitApplication() {
    if (!institution.trim() || !purpose.trim()) return;
    setApplying(true);
    setApplyError(null);
    const r = await lensRun('intel', 'research.apply', {
      institution: institution.trim(),
      purpose: purpose.trim(),
      categories: selectedCategories,
    });
    if (r.data?.ok && (r.data.result as { applicationId?: string } | null)?.applicationId) {
      const applicationId = (r.data.result as { applicationId: string }).applicationId;
      const ids = loadTrackedIds();
      if (!ids.includes(applicationId)) {
        saveTrackedIds([applicationId, ...ids]);
      }
      setInstitution('');
      setPurpose('');
      setSelectedCategories([]);
      await refreshAll();
      onChanged?.();
    } else {
      setApplyError(r.data?.error || 'application failed');
    }
    setApplying(false);
  }

  function trackManualId() {
    const id = manualId.trim();
    if (!id) return;
    const ids = loadTrackedIds();
    if (!ids.includes(id)) saveTrackedIds([id, ...ids]);
    setManualId('');
    refreshAll();
  }

  function untrack(applicationId: string) {
    saveTrackedIds(loadTrackedIds().filter((x) => x !== applicationId));
    setTracked((prev) => prev.filter((t) => t.applicationId !== applicationId));
  }

  // -- Approved-tier data pulls --
  const approvedIds = tracked
    .filter((t) => t.application?.status === 'approved')
    .map((t) => t.applicationId);
  const [dataResults, setDataResults] = useState<Record<string, unknown>>({});
  const [dataLoading, setDataLoading] = useState<string | null>(null);

  async function pullData(macroKey: (typeof DATA_MACROS)[number]['key']) {
    setDataLoading(macroKey);
    const r = await lensRun('intel', macroKey, {});
    setDataResults((prev) => ({
      ...prev,
      [macroKey]: r.data?.ok === false ? { error: r.data.error } : (r.data?.result ?? r.data),
    }));
    setDataLoading(null);
  }

  // -- Governance review (role-gated; see module doc comment) --
  const [reviewId, setReviewId] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewResult, setReviewResult] = useState<string | null>(null);

  async function review(approved: boolean) {
    const applicationId = reviewId.trim();
    if (!applicationId) return;
    setReviewBusy(true);
    setReviewResult(null);
    const r = await lensRun('intel', 'research.review', { applicationId, approved });
    setReviewResult(
      r.data?.ok
        ? `${applicationId}: ${(r.data.result as { status?: string } | null)?.status || 'reviewed'}`
        : r.data?.error || 'review failed',
    );
    setReviewBusy(false);
    await refreshAll();
    onChanged?.();
  }

  return (
    <div className="space-y-5">
      {/* Apply */}
      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-blue-200">
          <FlaskConical className="h-4 w-4" /> Apply for Tier 2 research access
        </h3>
        <p className="mb-3 text-[11px] text-blue-700">
          Governance-controlled. Applications start pending and require an owner/admin/founder
          reviewer to approve before Tier 2 data becomes reachable.
        </p>
        <div className="space-y-2">
          <input
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="Institution…"
            className="w-full rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
            aria-label="Institution"
          />
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Research purpose…"
            rows={2}
            className="w-full rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
            aria-label="Purpose"
          />
          <div>
            <span className="text-[10px] uppercase tracking-wider text-blue-700">Categories</span>
            {categoriesLoading ? (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-blue-600">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading categories…
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    aria-pressed={selectedCategories.includes(cat)}
                    className={`rounded px-2 py-1 text-[10px] ${
                      selectedCategories.includes(cat)
                        ? 'bg-blue-700/40 text-blue-100'
                        : 'bg-blue-950/30 text-blue-500 hover:text-blue-300'
                    }`}
                  >
                    {cat.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            disabled={applying || !institution.trim() || !purpose.trim()}
            onClick={submitApplication}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Submit application
          </button>
          {applyError && <p className="text-[11px] text-rose-400">{applyError}</p>}
        </div>
      </div>

      {/* Status tracking */}
      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
          <Clock className="h-4 w-4" /> My applications
        </h3>
        <div className="mb-3 flex gap-2">
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="Track an application by ID…"
            className="flex-1 rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
            aria-label="Application ID to track"
          />
          <button
            onClick={trackManualId}
            className="inline-flex items-center gap-1 rounded bg-blue-950/40 px-2 py-1.5 text-[11px] text-blue-300 hover:text-blue-100"
          >
            <Search className="h-3.5 w-3.5" /> Track
          </button>
        </div>
        {tracked.length === 0 ? (
          <p className="rounded border border-blue-900/30 bg-blue-950/10 px-4 py-6 text-center text-xs text-blue-600">
            No applications tracked in this browser yet. Submit one above.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {tracked.map((t) => (
              <li key={t.applicationId} className="rounded border border-blue-900/30 bg-blue-950/10 px-3 py-2 text-xs">
                {t.loading ? (
                  <span className="flex items-center gap-1.5 text-blue-600">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                  </span>
                ) : t.application ? (
                  <div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={t.application.status} />
                      <span className="truncate text-blue-200">{t.application.institution}</span>
                      <button
                        onClick={() => untrack(t.applicationId)}
                        className="ml-auto text-[10px] text-blue-700 hover:text-rose-400"
                      >
                        Stop tracking
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-blue-700">
                      <span className="font-mono">{t.applicationId}</span>
                      <span>{t.application.purpose}</span>
                      {t.application.reviewedBy && <span>reviewed by {t.application.reviewedBy}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-blue-600">
                    <span className="font-mono">{t.applicationId}</span>
                    <span className="text-rose-400">{t.error}</span>
                    <button
                      onClick={() => untrack(t.applicationId)}
                      className="ml-auto text-[10px] text-blue-700 hover:text-rose-400"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Approved-tier data access */}
      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
          <FlaskConical className="h-4 w-4" /> Tier 2 data access
        </h3>
        {approvedIds.length === 0 ? (
          <p className="rounded border border-blue-900/30 bg-blue-950/10 px-4 py-6 text-center text-xs text-blue-600">
            No approved application yet — Tier 2 data stays unreachable until governance approves
            one of your applications above.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {DATA_MACROS.map(({ key, label }) => (
                <button
                  key={key}
                  disabled={dataLoading === key}
                  onClick={() => pullData(key)}
                  className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  {dataLoading === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Fetch {label}
                </button>
              ))}
            </div>
            {DATA_MACROS.map(({ key, label }) => dataResults[key] != null && (
              <div key={key} className="mb-2">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-blue-700">{label}</p>
                <pre className="max-h-72 overflow-auto rounded border border-blue-900/40 bg-black/60 p-3 font-mono text-[11px] text-blue-300">
                  {JSON.stringify(dataResults[key], null, 2)}
                </pre>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Governance review — role-gated, no fake admin panel (see module doc comment) */}
      {isReviewer && (
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-amber-200">
            <Gavel className="h-4 w-4" /> Governance review
          </h3>
          <p className="mb-3 flex items-start gap-1.5 text-[11px] text-amber-700">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            There is no pending-applications queue on the backend to browse — review by the
            application ID the applicant gives you.
          </p>
          <div className="flex gap-2">
            <input
              value={reviewId}
              onChange={(e) => setReviewId(e.target.value)}
              placeholder="Application ID…"
              className="flex-1 rounded border border-amber-900/40 bg-black/40 px-2 py-1.5 text-xs text-amber-100 focus:border-amber-500 focus:outline-none"
              aria-label="Application ID to review"
            />
            <button
              disabled={reviewBusy || !reviewId.trim()}
              onClick={() => review(true)}
              className="inline-flex items-center gap-1 rounded bg-emerald-700/60 px-2 py-1.5 text-[11px] text-emerald-100 hover:bg-emerald-700/80 disabled:opacity-40"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              disabled={reviewBusy || !reviewId.trim()}
              onClick={() => review(false)}
              className="inline-flex items-center gap-1 rounded bg-rose-800/60 px-2 py-1.5 text-[11px] text-rose-100 hover:bg-rose-800/80 disabled:opacity-40"
            >
              <XCircle className="h-3.5 w-3.5" /> Deny
            </button>
          </div>
          {reviewResult && <p className="mt-2 text-[11px] text-amber-300">{reviewResult}</p>}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[9px] uppercase text-emerald-200">
        <CheckCircle2 className="h-2.5 w-2.5" /> Approved
      </span>
    );
  }
  if (status === 'denied') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-1.5 py-0.5 text-[9px] uppercase text-rose-200">
        <XCircle className="h-2.5 w-2.5" /> Denied
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-900/40 px-1.5 py-0.5 text-[9px] uppercase text-amber-200">
      <Clock className="h-2.5 w-2.5" /> Pending
    </span>
  );
}

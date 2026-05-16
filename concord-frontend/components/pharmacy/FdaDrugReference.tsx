'use client';

/**
 * FdaDrugReference — bespoke FDA drug reference UX for the pharmacy lens.
 *
 * Built per category-leader research (Epocrates / UpToDate / DailyMed /
 * Drugs.com / Medscape):
 *
 *   • Single-field search (brand+generic unified, no toggle)
 *   • Boxed Warning pinned ABOVE the tab strip — never tab-switched
 *   • Three sub-tabs: Label · Adverse · Interactions
 *       Label → FDA section accordion (Indications expanded by default)
 *       Adverse → recharts horizontal bar chart of top FAERS reactions
 *       Interactions → severity-ranked card stack + summary strip
 *   • Save-as-DTU at every result tier (drug card, adverse snapshot,
 *     interaction pair) with `source: "openfda"` provenance
 *
 * Backed by three real OpenFDA-backed macros:
 *   pharmacy.drug-label        — drug-label.json + openfda metadata
 *   pharmacy.adverse-events    — FAERS reactioncount aggregation
 *   pharmacy.drugInteractionCheck — cross-mention scan of two SPL labels
 *
 * All three are free (240 req/min/IP). For higher quota the user can set
 * OPENFDA_API_KEY in server env — UI is identical either way.
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Pill,
  Activity,
  ShieldAlert,
  Search,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  X,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

type SubTab = 'label' | 'adverse' | 'interactions';

interface DrugLabel {
  query: string;
  genericName: string | null;
  brandName: string | null;
  manufacturer: string | null;
  productType: string | null;
  route: string | null;
  rxOtc: string | null;
  indications: string | null;
  dosageAndAdministration: string | null;
  warnings: string | null;
  contraindications: string | null;
  adverseReactions: string | null;
  drugInteractions: string | null;
  mechanismOfAction: string | null;
  pregnancyCategory: string | null;
  spIDsetId?: string;
  source: string;
}

interface AdverseEvents {
  drug: string;
  reportCount: number;
  topReactions: Array<{ term: string; count: number }>;
  source: string;
  disclaimer: string;
  note?: string;
}

interface InteractionRow {
  name: string;
  found: boolean;
  genericName: string | null;
  brandName: string | null;
  manufacturer: string | null;
  drugInteractionsText: string | null;
}

interface InteractionResult {
  medicationsChecked: number;
  interactionsFound: number;
  severity?: string;
  interactions?: Array<{ drug1: string; drug2: string; severity: string; effect: string }>;
  drugs?: InteractionRow[];
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('pharmacy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  // The /api/lens/run dispatch wraps macro result under { ok:true, result }
  // — but the macro itself ALSO returns { ok, result } or { ok:false, error }.
  // So we unwrap one level if both are envelopes.
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const FDA_SECTION_LABELS: Array<{ key: keyof DrugLabel; label: string; defaultOpen?: boolean; tone?: 'caution' | 'normal' }> = [
  { key: 'indications', label: 'Indications & Usage', defaultOpen: true },
  { key: 'dosageAndAdministration', label: 'Dosage & Administration', defaultOpen: true },
  { key: 'contraindications', label: 'Contraindications', tone: 'caution' },
  { key: 'adverseReactions', label: 'Adverse Reactions' },
  { key: 'drugInteractions', label: 'Drug Interactions' },
  { key: 'mechanismOfAction', label: 'Mechanism of Action' },
  { key: 'pregnancyCategory', label: 'Use in Pregnancy' },
];

function looksLikeBoxedWarning(warnings: string | null): boolean {
  if (!warnings) return false;
  return /BOXED WARNING|BLACK BOX|WARNING:.*\n/i.test(warnings.slice(0, 800));
}

export function FdaDrugReference() {
  const [searchInput, setSearchInput] = useState('');
  const [drug, setDrug] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SubTab>('label');
  const [label, setLabel] = useState<DrugLabel | null>(null);
  const [adverse, setAdverse] = useState<AdverseEvents | null>(null);
  const [interactions, setInteractions] = useState<InteractionResult | null>(null);
  const [secondDrugInput, setSecondDrugInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelQuery = useMutation({
    mutationFn: async (q: string) => callMacro<DrugLabel>('drug-label', { drug: q }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setLabel(env.result); setErrorMsg(null); }
      else { setLabel(null); setErrorMsg(env.error || 'No FDA label found'); }
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const adverseQuery = useMutation({
    mutationFn: async (q: string) => callMacro<AdverseEvents>('adverse-events', { drug: q }),
    onSuccess: (env) => { if (env.ok && env.result) setAdverse(env.result); },
  });

  const interactionMutation = useMutation({
    mutationFn: async (drugs: string[]) =>
      callMacro<InteractionResult>('drugInteractionCheck', { medications: drugs }),
    onSuccess: (env) => { if (env.ok && env.result) setInteractions(env.result); },
  });

  // When the user picks a new drug, refresh both the label and the adverse-events feed.
  useEffect(() => {
    if (!drug) return;
    labelQuery.mutate(drug);
    adverseQuery.mutate(drug);
    setInteractions(null);
    setSecondDrugInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate is stable
  }, [drug]);

  const submitSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setDrug(q);
    setActiveTab('label');
  };

  const runInteractionCheck = () => {
    if (!drug || !secondDrugInput.trim()) return;
    interactionMutation.mutate([drug, secondDrugInput.trim()]);
  };

  const reset = () => {
    setDrug(null); setLabel(null); setAdverse(null); setInteractions(null);
    setSearchInput(''); setSecondDrugInput(''); setErrorMsg(null);
    inputRef.current?.focus();
  };

  const isBoxed = looksLikeBoxedWarning(label?.warnings ?? null);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Pill className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">FDA Drug Reference</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            openfda · 50,000+ labels
          </span>
        </div>
        {drug && (
          <button
            type="button"
            onClick={reset}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            New search
          </button>
        )}
      </header>

      <form onSubmit={submitSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Brand or generic name — aspirin, lipitor, atorvastatin, warfarin…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={!searchInput.trim() || labelQuery.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {labelQuery.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Lookup
        </button>
      </form>

      {errorMsg && !label && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {!label && !labelQuery.isPending && !errorMsg && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/50 px-3 py-8 text-center text-xs text-zinc-500">
          Search any FDA-approved drug to pull the label, post-market adverse events,
          and interaction signals — all live from the FDA OpenFDA API.
        </div>
      )}

      {label && (
        <motion.div
          key={drug}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          {/* Drug header card */}
          <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-white">
                    {label.brandName || label.genericName || drug}
                  </h3>
                  {label.rxOtc && (
                    <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-cyan-300">
                      {label.rxOtc}
                    </span>
                  )}
                </div>
                {label.genericName && label.brandName && label.brandName !== label.genericName && (
                  <p className="text-xs text-zinc-400">
                    Generic: <span className="font-mono">{label.genericName}</span>
                  </p>
                )}
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {label.manufacturer && <>Mfg: {label.manufacturer}</>}
                  {label.manufacturer && label.route && <> · </>}
                  {label.route && <>Route: {label.route}</>}
                </p>
              </div>
              <SaveAsDtuButton
                apiSource="openfda"
                apiUrl="https://api.fda.gov/drug/label.json"
                title={`${label.brandName || label.genericName || drug} — FDA Drug Label`}
                content={[
                  `Generic: ${label.genericName ?? '—'} · Brand: ${label.brandName ?? '—'}`,
                  label.manufacturer ? `Manufacturer: ${label.manufacturer}` : '',
                  label.indications ? `INDICATIONS\n${label.indications.slice(0, 1000)}` : '',
                  label.warnings ? `WARNINGS\n${label.warnings.slice(0, 800)}` : '',
                ].filter(Boolean).join('\n\n')}
                extraTags={['pharmacy', 'drug-label', 'fda', (label.genericName || drug || '').toLowerCase()]}
                rawData={label}
              />
            </div>
          </div>

          {/* Boxed Warning — pinned ABOVE the tab strip */}
          {isBoxed && (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative overflow-hidden rounded-lg border-2 border-red-500 bg-red-950/40 p-3"
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-red-500" />
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-red-300">
                    Boxed Warning
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-red-100/90">
                    {(label.warnings || '').slice(0, 800)}
                    {(label.warnings || '').length > 800 && (
                      <span className="text-red-400/70"> …(continues in Warnings section)</span>
                    )}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Sub-tab strip */}
          <div className="flex gap-1 border-b border-zinc-800">
            {([
              { id: 'label' as const, label: 'Label', icon: FileText },
              { id: 'adverse' as const, label: 'Adverse Events', icon: Activity },
              { id: 'interactions' as const, label: 'Interactions', icon: ShieldAlert },
            ]).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  activeTab === t.id
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'label' && (
              <motion.div
                key="label"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="space-y-1.5"
              >
                {FDA_SECTION_LABELS.map((sec) => {
                  const value = label[sec.key] as string | null | undefined;
                  if (!value) return null;
                  return <FdaSection key={sec.key as string} label={sec.label} body={value} defaultOpen={sec.defaultOpen} tone={sec.tone} />;
                })}
              </motion.div>
            )}

            {activeTab === 'adverse' && (
              <motion.div
                key="adverse"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                <AdverseEventsPanel
                  drug={drug || ''}
                  data={adverse}
                  isLoading={adverseQuery.isPending}
                  reload={() => drug && adverseQuery.mutate(drug)}
                />
              </motion.div>
            )}

            {activeTab === 'interactions' && (
              <motion.div
                key="interactions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                <InteractionsPanel
                  drug={drug || ''}
                  secondDrugInput={secondDrugInput}
                  setSecondDrugInput={setSecondDrugInput}
                  onRun={runInteractionCheck}
                  isPending={interactionMutation.isPending}
                  result={interactions}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

// ── FDA section accordion ─────────────────────────────────────────────────

function FdaSection({ label, body, defaultOpen, tone }: { label: string; body: string; defaultOpen?: boolean; tone?: 'caution' | 'normal' }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const border = tone === 'caution' ? 'border-amber-500/20' : 'border-zinc-800';
  const labelColor = tone === 'caution' ? 'text-amber-300' : 'text-zinc-300';
  return (
    <div className={`overflow-hidden rounded-md border ${border} bg-zinc-950/40`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-zinc-900/60"
      >
        <span className={`flex items-center gap-1.5 ${labelColor}`}>
          {tone === 'caution' && <AlertTriangle className="h-3 w-3" />}
          {label}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <p className="whitespace-pre-wrap border-t border-zinc-800 px-3 py-2.5 text-xs leading-relaxed text-zinc-300">
              {body}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Adverse Events ────────────────────────────────────────────────────────

function AdverseEventsPanel({ drug, data, isLoading, reload }: { drug: string; data: AdverseEvents | null; isLoading: boolean; reload: () => void }) {
  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading FAERS reports…
      </div>
    );
  }
  if (!data || (data.reportCount === 0 && (!data.topReactions || data.topReactions.length === 0))) {
    return (
      <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-500">
        No FAERS adverse-event reports indexed for &quot;{drug}&quot;.
        <button onClick={reload} className="ml-2 text-cyan-400 hover:underline">Retry</button>
      </div>
    );
  }

  const top = data.topReactions.slice(0, 10);
  const max = Math.max(...top.map((r) => r.count)) || 1;
  const chartData = top.map((r) => ({ ...r, intensity: r.count / max }));

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-md border border-cyan-500/15 bg-cyan-500/5 px-3 py-2">
        <div className="text-xs text-zinc-300">
          <span className="font-semibold text-cyan-300">{data.reportCount.toLocaleString()}</span> FAERS reports
          {data.topReactions.length > 0 && (
            <> · top reaction: <span className="text-amber-300">{data.topReactions[0]?.term}</span> ({data.topReactions[0]?.count})</>
          )}
        </div>
        <SaveAsDtuButton
          compact
          apiSource="openfda"
          apiUrl="https://api.fda.gov/drug/event.json"
          title={`${drug} — FAERS adverse events (top ${top.length})`}
          content={[
            `Reports indexed: ${data.reportCount.toLocaleString()}`,
            '',
            'Top reactions:',
            ...top.map((r) => `  ${r.term} — ${r.count}`),
            '',
            data.disclaimer,
          ].join('\n')}
          extraTags={['pharmacy', 'adverse-events', 'faers', drug.toLowerCase()]}
          rawData={data}
        />
      </div>

      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
              <YAxis dataKey="term" type="category" width={140} tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(34,211,238,0.06)' }}
                contentStyle={{ background: '#0a0a0a', border: '1px solid #27272a', borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: '#e4e4e7' }}
                itemStyle={{ color: '#67e8f9' }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {chartData.map((entry, i) => {
                  const t = entry.intensity;
                  // yellow → orange → red gradient by intensity (severity proxy)
                  const color = t > 0.66 ? '#ef4444' : t > 0.33 ? '#f97316' : '#eab308';
                  return <Cell key={i} fill={color} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] italic text-zinc-500">
          {data.disclaimer}
        </p>
      </div>
    </>
  );
}

// ── Interactions ──────────────────────────────────────────────────────────

function InteractionsPanel({
  drug, secondDrugInput, setSecondDrugInput, onRun, isPending, result,
}: {
  drug: string;
  secondDrugInput: string;
  setSecondDrugInput: (v: string) => void;
  onRun: () => void;
  isPending: boolean;
  result: InteractionResult | null;
}) {
  const interactions = result?.interactions || [];
  const counts = {
    major: interactions.filter((i) => i.severity === 'critical' || i.severity === 'major' || i.severity === 'high').length,
    moderate: interactions.filter((i) => i.severity === 'moderate').length,
    minor: interactions.filter((i) => i.severity === 'minor' || i.severity === 'low').length,
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1 rounded bg-cyan-500/15 px-2 py-1 font-mono text-cyan-300">
            <Pill className="h-3 w-3" /> {drug}
          </span>
          <Plus className="h-3 w-3 text-zinc-500" />
          <input
            type="text"
            value={secondDrugInput}
            onChange={(e) => setSecondDrugInput(e.target.value)}
            placeholder="second drug — e.g. warfarin"
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRun(); } }}
          />
          <button
            type="button"
            onClick={onRun}
            disabled={!secondDrugInput.trim() || isPending}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" />}
            Check
          </button>
        </div>
        {result && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-medium text-red-300">
              {counts.major} major
            </span>
            <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 font-medium text-orange-300">
              {counts.moderate} moderate
            </span>
            <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 font-medium text-yellow-300">
              {counts.minor} minor
            </span>
          </div>
        )}
      </div>

      {!result && (
        <p className="text-center text-xs text-zinc-500">
          Add a second drug above and press <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono">Check</kbd> — Concord cross-scans both
          FDA SPL labels for known interaction mentions.
        </p>
      )}

      {result && result.interactionsFound === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/25 bg-green-500/5 px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 text-green-400" />
          <div className="flex-1 text-xs text-green-200">
            No interaction mentions found between <span className="font-mono">{drug}</span> and{' '}
            <span className="font-mono">{secondDrugInput}</span> in their FDA labels.
          </div>
          <span className="text-[10px] text-zinc-500">absence of data is not proof of safety</span>
        </div>
      )}

      {result && interactions.length > 0 && (
        <div className="space-y-2">
          {interactions
            .slice()
            .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
            .map((ix, i) => <InteractionCard key={i} ix={ix} />)}
        </div>
      )}
    </div>
  );
}

function severityRank(s: string): number {
  if (s === 'critical' || s === 'contraindicated') return 4;
  if (s === 'major' || s === 'high') return 3;
  if (s === 'moderate') return 2;
  if (s === 'minor' || s === 'low') return 1;
  return 0;
}

function InteractionCard({ ix }: { ix: { drug1: string; drug2: string; severity: string; effect: string } }) {
  const sev = ix.severity;
  const border =
    sev === 'critical' || sev === 'contraindicated' ? 'border-l-red-600 bg-red-500/5' :
    sev === 'major' || sev === 'high' ? 'border-l-red-500 bg-red-500/5' :
    sev === 'moderate' ? 'border-l-orange-500 bg-orange-500/5' :
    sev === 'minor' || sev === 'low' ? 'border-l-yellow-500 bg-yellow-500/5' :
    'border-l-zinc-500 bg-zinc-500/5';
  const sevTextColor =
    sev === 'critical' || sev === 'contraindicated' || sev === 'major' || sev === 'high' ? 'text-red-300' :
    sev === 'moderate' ? 'text-orange-300' :
    sev === 'minor' || sev === 'low' ? 'text-yellow-300' : 'text-zinc-400';

  return (
    <div className={`flex items-start gap-3 rounded-md border border-zinc-800 border-l-4 ${border} p-3`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-white">{ix.drug1}</span>
          <X className="h-3 w-3 text-zinc-500" />
          <span className="font-mono text-white">{ix.drug2}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${sevTextColor}`}>
            {sev}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{ix.effect}</p>
      </div>
      <SaveAsDtuButton
        compact
        apiSource="openfda"
        apiUrl="https://api.fda.gov/drug/label.json"
        title={`Interaction: ${ix.drug1} + ${ix.drug2}`}
        content={`Severity: ${sev}\n\n${ix.effect}`}
        extraTags={['pharmacy', 'drug-interaction', sev, ix.drug1.toLowerCase(), ix.drug2.toLowerCase()]}
        rawData={ix}
      />
    </div>
  );
}

// Tiny external-link helper for the FDA SPL page (useful for citation)
export function FdaLabelLink({ setId }: { setId?: string }) {
  if (!setId) return null;
  return (
    <a
      href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
    >
      <ExternalLink className="h-3 w-3" /> DailyMed SPL
    </a>
  );
}

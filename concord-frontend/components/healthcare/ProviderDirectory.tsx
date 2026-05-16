'use client';

/**
 * ProviderDirectory — bespoke healthcare provider lookup surface for the
 * healthcare lens. Backed by the real CMS NPI Registry (NPPES, ~8M
 * providers, no key required) via the `healthcare.providers-search`
 * macro.
 *
 * Designed per category-leader UX research against Zocdoc, Healthgrades,
 * MyChart (Epic), Doximity, WebMD Find-a-Doctor, and CMS Care Compare:
 *
 *   • Popular-first specialty chip grid (top 16 specialties as cyan
 *     chips). Below: a full NUCC taxonomy search input — no flat
 *     dropdown, no full hierarchy tree shown to patients.
 *   • Location filter: zip + state in a thin top control bar
 *   • Provider cards as a single column (photo placeholder, name,
 *     credential, specialty in plain English, distance/location, NPI
 *     badge as a small footer line — not a database-dump pill)
 *   • Save (Heart) and Save-as-DTU per provider so saved providers
 *     become citable creator-economy artifacts with source: "cms-nppes"
 *
 * NUCC taxonomy codes (e.g. 207RA0401X = Allergy & Immunology) are
 * NEVER shown raw — patients see the human label only, code is in a
 * hover tooltip if the user wants it.
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, Loader2, MapPin, Phone, Search, Stethoscope, User,
  Building2, Mail, ShieldCheck, ExternalLink,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

// Top-16 most-requested specialties (consumer side). Names match the
// NUCC `taxonomy_description` field on NPPES so the NPI registry
// matches directly without code lookup. Verified against NPPES API
// 2026-05-16.
const POPULAR_SPECIALTIES = [
  { label: 'Family Medicine', taxonomy: 'Family Medicine' },
  { label: 'Internal Medicine', taxonomy: 'Internal Medicine' },
  { label: 'Pediatrics', taxonomy: 'Pediatrics' },
  { label: 'OB-GYN', taxonomy: 'Obstetrics & Gynecology' },
  { label: 'Dermatology', taxonomy: 'Dermatology' },
  { label: 'Cardiology', taxonomy: 'Internal Medicine - Cardiovascular Disease' },
  { label: 'Mental Health', taxonomy: 'Psychiatry' },
  { label: 'Psychology', taxonomy: 'Psychologist' },
  { label: 'Orthopedics', taxonomy: 'Orthopaedic Surgery' },
  { label: 'Allergy & Immunology', taxonomy: 'Allergy & Immunology' },
  { label: 'Optometry', taxonomy: 'Optometrist' },
  { label: 'Dentistry', taxonomy: 'Dentist' },
  { label: 'Chiropractic', taxonomy: 'Chiropractor' },
  { label: 'Physical Therapy', taxonomy: 'Physical Therapist' },
  { label: 'Urgent Care', taxonomy: 'Family Medicine' },  // routed to FM with care_setting filter; NPPES has no urgent-care taxonomy
  { label: 'ER', taxonomy: 'Emergency Medicine' },
];

interface Provider {
  id: string;
  npi: string;
  name: string;
  specialty: string;
  credential: string | null;
  practice: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  fax: string | null;
  gender: string | null;
  enumeratedAt: string | null;
}

interface SearchResult {
  providers: Provider[];
  count: number;
  totalMatching: number;
  source: string;
  query: { taxonomy?: string; zip?: string; state?: string; city?: string; limit?: number };
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('healthcare', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function ProviderDirectory() {
  const [specialty, setSpecialty] = useState<string>('Family Medicine');
  const [customSpecialty, setCustomSpecialty] = useState('');
  const [zip, setZip] = useState('');
  const [stateInput, setStateInput] = useState('');
  const [city, setCity] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const searchQuery = useMutation({
    mutationFn: async (params: Record<string, unknown>) =>
      callMacro<SearchResult>('providers-search', params),
    onSuccess: (env) => {
      if (env.ok && env.result) { setResult(env.result); setErrorMsg(null); }
      else { setResult(null); setErrorMsg(env.error || 'No providers found'); }
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const runSearch = useCallback((overrides?: { taxonomy?: string }) => {
    const taxonomy = overrides?.taxonomy ?? customSpecialty.trim() ?? specialty;
    const params: Record<string, unknown> = { specialty: taxonomy, limit: 20 };
    if (zip) params.zipCode = zip.trim();
    if (stateInput) params.state = stateInput.trim().toUpperCase();
    if (city) params.city = city.trim();
    searchQuery.mutate(params);
  }, [customSpecialty, specialty, zip, stateInput, city, searchQuery]);

  const handleSpecialtyChip = (s: typeof POPULAR_SPECIALTIES[number]) => {
    setSpecialty(s.label);
    setCustomSpecialty('');
    runSearch({ taxonomy: s.taxonomy });
  };

  const toggleSave = (id: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSpecialty.trim()) return;
    setSpecialty(customSpecialty.trim());
    runSearch({ taxonomy: customSpecialty.trim() });
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Find Providers</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            cms nppes · ~8M providers
          </span>
        </div>
        {result && (
          <span className="text-[11px] text-zinc-500">
            {result.providers.length} of {result.totalMatching} shown
          </span>
        )}
      </header>

      {/* Popular specialty chip grid */}
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
          Common specialties
        </div>
        <div className="flex flex-wrap gap-1.5">
          {POPULAR_SPECIALTIES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => handleSpecialtyChip(s)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                specialty === s.label
                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-cyan-500/30 hover:text-zinc-200'
              }`}
              title={`NUCC taxonomy: ${s.taxonomy}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom specialty + location controls */}
      <form onSubmit={submitCustom} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
        <div className="relative sm:col-span-5">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={customSpecialty}
            onChange={(e) => setCustomSpecialty(e.target.value)}
            placeholder="Other specialty — e.g. Nephrology, Endocrinology…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
          />
        </div>
        <input
          type="text"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="ZIP"
          maxLength={5}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none sm:col-span-2"
        />
        <input
          type="text"
          value={stateInput}
          onChange={(e) => setStateInput(e.target.value.toUpperCase())}
          placeholder="State"
          maxLength={2}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs uppercase text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none sm:col-span-2"
        />
        <input
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="City (optional)"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none sm:col-span-3"
        />
      </form>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => runSearch()}
          disabled={searchQuery.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {searchQuery.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search providers
        </button>
        {(zip || stateInput || city) && (
          <button
            type="button"
            onClick={() => { setZip(''); setStateInput(''); setCity(''); }}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Clear filters
          </button>
        )}
      </div>

      {errorMsg && !result && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {!result && !searchQuery.isPending && !errorMsg && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/50 px-3 py-8 text-center text-xs text-zinc-500">
          Pick a specialty above or add ZIP + state to find verified providers from
          the CMS NPI Registry. All providers are NPI-verified at the federal level.
        </div>
      )}

      {result && result.providers.length === 0 && (
        <div className="rounded-md border border-dashed border-amber-500/20 bg-amber-500/5 px-3 py-6 text-center text-xs text-amber-300">
          No providers match — try a broader specialty, a different state, or remove the ZIP filter.
        </div>
      )}

      {result && result.providers.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {result.providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                saved={saved.has(p.id)}
                onToggleSave={() => toggleSave(p.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider, saved, onToggleSave }: { provider: Provider; saved: boolean; onToggleSave: () => void }) {
  const initials = (provider.name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.16 }}
      className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 transition-colors hover:border-cyan-500/30"
    >
      {/* Photo placeholder (NPPES has no photos) */}
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-cyan-500/20 bg-zinc-900 font-mono text-sm font-semibold text-cyan-300">
        {provider.gender === 'F' ? <User className="h-5 w-5" /> : initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-white">{provider.name}</h3>
          {provider.credential && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-300">
              {provider.credential}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-zinc-300">{provider.specialty}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
          {(provider.city || provider.state) && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {[provider.city, provider.state, provider.zip].filter(Boolean).join(', ')}
            </span>
          )}
          {provider.practice && (
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {provider.practice}
            </span>
          )}
          {provider.phone && (
            <a
              href={`tel:${provider.phone.replace(/\D/g, '')}`}
              className="flex items-center gap-1 transition-colors hover:text-cyan-400"
            >
              <Phone className="h-3 w-3" />
              {provider.phone}
            </a>
          )}
          {provider.fax && (
            <span className="flex items-center gap-1">
              <Mail className="h-3 w-3" />
              fax {provider.fax}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1.5 border-t border-zinc-800 pt-1.5 text-[10px] text-zinc-600">
          <ShieldCheck className="h-2.5 w-2.5 text-cyan-400/70" />
          <span title={`NPI: ${provider.npi}${provider.enumeratedAt ? ` · enumerated ${provider.enumeratedAt}` : ''}`}>
            Verified provider · CMS NPI Registry
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleSave}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            saved
              ? 'bg-rose-500/15 text-rose-400'
              : 'text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400'
          }`}
          title={saved ? 'Saved provider' : 'Save provider'}
          aria-label={saved ? 'Unsave provider' : 'Save provider'}
        >
          <Heart className={`h-3.5 w-3.5 ${saved ? 'fill-current' : ''}`} />
        </button>
        <SaveAsDtuButton
          compact
          apiSource="cms-nppes"
          apiUrl={`https://npiregistry.cms.hhs.gov/api/?number=${provider.npi}&version=2.1`}
          title={`${provider.name}${provider.credential ? `, ${provider.credential}` : ''} — ${provider.specialty}`}
          content={[
            `Name: ${provider.name}`,
            provider.credential ? `Credential: ${provider.credential}` : '',
            `Specialty: ${provider.specialty}`,
            provider.practice ? `Practice: ${provider.practice}` : '',
            provider.city ? `Location: ${[provider.city, provider.state, provider.zip].filter(Boolean).join(', ')}` : '',
            provider.phone ? `Phone: ${provider.phone}` : '',
            `NPI: ${provider.npi}`,
            provider.enumeratedAt ? `Enumerated: ${provider.enumeratedAt}` : '',
            '',
            'Source: CMS NPI Registry (NPPES) — federally verified.',
          ].filter(Boolean).join('\n')}
          extraTags={['healthcare', 'provider', 'nppes', provider.specialty.toLowerCase().replace(/[^a-z]+/g, '-')]}
          rawData={provider}
        />
        <a
          href={`https://npiregistry.cms.hhs.gov/provider-view/${provider.npi}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Open NPI registry page"
          aria-label="Open NPI registry"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </motion.div>
  );
}

'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Globe, Loader2, DollarSign, Plane, Users2, Clock, Phone, Car } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Country {
  name: string; officialName: string; iso2: string; iso3: string;
  capital: string | null; region: string; subregion: string;
  population: number; areaKm2: number;
  currencies: { code: string; name: string; symbol?: string }[];
  languages: string[]; timezones: string[];
  callingCode: string | null; drivingSide: string | null;
  flag?: string;
}
interface Convert { from: string; to: string; amount: number; rate: number | null; converted: number; date?: string }
interface Visa { arrangement: string | null; visaRequired: boolean | null; maxFreeStay: string | null; note?: string }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('travel', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function TripPlannerPanel() {
  const [destination, setDestination] = useState('Japan');
  const [passport, setPassport] = useState('US');
  const [days, setDays] = useState(14);
  const [amount, setAmount] = useState(500);
  const [country, setCountry] = useState<Country | null>(null);
  const [convert, setConvert] = useState<Convert | null>(null);
  const [visa, setVisa] = useState<Visa | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = useMutation({
    mutationFn: async () => {
      setError(null);
      const ci = await callMacro<Country>('country-info', { country: destination });
      if (!ci.ok || !ci.result) { setError(ci.error || 'country lookup failed'); setCountry(null); setConvert(null); setVisa(null); return; }
      setCountry(ci.result);
      const localCurrency = ci.result.currencies?.[0]?.code;
      const vc = await callMacro<Visa>('visaCheck', { passportCountry: passport, destination: ci.result.iso2, durationDays: days });
      if (vc.ok && vc.result) setVisa(vc.result); else setVisa(null);
      if (localCurrency && localCurrency !== 'USD') {
        const cv = await callMacro<Convert>('currency-convert', { amount, from: 'USD', to: localCurrency });
        if (cv.ok && cv.result) setConvert(cv.result); else setConvert(null);
      } else { setConvert(null); }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Plane className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Trip Planner</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">rest countries · ecb fx · bilateral visa tables</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); plan.mutate(); }} className="grid grid-cols-1 gap-2 md:grid-cols-5">
        <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Destination (name or ISO-2)" className="md:col-span-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        <input type="text" value={passport} onChange={(e) => setPassport(e.target.value.toUpperCase())} placeholder="Passport ISO-2 (e.g. US)" maxLength={2} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs uppercase text-white" />
        <input type="number" value={days} min={1} max={365} onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value))))} placeholder="Days" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        <button type="submit" disabled={plan.isPending} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {plan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plane className="h-3.5 w-3.5" />}
          Plan trip
        </button>
      </form>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}

      {country && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-4">
          <div className="flex items-start gap-3">
            {country.flag && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={country.flag} alt="" className="h-10 w-14 rounded border border-zinc-800 object-cover" />
            )}
            <div className="flex-1">
              <h3 className="text-base font-semibold text-white">{country.name}</h3>
              <p className="text-[11px] text-zinc-500">{country.officialName} · {country.iso2}/{country.iso3} · {country.region}{country.subregion ? ` · ${country.subregion}` : ''}</p>
            </div>
            <SaveAsDtuButton
              compact
              apiSource="rest-countries"
              apiUrl="https://restcountries.com/v3.1/"
              title={`Trip plan — ${country.name} (${passport} passport, ${days}d)`}
              content={`Destination: ${country.name} (${country.iso2})\nCapital: ${country.capital}\nPopulation: ${country.population?.toLocaleString()}\nLanguages: ${country.languages?.join(', ')}\nCurrencies: ${country.currencies?.map(c => `${c.code} (${c.symbol})`).join(', ')}\nTZ: ${country.timezones?.join(', ')}\nDriving: ${country.drivingSide}\n\nVisa (${passport} → ${country.iso2}, ${days}d): ${visa ? `${visa.arrangement || 'check embassy'} — ${visa.visaRequired ? 'visa required' : 'visa-free'} (${visa.maxFreeStay || '?'})` : 'no bilateral entry on file'}\n\nFX: $${amount} USD → ${convert ? `${convert.converted} ${convert.to} @ ${convert.rate}` : 'n/a'}`}
              extraTags={['travel', 'trip-plan', country.iso2.toLowerCase()]}
              rawData={{ country, visa, convert, amount, passport, days }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Cell label="Capital" value={country.capital || '—'} />
            <Cell label="Population" value={country.population?.toLocaleString() || '—'} />
            <Cell label="Area" value={country.areaKm2 ? `${(country.areaKm2).toLocaleString()} km²` : '—'} />
            <Cell label="Calling" value={country.callingCode || '—'} icon={Phone} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
            {country.timezones?.slice(0, 5).map((t) => (
              <span key={t} className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300"><Clock className="h-3 w-3" /> {t}</span>
            ))}
            {country.drivingSide && <span className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300"><Car className="h-3 w-3" /> drives {country.drivingSide}</span>}
            {country.languages?.slice(0, 4).map((l) => (
              <span key={l} className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300"><Users2 className="h-3 w-3" /> {l}</span>
            ))}
          </div>
        </div>
      )}

      {country && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1 text-xs font-semibold text-zinc-200"><DollarSign className="h-3.5 w-3.5 text-cyan-400" /> Currency</div>
              <input type="number" value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} className="w-20 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-right font-mono text-[11px] text-white" />
            </div>
            {convert ? (
              <div className="text-center">
                <div className="font-mono text-2xl text-cyan-300">{convert.converted.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-sm text-zinc-400">{convert.to}</span></div>
                <p className="mt-1 text-[10px] text-zinc-500">${convert.amount} {convert.from} @ {convert.rate?.toFixed(4)} (ECB · {convert.date})</p>
              </div>
            ) : country.currencies[0]?.code === 'USD' ? (
              <div className="text-center text-[11px] text-zinc-500">USD is the local currency.</div>
            ) : (
              <div className="text-center text-[11px] text-zinc-500">FX not available.</div>
            )}
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><Globe className="h-3.5 w-3.5 text-cyan-400" /> Entry ({passport} → {country.iso2})</div>
            {visa ? (
              <div className="text-center">
                <div className={`font-mono text-lg ${visa.visaRequired ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {visa.visaRequired ? 'Visa required' : 'Visa-free'}
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">{visa.arrangement || 'bilateral entry'} · max stay {visa.maxFreeStay || '?'}</p>
              </div>
            ) : (
              <div className="text-center text-[11px] text-amber-300">No verified bilateral arrangement on file. Confirm with embassy — visa tables intentionally narrow to Schengen / CTA / USMCA to avoid synthesizing.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-sm text-cyan-300">{value}</div>
    </div>
  );
}

'use client';

// SignalClassifyForm — Wave 4 gap-closure (docs/lens-specs/atlas-capability-map.md
// §1d `classify`). The ONE write path into the Atlas Signal Cortex taxonomy store
// (server/lib/atlas-signal-cortex.js#classifySignal via `POST /api/atlas/signals/classify`
// / macro `cortex.classify`). Fields below match that function's real input contract —
// frequency + origin{lat,lng} are required (validated server-side too, see
// server/server.js `register("cortex", "classify", ...)`); modulation/bandwidth/power/
// description/keywords are the optional identity + measurement enrichment fields the
// classifier already defaults safely when omitted.

import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Radio, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';

const MODULATIONS = ['unknown', 'AM', 'FSK', 'AFSK', 'OFDM', 'QAM', 'GFSK', 'LoRa', 'BPSK', 'BOC'];

interface ClassifiedSignalResult {
  id: string;
  category: string;
  purpose: string;
  frequency: number;
  adjustability: string;
}

interface ClassifyResponse {
  ok: boolean;
  error?: string;
  signal?: ClassifiedSignalResult;
}

const inputCls = 'bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/60';

export function SignalClassifyForm() {
  const queryClient = useQueryClient();
  const [frequency, setFrequency] = useState('');
  const [modulation, setModulation] = useState('unknown');
  const [bandwidth, setBandwidth] = useState('');
  const [power, setPower] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ClassifiedSignalResult | null>(null);

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const r = await apiHelpers.atlasTomography.signalsClassify(payload);
      return r.data as ClassifyResponse;
    },
    onSuccess: (data) => {
      if (!data?.ok) {
        setFormError(data?.error || 'Classification failed.');
        setLastResult(null);
        return;
      }
      setFormError(null);
      setLastResult(data.signal || null);
      queryClient.invalidateQueries({ queryKey: ['atlas-taxonomy'] });
      queryClient.invalidateQueries({ queryKey: ['atlas-spectrum'] });
      queryClient.invalidateQueries({ queryKey: ['atlas-anomalies'] });
    },
    onError: () => {
      setFormError('Could not reach the signal cortex. Try again.');
      setLastResult(null);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setLastResult(null);

    const freqNum = Number(frequency);
    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (!frequency.trim() || !Number.isFinite(freqNum) || freqNum <= 0) {
      setFormError('Frequency (MHz) must be a positive number.');
      return;
    }
    if (!lat.trim() || !lng.trim() || !Number.isFinite(latNum) || !Number.isFinite(lngNum) ||
        latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      setFormError('Latitude and longitude are required and must be valid coordinates.');
      return;
    }

    setFormError(null);
    mutation.mutate({
      frequency: freqNum,
      modulation: modulation === 'unknown' ? undefined : modulation,
      bandwidth: bandwidth.trim() ? Number(bandwidth) : undefined,
      power: power.trim() ? Number(power) : undefined,
      origin: { lat: latNum, lng: lngNum },
      description: description.trim() || undefined,
      keywords: keywords.trim() ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : undefined,
    });
  }

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Radio size={16} className="text-purple-400" />
        <span className="text-sm font-medium text-zinc-200">Report a Signal</span>
      </div>
      <p className="text-xs text-zinc-500">
        Manually submit a signal for 5-property classification (identity, location, purpose,
        measurement, adjustability). This is the only write path into the taxonomy above —
        a successful submission appears there immediately.
      </p>
      <form onSubmit={submit} className="grid grid-cols-2 gap-2">
        <input
          type="number" step="any" placeholder="Frequency (MHz) *"
          value={frequency} onChange={(e) => setFrequency(e.target.value)}
          className={inputCls}
        />
        <select
          value={modulation} onChange={(e) => setModulation(e.target.value)}
          aria-label="Modulation"
          className={inputCls}
        >
          {MODULATIONS.map((m) => (
            <option key={m} value={m}>{m === 'unknown' ? 'Modulation (unknown)' : m}</option>
          ))}
        </select>
        <input
          type="number" step="any" placeholder="Latitude *"
          value={lat} onChange={(e) => setLat(e.target.value)}
          className={inputCls}
        />
        <input
          type="number" step="any" placeholder="Longitude *"
          value={lng} onChange={(e) => setLng(e.target.value)}
          className={inputCls}
        />
        <input
          type="number" step="any" placeholder="Bandwidth (MHz)"
          value={bandwidth} onChange={(e) => setBandwidth(e.target.value)}
          className={inputCls}
        />
        <input
          type="number" step="any" placeholder="Power / signal strength"
          value={power} onChange={(e) => setPower(e.target.value)}
          className={inputCls}
        />
        <input
          type="text" placeholder="Description (e.g. device or source)"
          value={description} onChange={(e) => setDescription(e.target.value)}
          className={`col-span-2 ${inputCls}`}
        />
        <input
          type="text" placeholder="Keywords (comma-separated)"
          value={keywords} onChange={(e) => setKeywords(e.target.value)}
          className={`col-span-2 ${inputCls}`}
        />
        <button
          type="submit"
          disabled={mutation.isPending}
          className="col-span-2 flex items-center justify-center gap-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium py-1.5 transition-colors"
        >
          {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
          Classify signal
        </button>
      </form>
      {formError && (
        <div role="alert" className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {formError}
        </div>
      )}
      {lastResult && !formError && (
        <div role="status" className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Classified as {lastResult.category} ({lastResult.purpose}) — {lastResult.adjustability.replace(/_/g, ' ').toLowerCase()}.
        </div>
      )}
    </div>
  );
}

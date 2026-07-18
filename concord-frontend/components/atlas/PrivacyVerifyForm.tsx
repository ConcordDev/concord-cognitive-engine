'use client';

// PrivacyVerifyForm — Wave 4 gap-closure (docs/lens-specs/atlas-capability-map.md
// §1d `privacy.zones`/`privacy.verify`/`privacy.stats`). The verification path
// into the Atlas Signal Cortex privacy-zone store (server/lib/atlas-signal-cortex.js
// #verifyPrivacyZone via `GET /api/atlas/privacy_zones?view=verify&zoneId=...`,
// macro `cortex.privacy.verify`). Zones are picked from a real, already-fetched
// list — never typed blind — because zone ids are opaque `uid("zone")` strings
// with no guessable structure.

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import AtlasPrivacyMonitor, { type PrivacyMonitorData } from '@/components/chat/AtlasPrivacyMonitor';

interface VerifiableZone {
  id: string;
  classification: string;
  protection_level: string;
}

interface PrivacyVerifyFormProps {
  zones: VerifiableZone[];
}

export function PrivacyVerifyForm({ zones }: PrivacyVerifyFormProps) {
  const [selectedZoneId, setSelectedZoneId] = useState('');
  const [submittedZoneId, setSubmittedZoneId] = useState<string | null>(null);

  const { data, isFetching, isError } = useQuery<PrivacyMonitorData>({
    queryKey: ['atlas-privacy-verify', submittedZoneId],
    queryFn: () =>
      apiHelpers.atlasTomography.privacyZones('verify', { zoneId: submittedZoneId }).then((r) => r.data),
    enabled: !!submittedZoneId,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (selectedZoneId) setSubmittedZoneId(selectedZoneId);
  }

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-red-400" />
        <span className="text-sm font-medium text-zinc-200">Verify Zone Integrity</span>
      </div>
      <p className="text-xs text-zinc-500">
        Confirms a zone&apos;s interior-never-generated guarantee holds — no interior data
        exists and none is reconstructable. Pick a real zone from the list above; this deployment
        has none until a signal profile is classified into a protected zone.
      </p>

      {zones.length === 0 ? (
        <p className="text-xs text-zinc-400">No privacy zones exist yet to verify.</p>
      ) : (
        <form onSubmit={submit} className="flex items-center gap-2">
          <select
            value={selectedZoneId}
            onChange={(e) => setSelectedZoneId(e.target.value)}
            aria-label="Select privacy zone to verify"
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-red-500/60"
          >
            <option value="">Select a zone…</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.classification} ({z.protection_level}) — {z.id.slice(0, 12)}…
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!selectedZoneId || isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white transition-colors"
          >
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Verify
          </button>
        </form>
      )}

      {isError && (
        <div role="alert" className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Could not reach the privacy cortex. Try again.
        </div>
      )}

      {submittedZoneId && !isError && (
        <AtlasPrivacyMonitor data={data ?? null} loading={isFetching} />
      )}
    </div>
  );
}

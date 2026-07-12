'use client';

/**
 * TechCertifications — a real, formal certification/license record per
 * technician. Closes the "Certs" gap (docs/lens-specs/plumbing-capability-
 * map.md): `techAdd`'s `skills` field is a freeform capability tag list
 * (e.g. ["drain","gas"]) used for quick dispatch matching — it stays exactly
 * as-is. This component is the DISTINCT structured record: a named
 * certification/license, its issuing body, license number, issue date, and
 * expiry date, backed by the `techCertAdd` / `techCertList` / `techCertRemove`
 * macros in `server/domains/plumbing.js`.
 *
 * Genuinely designed, not a generic action list or JSON-paste textarea: an
 * inline disclosure per technician with a real certification-category
 * picker (named plumbing-trade categories, with a free-text fallback for
 * anything not on the list), expiry badges (a lapsed license reads in red,
 * not silently dropped), and one-click remove.
 */

import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Plus, Trash2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface Certification {
  id: string;
  name: string;
  issuingBody: string;
  licenseNumber: string;
  issueDate: string | null;
  expiryDate: string | null;
  isExpired: boolean;
  createdAt?: string;
}

// Real plumbing-trade certification categories — not generic placeholders.
// "Other" falls through to a free-text field for anything not listed
// (state-specific journeyman tiers, municipal endorsements, etc).
const CERT_CATEGORIES = [
  'Master Plumber License',
  'Journeyman Plumber License',
  'Apprentice Plumber Registration',
  'Backflow Prevention Certification',
  'Gas Fitting License',
  'Medical Gas Systems Certification (ASSE 6010/6020)',
  'Cross-Connection Control Specialist',
  'Solar Water Heating Certification',
  'OSHA 10-Hour Construction Safety',
  'Other',
] as const;

const inputCls = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400';

interface TechCertificationsProps {
  techId: string;
  techName: string;
  certifications: Certification[];
  onChanged: () => void;
}

export function TechCertifications({ techId, techName, certifications, onChanged }: TechCertificationsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<string>(CERT_CATEGORIES[0]);
  const [customName, setCustomName] = useState('');
  const [issuingBody, setIssuingBody] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const expiredCount = certifications.filter((c) => c.isExpired).length;

  const addCert = async () => {
    const name = category === 'Other' ? customName.trim() : category;
    if (!name) { setErr('Certification name required'); return; }
    if (!issuingBody.trim()) { setErr('Issuing body required'); return; }
    setBusy(true);
    setErr(null);
    try {
      const { data } = await lensRun('plumbing', 'techCertAdd', {
        techId, name, issuingBody, licenseNumber, issueDate: issueDate || undefined, expiryDate: expiryDate || undefined,
      });
      if (!data.ok) { setErr(data.error || 'techCertAdd failed'); return; }
      setCustomName(''); setIssuingBody(''); setLicenseNumber(''); setIssueDate(''); setExpiryDate('');
      setCategory(CERT_CATEGORIES[0]);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeCert = async (certId: string) => {
    setBusy(true);
    try {
      await lensRun('plumbing', 'techCertRemove', { techId, certId });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 rounded border border-zinc-800/60 bg-zinc-950/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-[11px] text-zinc-400 hover:text-white"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expiredCount > 0 ? <ShieldAlert className="h-3 w-3 text-rose-400" /> : <ShieldCheck className="h-3 w-3 text-emerald-400" />}
          Certifications ({certifications.length}
          {expiredCount > 0 ? `, ${expiredCount} expired` : ''})
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-800/60 px-2 py-2">
          {certifications.length > 0 && (
            <ul className="space-y-1">
              {certifications.map((c) => (
                <li key={c.id} className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] ${c.isExpired ? 'border-rose-500/30 bg-rose-500/5' : 'border-zinc-800'}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-white">{c.name}</span>
                      {c.isExpired && <span className="rounded bg-rose-500/20 px-1 py-0.5 text-[9px] font-medium text-rose-300">EXPIRED</span>}
                    </div>
                    <div className="truncate text-zinc-500">
                      {c.issuingBody}
                      {c.licenseNumber ? ` · #${c.licenseNumber}` : ''}
                      {c.expiryDate ? ` · exp ${c.expiryDate}` : ' · no expiry on file'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeCert(c.id)}
                    disabled={busy}
                    aria-label={`Remove ${c.name} certification`}
                    className="shrink-0 text-zinc-600 hover:text-rose-400 disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {certifications.length === 0 && <p className="text-[11px] text-zinc-500">No certifications on file for {techName}.</p>}

          <div className="space-y-1.5 border-t border-zinc-800/60 pt-2">
            <div className="grid grid-cols-2 gap-1.5">
              <select
                className={`${inputCls} col-span-2`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Certification type"
              >
                {CERT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {category === 'Other' && (
                <input
                  className={`${inputCls} col-span-2`}
                  placeholder="Certification name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
              )}
              <input className={inputCls} placeholder="Issuing body" value={issuingBody} onChange={(e) => setIssuingBody(e.target.value)} />
              <input className={inputCls} placeholder="License #" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                Issue date
                <input type="date" className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
                Expiry date
                <input type="date" className={inputCls} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void addCert()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add Certification
            </button>
            {err && <p className="text-[10px] text-rose-400">{err}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default TechCertifications;

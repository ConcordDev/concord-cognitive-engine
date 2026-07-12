'use client';

/**
 * ClientAutocomplete — a real Client (CRM) combobox for the insurance lens'
 * policy/claim forms. Closes the "no persisted Client entity" gap
 * (docs/lens-specs/insurance-capability-map.md): an insured's contact
 * record was never persisted — policy-add/claim-file only ever took
 * carrier/policyNumber/description text with no reusable per-client record
 * behind it, so nothing autocompleted and nothing aggregated a client's
 * book of policies/claims. This wires the new server/domains/insurance.js
 * `client-add`/`client-list` macro pair with a genuinely designed combobox
 * — type to search, arrow-key navigate, Enter to select, or add the typed
 * name as a brand-new client inline when no match exists. Not a raw
 * <select>, not a JSON form. Restyled to insurance's own blue palette (not
 * a cross-lens import) — same interaction contract as plumbing's and
 * landscaping's ClientAutocomplete.
 *
 * Selecting (or inline-creating) a client sets `clientId`; the parent form
 * sends it additively alongside its existing fields (server-side additive
 * contract — see insurance.js `resolveClientRef`). Leaving the combobox
 * untouched sends no clientId at all, exactly as before this file existed.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, UserPlus, Check, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface ClientRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  dob?: string | null;
  riskProfile?: string;
  referralSource?: string | null;
  notes?: string | null;
  policyCount?: number;
  activePolicyCount?: number;
  claimCount?: number;
  totalAnnualPremium?: number;
  createdAt?: string;
}

interface ClientAutocompleteProps {
  clients: ClientRecord[];
  value: string;
  clientId: string | null;
  onSelect: (client: ClientRecord | null, text: string) => void;
  onCreated?: (client: ClientRecord) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const inputCls = 'rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500';

export function ClientAutocomplete({
  clients, value, clientId, onSelect, onCreated, placeholder = 'Client', className, disabled,
}: ClientAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const optionId = (idx: number) => `${listboxId}-opt-${idx}`;

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return clients.slice(0, 8);
    return clients.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 8);
  }, [clients, query]);
  const exactMatch = query.length > 0 && clients.some((c) => c.name.toLowerCase() === query);
  const canCreate = query.length > 0 && !exactMatch;
  const totalOptions = matches.length + (canCreate ? 1 : 0);

  useEffect(() => { setHighlight(0); }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pick = (client: ClientRecord) => {
    onSelect(client, client.name);
    setOpen(false);
  };

  const createInline = async () => {
    const name = value.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const { data } = await lensRun<{ client: ClientRecord }>('insurance', 'client-add', { name });
      if (data.ok && data.result?.client) {
        onCreated?.(data.result.client);
        onSelect(data.result.client, data.result.client.name);
        setOpen(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(totalOptions - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (highlight < matches.length) {
        e.preventDefault();
        pick(matches[highlight]);
      } else if (canCreate) {
        e.preventDefault();
        void createInline();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className || ''}`} ref={boxRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <input
          className={`${inputCls} w-full pl-6 ${clientId ? 'pr-6' : ''}`}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => { onSelect(null, e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={open && totalOptions > 0 ? optionId(highlight) : undefined}
          aria-label={placeholder}
        />
        {clientId && (
          <Check className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-emerald-400" aria-label="Linked to a saved client" />
        )}
      </div>
      {open && (matches.length > 0 || canCreate) && (
        <div id={listboxId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-[240px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
          {matches.map((c, idx) => (
            <button
              key={c.id}
              id={optionId(idx)}
              role="option"
              aria-selected={idx === highlight}
              type="button"
              onClick={() => pick(c)}
              onMouseEnter={() => setHighlight(idx)}
              className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left text-xs ${
                idx === highlight ? 'bg-blue-600/20 text-white' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <span className="font-medium text-white">{c.name}</span>
              <span className="text-[10px] text-zinc-500">
                {[c.phone, c.email, c.address].filter(Boolean).join(' · ') || 'No contact info yet'}
                {typeof c.policyCount === 'number' && c.policyCount > 0 ? ` · ${c.policyCount} polic${c.policyCount === 1 ? 'y' : 'ies'}` : ''}
              </span>
            </button>
          ))}
          {canCreate && (
            <button
              id={optionId(matches.length)}
              role="option"
              aria-selected={highlight === matches.length}
              type="button"
              onClick={() => void createInline()}
              onMouseEnter={() => setHighlight(matches.length)}
              disabled={creating}
              className={`flex w-full items-center gap-1.5 border-t border-zinc-800 px-2.5 py-1.5 text-left text-xs disabled:opacity-50 ${
                highlight === matches.length ? 'bg-blue-600/20 text-white' : 'text-blue-300 hover:bg-zinc-800'
              }`}
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
              Add &ldquo;{value.trim()}&rdquo; as new client
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ClientAutocomplete;

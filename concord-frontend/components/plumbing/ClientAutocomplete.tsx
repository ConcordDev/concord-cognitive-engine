'use client';

/**
 * ClientAutocomplete — a real Client (CRM) combobox for the plumbing lens'
 * job/invoice/plan forms. Closes the "no persisted Client entity" gap
 * (docs/lens-specs/plumbing-capability-map.md): client name/contact was
 * previously a raw free-text `<input>` re-typed on every dispatchAssign /
 * invoiceFromQuote / planCreate call, so it never autocompleted and history
 * never aggregated across documents for the same client. This wires the new
 * server/domains/plumbing.js `clientAdd`/`clientList` macro pair with a
 * genuinely designed combobox — type to search, arrow-key navigate, Enter
 * to select, or add the typed name as a brand-new client inline when no
 * match exists. Not a raw <select>, not a JSON form.
 *
 * Manual free-text entry is preserved byte-for-byte: typing without picking
 * a suggestion clears `clientId` and the parent's existing macro call keeps
 * sending only the `client` text field, exactly as it did before this file
 * existed (server-side additive contract — see plumbing.js `resolveClientRef`).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, UserPlus, Check, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface ClientRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes?: string;
  jobsCount?: number;
  invoiceCount?: number;
  totalBilled?: number;
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

const inputCls = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400';

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
      const { data } = await lensRun<{ client: ClientRecord }>('plumbing', 'clientAdd', { name });
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
        <div id={listboxId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-[240px] overflow-auto rounded border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
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
                {typeof c.jobsCount === 'number' && c.jobsCount > 0 ? ` · ${c.jobsCount} job${c.jobsCount === 1 ? '' : 's'}` : ''}
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

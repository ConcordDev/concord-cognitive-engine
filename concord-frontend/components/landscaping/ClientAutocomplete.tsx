'use client';

/**
 * ClientAutocomplete — a real Client (CRM) combobox for the landscaping
 * lens' proposal-builder client field. Closes the "no persisted Client
 * entity" gap (docs/lens-specs/landscaping-capability-map.md): client name
 * was previously a raw free-text `<input>` re-typed on every
 * proposal-build call, so it never autocompleted future proposals and
 * history never aggregated across documents for the same client. This
 * mirrors plumbing's ClientAutocomplete (concord-frontend/components/
 * plumbing/ClientAutocomplete.tsx) — the exact design precedent named for
 * this gap — restyled to this lens' emerald palette (GardenStudio.tsx) and
 * wired against the new server/domains/landscaping.js `client-add`/
 * `client-list` macro pair: type to search, arrow-key navigate, Enter to
 * select, or add the typed name as a brand-new client inline when no match
 * exists. Not a raw <select>, not a JSON form.
 *
 * Manual free-text entry is preserved byte-for-byte: typing without picking
 * a suggestion clears `clientId` and the parent's existing macro call keeps
 * sending only the `client` text field, exactly as it did before this file
 * existed (server-side additive contract — see landscaping.js
 * `lsResolveClientRef`).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, UserPlus, Check, Loader2, Pencil } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';

export interface LandscapingClientRecord {
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
  clients: LandscapingClientRecord[];
  value: string;
  clientId: string | null;
  onSelect: (client: LandscapingClientRecord | null, text: string) => void;
  onCreated?: (client: LandscapingClientRecord) => void;
  onUpdated?: (client: LandscapingClientRecord) => void;
  onDeleted?: (id: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const inputCls =
  'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-emerald-500/40';

export function ClientAutocomplete({
  clients, value, clientId, onSelect, onCreated, onUpdated, onDeleted, placeholder = 'Client name', className, disabled,
}: ClientAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', phone: '', email: '', address: '' });
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
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

  const pick = (client: LandscapingClientRecord) => {
    onSelect(client, client.name);
    setOpen(false);
  };

  const saveClient = async (id: string) => {
    if (!draft.name.trim()) { setRowErr('Client name is required.'); return; }
    setRowBusy(id);
    setRowErr(null);
    try {
      const { data } = await lensRun<{ client: LandscapingClientRecord }>('landscaping', 'client-update', {
        id,
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        address: draft.address.trim(),
      });
      if (data.ok && data.result?.client) {
        onUpdated?.(data.result.client);
        if (clientId === id) onSelect(data.result.client, data.result.client.name);
        setEditingId(null);
      } else {
        setRowErr(data.error || 'Could not save that client.');
      }
    } finally {
      setRowBusy(null);
    }
  };

  const deleteClient = async (id: string) => {
    setRowBusy(id);
    setRowErr(null);
    try {
      const { data } = await lensRun('landscaping', 'client-delete', { id });
      if (data.ok) {
        onDeleted?.(id);
        if (clientId === id) onSelect(null, '');
        setEditingId(null);
      } else {
        setRowErr(data.error || 'Could not delete that client.');
      }
    } finally {
      setRowBusy(null);
    }
  };

  const createInline = async () => {
    const name = value.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const { data } = await lensRun<{ client: LandscapingClientRecord }>('landscaping', 'client-add', { name });
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
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <input
          className={`${inputCls} pl-8 ${clientId ? 'pr-8' : ''}`}
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
          <Check className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-400" aria-label="Linked to a saved client" />
        )}
      </div>
      {open && (matches.length > 0 || canCreate) && (
        <div id={listboxId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-[240px] overflow-auto rounded-md border border-zinc-800 bg-zinc-950 py-1 shadow-xl">
          {matches.map((c, idx) => (
            <div
              key={c.id}
              id={optionId(idx)}
              role="option"
              aria-selected={idx === highlight}
              onClick={() => { if (editingId !== c.id) pick(c); }}
              onMouseEnter={() => setHighlight(idx)}
              className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left text-xs ${
                idx === highlight ? 'bg-emerald-500/15 text-emerald-100' : 'text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <div className="flex w-full items-center gap-1">
                <span className="font-medium text-white">{c.name}</span>
                <span className="ml-auto inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button type="button" aria-label={`Edit ${c.name}`}
                    onClick={() => {
                      setEditingId(c.id);
                      setDraft({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '' });
                      setRowErr(null);
                    }}
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-200">
                    <Pencil className="h-3 w-3" />
                  </button>
                  <StickyDeleteConfirm onConfirm={() => void deleteClient(c.id)} disabled={rowBusy === c.id}
                    armAriaLabel={`Delete ${c.name}`} confirmAriaLabel={`Confirm delete ${c.name}`}
                    className="p-0.5 text-zinc-400 hover:text-rose-300" armLabel={<span className="text-[10px]">Delete</span>} />
                </span>
              </div>
              <span className="text-[10px] text-zinc-500">
                {[c.phone, c.email, c.address].filter(Boolean).join(' · ') || 'No contact info yet'}
                {typeof c.jobsCount === 'number' && c.jobsCount > 0 ? ` · ${c.jobsCount} job${c.jobsCount === 1 ? '' : 's'}` : ''}
              </span>
              {editingId === c.id && (
                <div className="mt-1 grid w-full grid-cols-2 gap-1" onClick={(e) => e.stopPropagation()}>
                  <input aria-label="Client name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
                  <input aria-label="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone" className={inputCls} />
                  <input aria-label="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="Email" className={inputCls} />
                  <input aria-label="Address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Address" className={inputCls} />
                  {rowErr && <p className="col-span-2 text-[10px] text-rose-300">{rowErr}</p>}
                  <div className="col-span-2 flex gap-1">
                    <button type="button" onClick={() => void saveClient(c.id)} disabled={rowBusy === c.id}
                      className="rounded bg-emerald-600 px-2 py-1 text-[11px] text-white">Save</button>
                    <button type="button" onClick={() => setEditingId(null)}
                      className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300">Cancel</button>
                  </div>
                </div>
              )}
            </div>
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
                highlight === matches.length ? 'bg-emerald-500/15 text-emerald-100' : 'text-emerald-300 hover:bg-zinc-900'
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

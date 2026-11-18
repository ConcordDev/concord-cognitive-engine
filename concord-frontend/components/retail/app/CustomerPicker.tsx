'use client';

/**
 * CustomerPicker — attach a customer to the sale (retail.cart-set-customer).
 * Searches the real customer list; can add a new customer inline
 * (retail.customers-add) and attach them in one step. On tender the server
 * stamps the customer on the order and moves their spend / order count.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { UserRound, UserPlus, X, Loader2 } from 'lucide-react';
import { retail, money, type Cart, type Customer } from './retailApi';

export function CustomerPicker({ cart, onChange, onError }: { cart: Cart; onChange: (c: Cart) => void; onError: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || customers) return;
    retail<{ customers: Customer[] }>('customers-list').then((r) => setCustomers(r.ok && r.result ? r.result.customers : []));
  }, [open, customers]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (customers || []).filter((c) => !s || c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || (c.phone || '').includes(s)).slice(0, 8);
  }, [customers, q]);

  const attach = async (customerId: string | null) => {
    setBusy(true);
    const r = await retail<{ cart: Cart }>('cart-set-customer', { cartId: cart.id, customerId });
    setBusy(false);
    if (r.ok && r.result) { onChange(r.result.cart); setOpen(false); setQ(''); }
    else onError(r.error || 'Could not attach the customer.');
  };

  const createAndAttach = async () => {
    setBusy(true);
    const r = await retail<{ customer: Customer }>('customers-add', { name: newName.trim(), email: newEmail.trim() });
    setBusy(false);
    if (!r.ok || !r.result) { onError(r.error || 'Could not add the customer.'); return; }
    setCustomers((cs) => [...(cs || []), r.result!.customer]);
    setAdding(false); setNewName(''); setNewEmail('');
    attach(r.result.customer.id);
  };

  if (cart.customerId) {
    return (
      <div className="flex items-center gap-2 px-1 py-1.5">
        <UserRound className="h-4 w-4 text-[color:var(--stall-ink-dim)]" />
        <span className="flex-1 truncate text-[13px] font-bold uppercase">{cart.customerName}</span>
        <button type="button" onClick={() => attach(null)} disabled={busy} className="rounded p-1 text-[color:var(--stall-ink-dim)] hover:text-[color:var(--stall-ink)]" aria-label="Remove customer from sale"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative px-1 py-1">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 rounded-md py-1 font-sans text-[13px] text-[color:var(--stall-ink-dim)] hover:text-[color:var(--stall-ink)]">
        <UserPlus className="h-4 w-4" /> Add customer
      </button>
      {open && (
        <div className="stall-board absolute inset-x-0 top-9 z-20 rounded-lg border border-[color:var(--stall-line)] p-2 font-sans text-[color:var(--stall-chalk)] shadow-2xl">
          {adding ? (
            <form onSubmit={(e) => { e.preventDefault(); createAndAttach(); }} className="space-y-2 p-1">
              <input autoFocus aria-label="Customer name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className="h-9 w-full rounded-md border border-[color:var(--stall-line)] bg-transparent px-2.5 text-[13px] text-[color:var(--stall-chalk)] placeholder:text-[color:var(--stall-chalk-faint)] focus:border-white/25 focus:outline-none" />
              <input aria-label="Customer email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" className="h-9 w-full rounded-md border border-[color:var(--stall-line)] bg-transparent px-2.5 text-[13px] text-[color:var(--stall-chalk)] placeholder:text-[color:var(--stall-chalk-faint)] focus:border-white/25 focus:outline-none" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} className="h-8 rounded-md px-3 text-[12px] text-[color:var(--stall-chalk-dim)] hover:bg-white/5">Back</button>
                <button type="submit" disabled={!newName.trim() || !newEmail.trim() || busy} className="h-8 rounded-md bg-[color:var(--stall-brass)] px-3 text-[12px] font-medium text-[color:var(--stall-ink)] disabled:opacity-40">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add & attach'}</button>
              </div>
            </form>
          ) : (
            <>
              <input autoFocus aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone" className="h-9 w-full rounded-md border border-[color:var(--stall-line)] bg-transparent px-2.5 text-[13px] text-[color:var(--stall-chalk)] placeholder:text-[color:var(--stall-chalk-faint)] focus:border-white/25 focus:outline-none" />
              <div className="mt-1 max-h-60 overflow-y-auto" aria-busy={customers === null}>
                {customers === null ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-[color:var(--stall-chalk-faint)]" /></div>
                ) : matches.length === 0 ? (
                  <p className="px-2 py-3 text-[12px] text-[color:var(--stall-chalk-faint)]">{customers.length === 0 ? 'No customers yet.' : 'No match.'}</p>
                ) : matches.map((c) => (
                  <button key={c.id} type="button" onClick={() => attach(c.id)} disabled={busy} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-white/5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-[color:var(--stall-chalk)]">{c.name}</span>
                      <span className="block truncate text-[11px] text-[color:var(--stall-chalk-faint)]">{c.email}</span>
                    </span>
                    <span className="text-right font-mono text-[11px] tabular-nums text-[color:var(--stall-chalk-faint)]">{money(c.totalSpent)}<br />{c.orderCount || 0} orders</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => { setAdding(true); setNewName(q); }} className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-[12px] text-[color:var(--stall-chalk-dim)] hover:bg-white/5 hover:text-[color:var(--stall-chalk)]">
                <UserPlus className="h-3.5 w-3.5" /> New customer
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default CustomerPicker;

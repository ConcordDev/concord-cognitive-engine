'use client';

/**
 * A star's catalogue card: its name and catalogue number, its class (shelf)
 * and magnitude with what made it that bright, where it sits on the chart,
 * its lineage (what it builds on, what builds on it — the old Genome view,
 * now attached to the star itself), what it's linked to, and which of your
 * own charts it appears on. From here: point the telescope, plot a route,
 * add a new star linked from this one, or open the DTU.
 */

import { useCallback, useEffect, useState } from 'react';
import { Compass, ExternalLink, Navigation, Plus, X } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import { catalogueNo, coords, gx, RELATION_WORDS, SHELF_NAMES, type Ref, type Star, type StarCard } from './gx';

export function CatalogueCard({ id, star, onClose, onPoint, onRouteFrom, routingFrom, onOpen, onCreated }: {
  id: string; star: Star | null; onClose: () => void; onPoint: (id: string) => void;
  onRouteFrom: (id: string) => void; routingFrom: string | null; onOpen: (id: string) => void; onCreated: (id: string) => void;
}) {
  const [card, setCard] = useState<StarCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setCard(null); setErr(null);
    const r = await gx<{ star: StarCard }>('star', { id });
    if (!r.ok) { setErr(r.error); return; }
    setCard(r.result!.star);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const addStar = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiHelpers.dtus.create(withContentLicense({ title, content: title, tags: ['graph-created'], parents: [id] }, 'knowledge', ['private']));
      const made = (r.data as { ok?: boolean; dtu?: { id?: string }; id?: string; error?: string; reason?: string } | undefined);
      const newId = made?.dtu?.id || made?.id;
      // The DTU council can refuse an idea too thin to stand on its own:
      // say so, with its reason, rather than a generic failure.
      if (!newId) throw new Error(made?.error ? `${made.error}${made.reason ? ` (${String(made.reason).replace(/_/g, ' ')}): give it a fuller title` : ''}.` : 'The new star was not saved.');
      setNewTitle(''); setAdding(false);
      onCreated(String(newId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The new star was not saved.');
    }
    setBusy(false);
  };

  const refList = (label: string, refs: Ref[], testid: string) => refs.length > 0 && (
    <div>
      <h4 className="sk-label mb-1">{label}</h4>
      <ul className="space-y-0.5" data-testid={testid}>
        {refs.map((r) => <li key={r.id}><button type="button" className="sk-link sk-atlas text-[14px] italic" onClick={() => onPoint(r.id)}>{r.title}</button></li>)}
      </ul>
    </div>
  );

  return (
    <aside className="sk-panel sk-rise flex max-h-full flex-col overflow-hidden" aria-label="Catalogue card" data-testid="sk-card">
      <header className="flex items-start gap-3 border-b border-[var(--sk-rule)] p-4">
        <span className="sk-dot mt-2 shrink-0" style={{ background: card?.colour || star?.colour || '#ccc', color: card?.colour || star?.colour || '#ccc' }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="sk-mono text-[11px] text-[var(--sk-muted)]">{catalogueNo(id)}{star ? ` · ${coords(star.x, star.y)}` : ''}</p>
          <h2 className="sk-atlas text-[22px] leading-tight text-[var(--sk-ink)]">{card?.title || star?.title || '…'}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-[var(--sk-muted)] hover:text-[var(--sk-ink)]" aria-label="Close the card"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {err && <p className="sk-error" role="alert">{err}</p>}
        {!card && !err && <div className="sk-skeleton h-32" role="status" aria-label="Reading the catalogue" />}
        {card && (
          <>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-[var(--sk-muted)]">Magnitude</dt>
              <dd><span className="sk-mono">{card.magnitude.toFixed(2)}</span> <span className="text-[var(--sk-muted)]">from {card.links} link{card.links === 1 ? '' : 's'}{card.citations ? ` and ${card.citations} citation${card.citations === 1 ? '' : 's'}` : ''}</span></dd>
              <dt className="text-[var(--sk-muted)]">Class</dt>
              <dd>{card.spectral ? <><span className="sk-mono">{card.spectral}</span> · {SHELF_NAMES[card.shelf] || card.shelf}</> : <span className="text-[var(--sk-muted)]">not charted ({card.shelf})</span>}</dd>
              {card.owner && <><dt className="text-[var(--sk-muted)]">Made by</dt><dd>{card.isMine ? 'you' : card.owner}</dd></>}
              {card.createdAt && <><dt className="text-[var(--sk-muted)]">First seen</dt><dd className="sk-mono text-[12px]">{card.createdAt.slice(0, 10)}</dd></>}
            </dl>
            {card.summary && <p className="text-[13.5px] leading-relaxed text-[var(--sk-ink-2)]">{card.summary}</p>}
            {card.tags.length > 0 && <p className="flex flex-wrap gap-1">{card.tags.map((t) => <span key={t} className="rounded-full border border-[var(--sk-rule)] px-2 py-0.5 text-[11px] text-[var(--sk-ink-2)]">{t}</span>)}</p>}
            {refList('Builds on', card.parents, 'sk-parents')}
            {refList('Built on by', card.children, 'sk-children')}
            {card.relations.filter((r) => r.type !== 'parent' && r.type !== 'child').length > 0 && (
              <div>
                <h4 className="sk-label mb-1">Linked</h4>
                <ul className="space-y-0.5">
                  {card.relations.filter((r) => r.type !== 'parent' && r.type !== 'child').slice(0, 12).map((r, i) => (
                    <li key={`${r.id}${i}`} className="text-[13px]"><span className="text-[var(--sk-muted)]">{r.direction === 'out' ? '→' : '←'} {RELATION_WORDS[r.type] || r.type.replace(/-/g, ' ')}</span> <button type="button" className="sk-link sk-atlas italic" onClick={() => onPoint(r.id)}>{r.title}</button></li>
                  ))}
                </ul>
              </div>
            )}
            {card.charts.length > 0 && <p className="text-[12.5px] text-[var(--sk-mine)]">On your chart{card.charts.length > 1 ? 's' : ''}: {card.charts.map((c) => c.title).join(', ')}</p>}
            {!card.parents.length && !card.children.length && !card.relations.length && <p className="text-[12.5px] text-[var(--sk-muted)]">A lone star: nothing links to it yet.</p>}
          </>
        )}
      </div>
      <footer className="flex flex-wrap gap-2 border-t border-[var(--sk-rule)] p-3">
        <button type="button" className="sk-btn" onClick={() => onPoint(id)}><Compass className="h-3.5 w-3.5" /> Point telescope</button>
        <button type="button" className="sk-btn" aria-pressed={routingFrom === id} onClick={() => onRouteFrom(id)} data-testid="sk-route-from"><Navigation className="h-3.5 w-3.5" /> {routingFrom === id ? 'Pick the destination…' : 'Route from here'}</button>
        <button type="button" className="sk-btn" onClick={() => onOpen(id)}><ExternalLink className="h-3.5 w-3.5" /> Open</button>
        <button type="button" className="sk-btn" aria-pressed={adding} onClick={() => setAdding((v) => !v)} data-testid="sk-add-toggle"><Plus className="h-3.5 w-3.5" /> New star from here</button>
        {adding && (
          <div className="flex w-full gap-2">
            <input className="sk-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addStar(); }} placeholder="Name the new idea" aria-label="New star's title" data-testid="sk-add-title" maxLength={200} autoFocus />
            <button type="button" className="sk-btn sk-btn-gold" onClick={() => { void addStar(); }} disabled={busy || !newTitle.trim()} data-testid="sk-add-go">{busy ? 'Adding…' : 'Add'}</button>
          </div>
        )}
      </footer>
    </aside>
  );
}

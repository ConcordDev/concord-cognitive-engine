'use client';

/**
 * The open card. Front and back on one card you can flip: the back carries
 * what it claims, its sources, the check receipt claim by claim, what it is
 * built on and what is built on it, and why it sits on its shelf. Beside it:
 * the owner's actions (design, sources, check, publish, delete), building on
 * it, and the cards that connect to it, each with the reason.
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Layers, Link2, Palette, PenLine, RotateCw, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { CardFace } from './CardFace';
import { Designer } from './Designer';
import { BINDER_CHANGED, SHELF, bd, changed, says, writeAddress, type Back, type Card, type Connection } from './bd';

export function CardStage({ id, onFuse }: { id: string; onFuse: (card: Card) => void }) {
  const [card, setCard] = useState<Card | null>(null);
  const [back, setBack] = useState<Back | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [designing, setDesigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await bd<{ card: Card; back: Back }>('card-get', { id });
    if (!r.ok || !r.result) { setErr(says(r)); return; }
    setCard(r.result.card); setBack(r.result.back);
  }, [id]);
  useEffect(() => { setCard(null); setBack(null); setErr(null); setFlipped(false); setDesigning(false); setMsg(null); void load(); }, [load]);
  useEffect(() => {
    let live = true;
    setConns(null);
    void bd<{ connections: Connection[] }>('card-connections', { id }).then((r) => { if (live) setConns(r.result?.connections || []); });
    return () => { live = false; };
  }, [id]);
  useEffect(() => { const f = () => void load(); window.addEventListener(BINDER_CHANGED, f); return () => window.removeEventListener(BINDER_CHANGED, f); }, [load]);

  const act = async (name: string, input: Record<string, unknown>, done: (r: unknown) => string) => {
    setBusy(name); setMsg(null);
    const r = await bd(name, { id, ...input });
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: done(r.result) } : { ok: false, text: says(r) });
    if (r.ok) { changed(); await load(); }
    return r;
  };

  if (err) return <div className="bd-panel p-6"><p className="bd-error" role="alert">{err}</p><button type="button" className="bd-btn mt-3" onClick={() => writeAddress({ card: null })}><ArrowLeft className="h-4 w-4" /> Back to the binder</button></div>;
  if (!card || !back) return <div className="grid gap-6 md:grid-cols-[360px_minmax(0,1fr)]" role="status" aria-label="Opening the card"><div className="bd-skeleton" /><div className="bd-skeleton !aspect-auto h-64" /></div>;

  const shelf = SHELF[card.shelf];
  const remix = async () => {
    const title = window.prompt('Name the new card that builds on this one', `${card.title} (remix)`);
    if (!title) return;
    setBusy('remix');
    const r = await bd<{ card: Card }>('card-remix', { id, title });
    setBusy(null);
    if (r.ok && r.result) { changed(); writeAddress({ card: r.result.card.id }); } else setMsg({ ok: false, text: says(r) });
  };
  const del = async () => {
    if (!window.confirm(`Delete “${card.title}”? It leaves your binder for good.`)) return;
    try { await api.delete(`/api/dtus/${encodeURIComponent(id)}`); changed(); writeAddress({ card: null }); }
    catch { setMsg({ ok: false, text: 'It could not be deleted.' }); }
  };

  return (
    <div className="bd-rise" data-testid="bd-stage">
      <button type="button" className="bd-btn mb-4" onClick={() => writeAddress({ card: null })}><ArrowLeft className="h-4 w-4" /> Binder</button>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* the card */}
        <div className="flex flex-col items-center gap-3">
          <div className="bd-flip" data-back={flipped}>
            <div className="bd-flip-inner">
              <div className="bd-face"><CardFace card={card} size="stage" /></div>
              <div className="bd-face bd-face-back" aria-hidden={!flipped}>
                <CardBack card={card} back={back} />
              </div>
            </div>
          </div>
          <button type="button" className="bd-btn" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped} data-testid="bd-flip"><RotateCw className="h-4 w-4" /> {flipped ? 'The front' : 'The back'}</button>
        </div>

        {/* what you can do with it */}
        <div className="space-y-6">
          <div>
            <p className="bd-label" style={{ color: shelf.ink }}>{shelf.label} · {card.shelfReason}</p>
            <h2 className="bd-title mt-1 text-[34px] leading-[1.05]" data-testid="bd-card-title">{card.title}</h2>
            {card.summary && <p className="mt-2 max-w-[60ch] text-[15px] text-[color:var(--bd-ink-2)]">{card.summary}</p>}
            <p className="bd-mono mt-2 text-[12px] text-[color:var(--bd-muted)]">
              {card.isMine ? 'Yours' : card.owner === 'system' ? 'From Concord' : 'Someone’s'} · {card.published ? 'published' : 'private'} · cites {card.cites} · {card.builtOn} built on it
              {card.check ? ` · check: ${card.check.outcome.toLowerCase()}${card.check.current ? '' : ' (text changed since)'}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {card.isMine && <button type="button" className="bd-btn" onClick={() => setDesigning((v) => !v)} aria-expanded={designing}><Palette className="h-4 w-4" /> Design the card</button>}
            {card.isMine && <button type="button" className="bd-btn" onClick={() => setEditing((v) => !v)} aria-expanded={editing}><PenLine className="h-4 w-4" /> Edit the words</button>}
            {card.isMine && card.needsCheck && <button type="button" className="bd-btn" disabled={busy !== null} onClick={() => void act('card-check', {}, (r) => { const x = r as { outcome: string; claims: { result: string }[] }; return `Checked: ${x.outcome.toLowerCase()}. ${x.claims.filter((c) => c.result === 'verified').length} of ${x.claims.filter((c) => c.result !== 'n/a').length} checkable claims verified.`; }).then(() => setFlipped(true))} data-testid="bd-check"><ShieldCheck className="h-4 w-4" /> {busy === 'card-check' ? 'Checking…' : 'Check its claims'}</button>}
            {card.isMine && !card.published && <button type="button" className="bd-btn bd-btn-go" disabled={busy !== null} onClick={() => void act('card-publish', {}, (r) => ((r as { foil: boolean }).foil ? 'Published, with its verified foil.' : 'Published.'))} data-testid="bd-publish"><Upload className="h-4 w-4" /> {busy === 'card-publish' ? 'Publishing…' : 'Publish'}</button>}
            {card.isMine && card.published && <button type="button" className="bd-btn" disabled={busy !== null} onClick={() => void act('card-unpublish', {}, () => 'Taken down: private again.')}>Unpublish</button>}
            <button type="button" className="bd-btn" disabled={busy !== null || card.shelf === 'records' || card.shelf === 'system'} onClick={() => void remix()}><Layers className="h-4 w-4" /> Build on it</button>
            <button type="button" className="bd-btn" disabled={card.shelf === 'records' || card.shelf === 'system'} onClick={() => onFuse(card)} data-testid="bd-to-fuse"><Sparkles className="h-4 w-4" /> To the fusion table</button>
            {card.isMine && <button type="button" className="bd-btn" onClick={() => void del()} aria-label={`Delete ${card.title}`}><Trash2 className="h-4 w-4" /></button>}
          </div>
          {card.isMine && !card.published && back.publishBlock && <p className="text-[13px] text-[color:var(--bd-ink-2)]"><span className="bd-label mr-2">Before publishing</span>{says(back.publishBlock)}</p>}
          {msg && <p className={msg.ok ? 'bd-ok' : 'bd-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}

          {editing && <Words id={id} title={card.title} summary={card.summary} body={back.body} onSaved={() => { setEditing(false); changed(); void load(); }} />}
          {designing && <Designer card={card} onSaved={() => { setDesigning(false); changed(); void load(); }} onClose={() => setDesigning(false)} />}
          {card.isMine && (card.needsCheck || back.sources.length > 0) && <Sources id={id} initial={back.sources} onSaved={() => { changed(); void load(); }} />}

          <section aria-label="Connections">
            <h2 className="bd-title text-[20px]">Connects to</h2>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--bd-muted)]">Cards linked to this one, sharing its sources or its terms. A card from another shelf that shares its terms is a fusion candidate.</p>
            {!conns ? <div className="mt-3 grid grid-cols-3 gap-3" role="status" aria-label="Finding connections">{[0, 1, 2].map((i) => <div key={i} className="bd-skeleton" />)}</div>
              : conns.length === 0 ? <p className="mt-3 text-[14px] text-[color:var(--bd-muted)]">Nothing connects yet. Cards that share sources or terms with this one will show up here.</p>
              : (
                <ul className="mt-3 space-y-2" data-testid="bd-connections">
                  {conns.map((c) => (
                    <li key={c.card.id} className="bd-panel flex items-center gap-3 p-2.5">
                      <button type="button" className="w-[64px] shrink-0" onClick={() => writeAddress({ card: c.card.id })} aria-label={`Open ${c.card.title}`}><CardFace card={c.card} live={false} size="mini" /></button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">{c.card.title}</p>
                        <p className="text-[12px] text-[color:var(--bd-ink-2)]"><Link2 className="mr-1 inline h-3 w-3" />{c.reasons.join(' · ')}</p>
                        <p className="bd-label mt-0.5" style={{ color: SHELF[c.card.shelf].ink }}>{c.relation === 'complement' ? 'Fusion candidate' : c.relation === 'linked' ? 'Linked' : c.relation === 'shared-source' ? 'Same source' : 'Related'} · {SHELF[c.card.shelf].one}</p>
                      </div>
                      {c.relation === 'complement' && <button type="button" className="bd-btn bd-btn-go shrink-0" onClick={() => { onFuse(card); onFuse(c.card); }}><Sparkles className="h-4 w-4" /> Fuse</button>}
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CardBack({ card, back }: { card: Card; back: Back }) {
  const r = back.receipt;
  return (
    <div className="bd-back bd-scroll text-[13px]" data-testid="bd-back">
      <p className="bd-title text-[15px]">{card.title}</p>
      <p className="text-[11.5px] text-[color:var(--bd-stock-muted)]">On {SHELF[card.shelf].label}: {card.shelfReason}.</p>
      {back.claims.length > 0 && (<><h3>Claims</h3><ul className="list-disc space-y-1 pl-4">{back.claims.slice(0, 12).map((c, i) => <li key={i}>{c}</li>)}</ul></>)}
      {back.definitions.length > 0 && (<><h3>Definitions</h3><ul className="list-disc space-y-1 pl-4">{back.definitions.slice(0, 8).map((c, i) => <li key={i}>{c}</li>)}</ul></>)}
      <h3>The check</h3>
      {!r ? <p>{card.needsCheck ? 'Not checked yet.' : 'This card makes no claims that need checking before publishing.'}</p> : (
        <>
          <p><b>{r.outcome}</b>{r.current ? '' : ' · its text changed after this check'} · {new Date(r.checkedAt).toLocaleString()}</p>
          <ul className="mt-1 space-y-1">
            {r.claims.filter((c) => c.result !== 'n/a').slice(0, 14).map((c, i) => (
              <li key={i} className="flex items-start gap-2"><span className="bd-result" data-r={c.result}>{c.result}</span><span className="min-w-0"><span className="block">{c.text}</span><span className="text-[11px] text-[color:var(--bd-stock-muted)]">{c.checker}: {c.detail}</span></span></li>
            ))}
          </ul>
          {r.claims.every((c) => c.result === 'n/a') && <p className="text-[12px] text-[color:var(--bd-stock-muted)]">Nothing on it was checkable (descriptive prose).</p>}
        </>
      )}
      <h3>Sources</h3>
      {back.sources.length ? <ul className="space-y-0.5">{back.sources.map((s) => <li key={s} className="truncate"><a className="underline" href={s} target="_blank" rel="noreferrer noopener">{s}</a></li>)}</ul> : <p>None declared.</p>}
      <h3>Built on</h3>
      {back.parents.length ? <ul>{back.parents.map((p) => <li key={p.id}><button type="button" className="underline" onClick={() => writeAddress({ card: p.id })}>{p.title}</button></li>)}</ul> : <p>Original.</p>}
      {back.children.length > 0 && (<><h3>Built on it</h3><ul>{back.children.map((p) => <li key={p.id}><button type="button" className="underline" onClick={() => writeAddress({ card: p.id })}>{p.title}</button></li>)}</ul></>)}
      {back.tags.length > 0 && <p className="mt-3 text-[11px] text-[color:var(--bd-stock-muted)]">{back.tags.map((t) => `#${t}`).join(' ')}</p>}
    </div>
  );
}

function Sources({ id, initial, onSaved }: { id: string; initial: string[]; onSaved: () => void }) {
  const [rows, setRows] = useState<string[]>(initial.length ? initial : ['']);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    const sources = rows.map((u) => u.trim()).filter(Boolean).map((url) => ({ url }));
    const r = await bd('card-sources', { id, sources });
    setMsg(r.ok ? { ok: true, text: `${sources.length} source${sources.length === 1 ? '' : 's'} saved.` } : { ok: false, text: says(r) });
    if (r.ok) onSaved();
  };
  return (
    <section className="bd-panel p-3" aria-label="Sources">
      <p className="bd-label mb-2">Sources (links an empirical claim stands on)</p>
      {rows.map((u, i) => (
        <div key={i} className="mb-1.5 flex gap-2">
          <input className="bd-input" inputMode="url" placeholder="https://…" value={u} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Source ${i + 1}`} />
          <button type="button" className="bd-btn !px-2.5" aria-label={`Remove source ${i + 1}`} onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : ['']))}><X className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className="bd-btn" onClick={() => setRows((r) => [...r, ''])}>Add a source</button>
        <button type="button" className="bd-btn bd-btn-go" onClick={() => void save()}><Check className="h-4 w-4" /> Save sources</button>
      </div>
      {msg && <p className={`${msg.ok ? 'bd-ok' : 'bd-error'} mt-2`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </section>
  );
}

function Words({ id, title, summary, body, onSaved }: { id: string; title: string; summary: string; body: string | null; onSaved: () => void }) {
  const [t, setT] = useState(title);
  const [sum, setSum] = useState(summary);
  const [b, setB] = useState(body || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const patch: Record<string, unknown> = {};
      if (t.trim() !== title) patch.title = t.trim();
      if (sum.trim() !== summary) patch.summary = sum.trim();
      if (b !== (body || '')) patch.content = b;
      if (Object.keys(patch).length) {
        const r = await api.patch(`/api/dtus/${encodeURIComponent(id)}`, patch);
        const d = r.data as { ok?: boolean; error?: string } | undefined;
        if (d && d.ok === false) throw new Error(d.error || 'It could not be saved.');
      }
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'It could not be saved.'); }
    setBusy(false);
  };
  return (
    <section className="bd-panel space-y-2 p-3" aria-label="Edit the words">
      <p className="text-[12.5px] text-[color:var(--bd-muted)]">Changing the words means knowledge has to be checked again before it can be published.</p>
      <label className="block"><span className="bd-label">Title</span><input className="bd-input mt-1" maxLength={200} value={t} onChange={(e) => setT(e.target.value)} /></label>
      <label className="block"><span className="bd-label">Summary</span><textarea className="bd-input mt-1 h-20 py-2" maxLength={2000} value={sum} onChange={(e) => setSum(e.target.value)} /></label>
      <label className="block"><span className="bd-label">Body</span><textarea className="bd-input mt-1 h-32 py-2" maxLength={20000} value={b} onChange={(e) => setB(e.target.value)} /></label>
      {err && <p className="bd-error" role="alert">{err}</p>}
      <button type="button" className="bd-btn bd-btn-go" disabled={busy || !t.trim()} onClick={() => void save()} data-testid="bd-words-save">{busy ? 'Saving…' : 'Save'}</button>
    </section>
  );
}

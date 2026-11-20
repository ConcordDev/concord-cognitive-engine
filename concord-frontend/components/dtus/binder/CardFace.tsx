'use client';

/**
 * A card's face, drawn from its owner's design: frame, palette, accent,
 * layout, title typeface, subtitle and art. The shelf colours the band.
 * The foil appears only when the card's claims passed the verification gate
 * on its current text, and it catches the light as the pointer moves.
 */

import { useRef, type CSSProperties } from 'react';
import { SHELF, type Card, type Design } from './bd';

export function CardFace({ card, design, size = 'grid', live = true }: { card: Card; design?: Design; size?: 'grid' | 'stage' | 'mini'; live?: boolean }) {
  const d = design || card.design;
  const ref = useRef<HTMLDivElement>(null);
  const shelf = SHELF[card.shelf];
  const style = { '--shelf': d.accent || shelf.ink, '--frame': d.accent || shelf.ink } as CSSProperties;
  const onMove = (e: React.PointerEvent) => {
    if (!card.foil || !live || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--foil-x', `${Math.round(((e.clientX - r.left) / r.width) * 100)}%`);
  };
  const initial = card.title.trim().slice(0, 1).toUpperCase() || '·';
  const status = card.published ? 'Published' : card.isMine ? 'Yours' : '';
  return (
    <div
      ref={ref}
      className="bd-card"
      data-frame={d.frame}
      data-palette={d.palette}
      data-layout={d.layout}
      data-type={d.typeface}
      data-foil={card.foil}
      data-size={size}
      style={{ ...style, ...(size === 'stage' ? { width: 'min(360px, 80vw)' } : {}) }}
      onPointerMove={onMove}
      aria-label={`${card.title}, ${shelf.one}${card.foil ? ', verified' : ''}`}
    >
      <div className="bd-card-band"><span>{shelf.one}</span><span className="bd-mono opacity-80">{card.domain && card.domain !== 'general' && card.domain !== 'unknown' ? card.domain : card.tier !== 'regular' ? card.tier : ''}</span></div>
      <div className="bd-card-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {card.image ? <img src={card.image} alt="" loading="lazy" /> : <span className="bd-glyph" aria-hidden>{initial}</span>}
      </div>
      <div className="bd-card-text">
        <p className="bd-card-name" style={size === 'stage' ? { fontSize: d.layout === 'text' ? 30 : 22 } : undefined}>{card.title}</p>
        {(d.subtitle || card.summary) && <p className="bd-card-sub line-clamp-2">{d.subtitle || card.summary}</p>}
      </div>
      <div className="bd-card-foot bd-mono">
        <span>{card.foil ? '✦ verified' : card.check?.current ? card.check.outcome.toLowerCase() : card.needsCheck ? 'unchecked' : status}</span>
        <span>{card.builtOn ? `${card.builtOn} built on it` : card.cites ? `cites ${card.cites}` : ''}</span>
      </div>
    </div>
  );
}

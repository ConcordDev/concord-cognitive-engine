'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { KIND_LABEL, LICENSE_LABEL, lotNo, price, type Lot } from './houseApi';

/** A lot as a printed plate: cover, catalogue number, italic title, maker, price. */
export function LotPlate({ lot, onOpen, drawn, size = 'md', className }: { lot: Lot; onOpen: (id: string) => void; drawn?: boolean; size?: 'sm' | 'md'; className?: string }) {
  const [broken, setBroken] = useState(false);
  const sold = lot.status === 'sold';
  return (
    <button
      type="button"
      onClick={() => onOpen(lot.id)}
      className={cn('ah-plate group', className)}
      data-testid="ah-lot"
      data-lot={lot.id}
      aria-label={`Lot ${lotNo(lot.id)}: ${lot.title}, ${price(lot)}${sold ? ', sold' : ''}`}
    >
      <div className="ah-cover">
        {lot.cover && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lot.cover} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <div className="ah-cover-blank" aria-hidden>
            <span className="ah-no text-[12px]">Lot {lotNo(lot.id)}</span>
            <span className={cn('ah-title', size === 'sm' ? 'text-[17px]' : 'text-[21px]')}>{lot.title}</span>
            <span className="ah-label">{lot.domain || KIND_LABEL[lot.kind] || 'DTU'}</span>
          </div>
        )}
        {drawn && <span className="ah-drawn">Drawn this hour</span>}
        {sold && <span className="ah-sold">Sold</span>}
      </div>
      <div className={cn('flex flex-1 flex-col gap-1', size === 'sm' ? 'p-2.5' : 'p-3.5')}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="ah-no text-[12px]">Lot {lotNo(lot.id)}</span>
          <span className="ah-label">{KIND_LABEL[lot.kind] || lot.kind}</span>
        </div>
        <span className={cn('ah-title line-clamp-2', size === 'sm' ? 'text-[16px]' : 'text-[19px]')}>{lot.title}</span>
        <span className="truncate text-[12.5px] ah-muted">by {lot.seller.name || lot.artist || 'a maker'}</span>
        <span className="mt-auto flex items-baseline justify-between gap-2 pt-1.5">
          <span className="ah-num text-[15px] font-semibold ah-oxblood">{price(lot)}</span>
          <span className="text-[11.5px] ah-faint">
            {lot.sold24h > 0 ? `${lot.sold24h} sold today` : lot.sold > 0 ? `${lot.sold} sold` : LICENSE_LABEL[lot.license] || lot.license}
          </span>
        </span>
      </div>
    </button>
  );
}

export function PlateSkeleton() {
  return (
    <div className="ah-plate" aria-hidden>
      <div className="ah-cover ah-skeleton" />
      <div className="space-y-2 p-3.5"><div className="ah-skeleton h-3 w-16" /><div className="ah-skeleton h-5 w-4/5" /><div className="ah-skeleton h-3 w-1/2" /></div>
    </div>
  );
}

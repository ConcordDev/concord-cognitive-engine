'use client';

// Phase E4 — mahjong tile SVG component.
//
// Tile strings:
//   m1..m9 (manzu/characters), p1..p9 (pinzu/circles), s1..s9 (souzu/bamboo),
//   wE/wS/wW/wN (winds), dR/dG/dW (dragons).

interface TileProps {
  tile: string;
  selected?: boolean;
  faceDown?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES = {
  sm: 'w-7 h-10 text-[10px]',
  md: 'w-10 h-14 text-sm',
  lg: 'w-12 h-16 text-base',
};

const WIND_GLYPH: Record<string, string> = { E: '東', S: '南', W: '西', N: '北' };
const DRAGON_GLYPH: Record<string, { glyph: string; color: string }> = {
  R: { glyph: '中', color: 'text-red-600' },
  G: { glyph: '發', color: 'text-emerald-600' },
  W: { glyph: '白', color: 'text-zinc-700' },
};

function renderFace(tile: string) {
  if (/^m\d$/.test(tile)) return <span className="font-bold text-zinc-800">{tile[1]}萬</span>;
  if (/^p\d$/.test(tile)) {
    const n = Number(tile[1]);
    return (
      <span className="font-bold text-blue-700" title={`${n} pin`}>
        {'●'.repeat(Math.min(3, n))}
        {n > 3 && <span className="text-[8px]">+{n - 3}</span>}
      </span>
    );
  }
  if (/^s\d$/.test(tile)) {
    const n = Number(tile[1]);
    return (
      <span className="font-bold text-emerald-700" title={`${n} sou`}>
        {'｜'.repeat(Math.min(3, n))}
        {n > 3 && <span className="text-[8px]">+{n - 3}</span>}
      </span>
    );
  }
  if (/^w[ESWN]$/.test(tile)) {
    return <span className="font-bold text-zinc-700">{WIND_GLYPH[tile[1]]}</span>;
  }
  if (/^d[RGW]$/.test(tile)) {
    const d = DRAGON_GLYPH[tile[1]];
    return <span className={`font-bold ${d.color}`}>{d.glyph}</span>;
  }
  return <span className="text-zinc-400">?</span>;
}

export function Tile({ tile, selected, faceDown, onClick, size = 'md' }: TileProps) {
  const sz = SIZE_CLASSES[size];
  const interactive = onClick != null;
  const base = `${sz} inline-flex items-center justify-center rounded border shadow-sm transition-transform select-none`;
  if (faceDown) {
    return (
      <div className={`${base} border-zinc-700 bg-emerald-900 bg-gradient-to-br from-emerald-800 to-emerald-950`}>
        <span className="opacity-30 text-[8px]">•</span>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={!interactive}
      className={[
        base,
        'border-zinc-300 bg-zinc-50 text-zinc-900',
        interactive ? 'cursor-pointer hover:-translate-y-1 hover:shadow-md' : '',
        selected ? '-translate-y-2 ring-2 ring-amber-400 shadow-lg' : '',
      ].join(' ')}
    >
      {renderFace(tile)}
    </button>
  );
}

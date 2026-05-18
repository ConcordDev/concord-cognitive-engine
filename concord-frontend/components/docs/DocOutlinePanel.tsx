'use client';

import { useMemo } from 'react';
import { ListTree } from 'lucide-react';

interface Props { documentId: string; contentHtml: string; }

interface OutlineItem { level: number; text: string; id: string; }

function extractOutline(html: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const re = /<(h[1-3])>([^<]+)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(html)) !== null) {
    items.push({ level: Number(m[1][1]), text: m[2].trim(), id: `outline-${idx++}` });
  }
  return items;
}

export function DocOutlinePanel({ contentHtml }: Props) {
  const outline = useMemo(() => extractOutline(contentHtml), [contentHtml]);
  if (outline.length === 0) {
    return (
      <div className="p-4 text-center text-white/40 text-sm">
        <ListTree className="w-8 h-8 mx-auto mb-2 opacity-40" />
        Add headings to see an outline here.
      </div>
    );
  }
  return (
    <div className="p-2 space-y-0.5">
      {outline.map((h) => (
        <div
          key={h.id}
          className="text-sm text-white/70 hover:text-white py-0.5 cursor-pointer truncate"
          style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
          title={h.text}
        >
          {h.text}
        </div>
      ))}
    </div>
  );
}

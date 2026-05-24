'use client';

/**
 * FmRichEditor — markdown-aware post composer with formatting toolbar,
 * image-embed URLs and a live preview. Emits { body, format, images }.
 */

import { useRef, useState } from 'react';
import { Bold, Italic, Code, List, Link2, Eye, ImagePlus, X } from 'lucide-react';
import { FmMarkdown } from './fmMarkdown';

export interface RichDraft { body: string; format: 'plain' | 'markdown'; images: string[] }

export function FmRichEditor({
  value, onChange, placeholder = 'Write something…', rows = 4,
}: {
  value: RichDraft;
  onChange: (d: RichDraft) => void;
  placeholder?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [imageUrl, setImageUrl] = useState('');

  const wrap = (before: string, after: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.body.slice(start, end) || 'text';
    const next = value.body.slice(0, start) + before + sel + after + value.body.slice(end);
    onChange({ ...value, body: next, format: 'markdown' });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + sel.length);
    });
  };

  const addImage = () => {
    const u = imageUrl.trim();
    if (!u) return;
    if (value.images.includes(u)) { setImageUrl(''); return; }
    onChange({ ...value, images: [...value.images, u].slice(0, 8) });
    setImageUrl('');
  };

  const removeImage = (u: string) => {
    onChange({ ...value, images: value.images.filter((x) => x !== u) });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap">
        <ToolBtn label="Bold" onClick={() => wrap('**', '**')}><Bold className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn label="Italic" onClick={() => wrap('_', '_')}><Italic className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn label="Code" onClick={() => wrap('`', '`')}><Code className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn label="Bullet" onClick={() => wrap('\n- ', '')}><List className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn label="Link" onClick={() => wrap('[', '](https://)')}><Link2 className="w-3.5 h-3.5" /></ToolBtn>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={value.format === 'markdown'}
            onChange={(e) => onChange({ ...value, format: e.target.checked ? 'markdown' : 'plain' })}
            className="accent-orange-500" />
          Markdown
        </label>
        <button type="button" onClick={() => setPreview((p) => !p)}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-lg ${preview ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>
          <Eye className="w-3 h-3" /> Preview
        </button>
      </div>

      {preview ? (
        <div className="min-h-[64px] bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2">
          {value.body.trim()
            ? <FmMarkdown text={value.body} format={value.format} />
            : <p className="text-[11px] text-zinc-400 italic">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea ref={ref} value={value.body} rows={rows} placeholder={placeholder}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
      )}

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2">
          <ImagePlus className="w-3.5 h-3.5 text-zinc-400" />
          <input placeholder="Embed image URL" value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImage(); } }}
            className="flex-1 bg-transparent py-1.5 text-[11px] text-zinc-100 focus:outline-none" />
        </div>
        <button type="button" onClick={addImage}
          className="px-2.5 py-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Add</button>
      </div>
      {value.images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.images.map((u) => (
            <span key={u} className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-lg pl-2 pr-1 py-0.5">
              <span className="text-[10px] text-zinc-300 max-w-[140px] truncate">{u}</span>
              <button type="button" onClick={() => removeImage(u)} className="text-zinc-400 hover:text-rose-400" aria-label="Remove image">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="p-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
      {children}
    </button>
  );
}

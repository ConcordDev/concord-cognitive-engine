'use client';

/**
 * RichComposer — formatting toolbar + emoji picker + code blocks for the
 * message stream. Pure-presentational: it owns a textarea and applies
 * markdown-style wrapping; the parent owns send + schedule.
 */

import { useRef, useState } from 'react';
import { Bold, Italic, Code, Strikethrough, List, Link2, Smile } from 'lucide-react';

const EMOJIS = ['👍', '❤️', '😂', '🎉', '🙏', '🔥', '👀', '✅', '🚀', '😅', '💯', '👏', '🤔', '😎', '🥳', '💡', '⚡', '✨', '🙌', '😮', '🤝', '📌', '⏰', '☕'];

function wrap(text: string, start: number, end: number, before: string, after: string) {
  const sel = text.slice(start, end);
  const inner = sel || 'text';
  return {
    next: text.slice(0, start) + before + inner + after + text.slice(end),
    cursor: start + before.length + inner.length + after.length,
  };
}

export function RichComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);

  function applyFormat(before: string, after: string) {
    const el = ref.current;
    if (!el) return;
    const { next, cursor } = wrap(value, el.selectionStart, el.selectionEnd, before, after);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function insertAtCursor(snippet: string) {
    const el = ref.current;
    if (!el) { onChange(value + snippet); return; }
    const pos = el.selectionStart;
    const next = value.slice(0, pos) + snippet + value.slice(el.selectionEnd);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos + snippet.length, pos + snippet.length);
    });
  }

  const tools: { icon: typeof Bold; label: string; run: () => void }[] = [
    { icon: Bold, label: 'Bold', run: () => applyFormat('**', '**') },
    { icon: Italic, label: 'Italic', run: () => applyFormat('_', '_') },
    { icon: Strikethrough, label: 'Strikethrough', run: () => applyFormat('~~', '~~') },
    { icon: Code, label: 'Code', run: () => applyFormat('`', '`') },
    { icon: List, label: 'Bullet list', run: () => insertAtCursor('\n- ') },
    { icon: Link2, label: 'Link', run: () => applyFormat('[', '](url)') },
  ];

  return (
    <div className="border border-white/10 rounded bg-lattice-deep">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-white/5 relative">
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.label}
              type="button"
              onClick={t.run}
              title={t.label}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/[0.06]"
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => insertAtCursor('\n```\ncode\n```\n')}
          title="Code block"
          className="px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-400 hover:text-white hover:bg-white/[0.06]"
        >
          {'{ }'}
        </button>
        <div className="ml-auto relative">
          <button
            type="button"
            onClick={() => setShowEmoji((v) => !v)}
            title="Emoji"
            className="p-1 rounded text-gray-400 hover:text-amber-300 hover:bg-white/[0.06]"
          >
            <Smile className="w-3.5 h-3.5" />
          </button>
          {showEmoji && (
            <div className="absolute right-0 bottom-full mb-1 z-20 w-56 grid grid-cols-8 gap-0.5 bg-[#0a0c10] border border-white/10 rounded p-1.5 shadow-lg">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { insertAtCursor(e); setShowEmoji(false); }}
                  className="text-base hover:bg-white/10 rounded"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
        className="w-full px-2 py-1.5 text-xs bg-transparent text-white resize-none focus:outline-none"
      />
    </div>
  );
}

export default RichComposer;

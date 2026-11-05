'use client';

/**
 * Numeric cell that keeps what the member typed.
 *
 * The model-editing grids used to bind inputs straight to
 * `parseFloat(text) || 0` on every keystroke: a typed minus sign
 * (parseFloat('-') is NaN) vanished, and a decimal like 0.02 collapsed
 * through its intermediate states. This cell holds the raw text while
 * the field is being edited, commits each parseable value as it is
 * typed, and on blur reverts visibly-invalid text to the committed
 * value — input is accepted as typed, or the field shows the value it
 * actually holds. Nothing is silently rewritten.
 */

import { useEffect, useRef, useState } from 'react';

export function NumCell({
  value,
  onCommit,
  className,
  ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState<string>(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return (
    <input
      className={className}
      aria-label={ariaLabel}
      inputMode="decimal"
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t);
        if (t.trim() !== '' && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => {
        focused.current = false;
        const n = Number(text);
        if (text.trim() === '' || !Number.isFinite(n)) {
          setText(String(value));
        } else {
          onCommit(n);
          setText(String(n));
        }
      }}
    />
  );
}

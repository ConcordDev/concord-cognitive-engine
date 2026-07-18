'use client';

// components/conkay/artifacts/StepInToggle.tsx
//
// Phase S2-b — the DOM overlay for the "step in" affordance: a small button that
// toggles an artifact adapter between orbit and walk-at-real-scale, plus a
// discoverable controls hint while walking (WASD / drag-look), matching the
// keyboard-discoverability bar in docs/UI_QUALITY_RUBRIC.md §2. Presentational
// only — the adapter owns the `mode` state and feeds it to <StepInControls>
// inside its Canvas; this just renders the control + calls back on toggle.

export function StepInToggle({
  mode,
  onToggle,
  className = '',
}: {
  mode: 'orbit' | 'walk';
  onToggle: () => void;
  className?: string;
}) {
  const walking = mode === 'walk';
  return (
    <div className={`pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        data-testid="ck-step-in-toggle"
        aria-pressed={walking}
        onClick={onToggle}
        className="pointer-events-auto rounded-md border border-cyan-400/30 bg-black/60 px-2 py-1 text-[11px] font-medium text-cyan-200 transition-colors hover:border-cyan-300/60 hover:text-cyan-100"
      >
        {walking ? '↩ Orbit' : 'Step in ⛶'}
      </button>
      {walking && (
        <span
          data-testid="ck-step-in-hint"
          className="pointer-events-none rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-cyan-200/70"
        >
          <kbd className="font-mono">WASD</kbd> move · drag to look
        </span>
      )}
    </div>
  );
}

export default StepInToggle;

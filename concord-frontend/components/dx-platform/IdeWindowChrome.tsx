'use client';

/**
 * IdeWindowChrome — a real IDE-window visual frame (traffic-light dots,
 * title bar, tab strip) for the dx-platform onboarding/marketing page.
 * This product IS an editor extension ("streamed live to your editor" —
 * see the page's own copy), so its landing page should visually read as
 * an editor window rather than a generic marketing card, per the doc's
 * T1 note. Purely presentational chrome — the content inside is real
 * (see JsonSyntaxBlock), this file only supplies the frame around it.
 */

export interface IdeTab {
  label: string;
  active?: boolean;
}

export function IdeWindowChrome({
  title,
  tabs,
  children,
}: {
  title: string;
  tabs: IdeTab[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700/60 bg-[#1e1e1e] shadow-xl">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-black/40 bg-[#323233] px-3 py-2">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="ml-2 truncate text-[11px] text-zinc-400">{title}</span>
      </div>
      {/* Tab strip */}
      <div className="flex items-center gap-0.5 border-b border-black/40 bg-[#252526] px-1">
        {tabs.map((tab) => (
          <div
            key={tab.label}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] ${
              tab.active
                ? 'border-t-2 border-cyan-400 bg-[#1e1e1e] text-zinc-200'
                : 'text-zinc-500'
            }`}
          >
            {tab.label}
          </div>
        ))}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

export default IdeWindowChrome;

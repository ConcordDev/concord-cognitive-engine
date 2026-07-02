// concord-frontend/components/common/PageHeader.tsx
//
// A small shared page-header primitive for the W5 visual-cohesion pass: a
// consistent title / optional subtitle / optional right-aligned actions slot
// so every surface leads with the same heading rhythm (text-2xl bold white
// title, gray-400 subtitle) instead of each page rolling its own.

import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {subtitle != null && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {actions != null && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export default PageHeader;

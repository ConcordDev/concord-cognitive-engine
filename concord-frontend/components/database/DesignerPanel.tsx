'use client';

import { SchemaDesigner } from '@/components/database/SchemaDesigner';

export function DesignerPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <SchemaDesigner />
    </section>
  );
}

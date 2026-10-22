import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Browser tab title for the music studio (overrides the site-wide default). */
export const metadata: Metadata = {
  title: { absolute: 'Concord Studio' },
  description: 'Record, produce, mix and master music in your browser.',
};

export default function StudioLayout({ children }: { children: ReactNode }) {
  return children;
}

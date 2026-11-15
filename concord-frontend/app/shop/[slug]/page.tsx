'use client';

import { useParams } from 'next/navigation';
import { PublicStorefront } from '@/components/retail/PublicStorefront';

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <PublicStorefront slug={(params?.slug as string) || ''} />;
}

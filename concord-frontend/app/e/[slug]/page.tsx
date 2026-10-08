'use client';

import { useParams } from 'next/navigation';
import PublicShareView from '@/components/share/PublicShareView';

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <PublicShareView kind="event" id={(params?.slug as string) || ''} />;
}

'use client';

import { useParams } from 'next/navigation';
import PublicShareView from '@/components/share/PublicShareView';

export default function Page() {
  const params = useParams<{ token: string }>();
  return <PublicShareView kind="experience" id={(params?.token as string) || ''} />;
}

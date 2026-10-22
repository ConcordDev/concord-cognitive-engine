'use client';

import { useParams } from 'next/navigation';
import { LensShell } from '@/components/lens/LensShell';
import { MusicListingPage } from '@/components/marketplace/MusicListingPage';
import { useLensNav } from '@/hooks/useLensNav';

export default function Page() {
  useLensNav('marketplace');
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  return (
    <LensShell lensId="marketplace">
      {id ? <MusicListingPage id={id} /> : null}
    </LensShell>
  );
}

import { redirect } from 'next/navigation';

// The Workbench lives on the design page now: /conkay/designs/<id> loads the
// workbench session when the id is one (its chat starts or resumes it).
export default async function WorkbenchDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/conkay/designs/${id}`);
}

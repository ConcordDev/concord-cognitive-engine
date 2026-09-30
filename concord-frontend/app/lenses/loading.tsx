export default function LensesLoading() {
  return (
    <div className="space-y-4 p-6" role="status" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded bg-white/5" />
      <div className="h-24 animate-pulse rounded bg-white/5" />
      <div className="h-24 animate-pulse rounded bg-white/5" />
      <p className="text-sm text-gray-500">Loading lens…</p>
    </div>
  );
}

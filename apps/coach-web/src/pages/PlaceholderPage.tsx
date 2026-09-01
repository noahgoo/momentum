export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="admin-card p-8">
      <h1 className="font-display text-2xl text-[var(--ink)]">{title}</h1>
      <p className="mt-2 text-sm text-[var(--ink-50)]">This page is coming in a later slice.</p>
    </div>
  );
}

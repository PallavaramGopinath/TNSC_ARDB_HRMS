import type { ReactNode } from 'react';

export function Section({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="card scroll-mt-4 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-700">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** Responsive field grid: 1 column on phones, up to `cols` on wide screens. */
export function Grid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-2 xl:grid-cols-3', 4: 'md:grid-cols-2 xl:grid-cols-4' }[cols];
  return <div className={`grid grid-cols-1 gap-4 ${c}`}>{children}</div>;
}

/** Read-only label/value pair for profile pages. */
export function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-900">{value === null || value === undefined || value === '' ? '—' : value}</dd>
    </div>
  );
}

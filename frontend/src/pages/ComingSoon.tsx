import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

/** Rendered for menu routes whose page has not been ported yet. */
export function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="card flex flex-col items-center gap-2 p-12 text-center">
        <Construction className="text-brand-500" size={32} />
        <p className="font-semibold">Being ported from TNCU_GAMS</p>
        <p className="max-w-md text-sm text-ink-500">The menu entry, permissions and API route group exist; the screen lands in a later step.</p>
      </div>
    </>
  );
}

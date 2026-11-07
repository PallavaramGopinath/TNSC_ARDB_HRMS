import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { iconFor } from '@/components/layout/icons';
import { useAuth } from '@/hooks/useAuth';
import { menuApi } from '@/services/menu';

export function DashboardPage() {
  const { user } = useAuth();
  const { data: menu = [] } = useQuery({ queryKey: ['menu'], queryFn: menuApi.tree });
  const modules = menu.filter((m) => m.moduleKey !== 'home');

  return (
    <>
      <PageHeader title={`Welcome, ${user?.fullName ?? ''}`} subtitle="Tamil Nadu Co-operative State Agriculture & Rural Development Bank — HR & Payroll" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => {
          const Icon = iconFor(m.icon);
          const first = m.subs[0]?.route ?? m.subs[0]?.forms[0]?.route ?? '/';
          const count = m.subs.reduce((n, s) => n + (s.route ? 1 : 0) + s.forms.length, 0);
          return (
            <Link key={m.id} to={first} className="card flex items-start gap-4 p-5 transition-shadow hover:shadow-md">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon size={22} /></div>
              <div>
                <p className="font-semibold text-ink-900">{m.title}</p>
                <p className="text-sm text-ink-500">{count} {count === 1 ? 'screen' : 'screens'}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

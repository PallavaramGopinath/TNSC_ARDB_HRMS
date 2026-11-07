import { useQuery } from '@tanstack/react-query';
import { CalendarDays, MapPin } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { menuApi } from '@/services/menu';

/** TNCU TopBarStatus: application (business) date, locked branch badge, user + roles. */
export function TopBar() {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['context'], queryFn: menuApi.context, staleTime: 5 * 60_000 });
  const bd = data?.businessDate ? new Date(data.businessDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const initials = user?.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <header className="flex h-14 items-center justify-between border-b border-ink-200 bg-white px-6">
      <div className="flex items-center gap-4 text-sm text-ink-600">
        <span className="inline-flex items-center gap-1.5"><CalendarDays size={16} className="text-brand-600" /> Application date <b className="text-ink-900">{bd}</b></span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
          <MapPin size={12} /> {user?.branchType === 'HO' ? 'Head Office' : `Branch #${user?.branchId}`}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-semibold text-ink-900">{user?.fullName}</p>
          <p className="text-xs text-ink-500">{user?.roles.join(' · ') || 'No roles'}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{initials}</div>
      </div>
    </header>
  );
}

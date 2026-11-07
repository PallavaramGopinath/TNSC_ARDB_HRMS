import clsx from 'clsx';
import { ChevronDown, LogOut, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { MenuMain } from '@/types/api';
import { useAuth } from '@/hooks/useAuth';
import { iconFor } from './icons';

/**
 * TNCU NavMenu layout: a narrow icon rail (one icon per module) + a side panel showing the
 * selected module's groups and forms, with search. Driven entirely by GET /api/core/menu, so a
 * new module (EPF Trust) appears here once its menu rows are active and the user holds a grant.
 */
export function Sidebar({ menu }: { menu: MenuMain[] }) {
  const { signOut } = useAuth();
  const location = useLocation();
  const owning = useMemo(
    () => menu.find((m) => m.subs.some((s) => matches(s.route, location.pathname) || s.forms.some((f) => matches(f.route, location.pathname)))),
    [menu, location.pathname],
  );
  const [activeId, setActiveId] = useState<number | undefined>(owning?.id ?? menu[0]?.id);
  const [query, setQuery] = useState('');
  useEffect(() => { if (owning) setActiveId(owning.id); }, [owning]);

  const active = menu.find((m) => m.id === activeId) ?? menu[0];
  const q = query.trim().toLowerCase();

  return (
    <aside className="flex h-screen shrink-0">
      {/* Rail */}
      <nav className="flex w-16 flex-col items-center gap-1 bg-ink-900 py-3" aria-label="Modules">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">A</div>
        {menu.map((m) => {
          const Icon = iconFor(m.icon);
          return (
            <button
              key={m.id}
              type="button"
              title={m.title}
              aria-label={m.title}
              aria-current={m.id === active?.id}
              onClick={() => setActiveId(m.id)}
              className={clsx(
                'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                m.id === active?.id ? 'bg-brand-600 text-white' : 'text-ink-300 hover:bg-ink-800 hover:text-white',
              )}
            >
              <Icon size={20} />
            </button>
          );
        })}
        <div className="flex-1" />
        <button type="button" title="Sign out" aria-label="Sign out" onClick={() => void signOut()} className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-800 hover:text-white">
          <LogOut size={18} />
        </button>
      </nav>

      {/* Panel */}
      <div className="flex w-64 flex-col border-r border-ink-200 bg-white">
        <div className="border-b border-ink-100 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">TNSC ARDB</p>
          <p className="text-base font-bold text-ink-900">{active?.title ?? 'Menu'}</p>
          <div className="relative mt-3">
            <Search size={14} className="absolute left-2.5 top-2.5 text-ink-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search menu" className="field-input py-1.5 pl-8 text-xs" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {active?.subs.map((s) => {
            const forms = s.forms.filter((f) => !q || f.title.toLowerCase().includes(q));
            if (s.route) {
              if (q && !s.title.toLowerCase().includes(q)) return null;
              return <NavItem key={s.id} to={s.route} label={s.title} icon={s.icon} />;
            }
            if (forms.length === 0) return null;
            return <Group key={s.id} title={s.title} icon={s.icon} forceOpen={!!q}>{forms.map((f) => <NavItem key={f.id} to={f.route} label={f.title} nested />)}</Group>;
          })}
        </div>
      </div>
    </aside>
  );
}

function matches(route: string | null, path: string) {
  if (!route) return false;
  return route === '/' ? path === '/' : path === route || path.startsWith(route + '/');
}

function Group({ title, icon, children, forceOpen }: { title: string; icon: string | null; children: React.ReactNode; forceOpen: boolean }) {
  const [open, setOpen] = useState(true);
  const Icon = iconFor(icon);
  const isOpen = open || forceOpen;
  return (
    <div className="mb-1">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500 hover:bg-ink-50" aria-expanded={isOpen}>
        <Icon size={14} />
        <span className="flex-1 text-left">{title}</span>
        <ChevronDown size={14} className={clsx('transition-transform', !isOpen && '-rotate-90')} />
      </button>
      {isOpen && <div className="mt-0.5">{children}</div>}
    </div>
  );
}

function NavItem({ to, label, icon, nested }: { to: string; label: string; icon?: string | null; nested?: boolean }) {
  const Icon = icon ? iconFor(icon) : null;
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          nested && 'pl-8',
          isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700 hover:bg-ink-50',
        )
      }
    >
      {Icon && <Icon size={16} />}
      {label}
    </NavLink>
  );
}

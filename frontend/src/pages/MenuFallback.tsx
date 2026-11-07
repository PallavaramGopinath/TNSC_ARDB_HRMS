import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { menuApi } from '@/services/menu';
import { ComingSoonPage } from './ComingSoon';
import { NotFoundPage } from './NotFound';

/** Unmatched path: if it is a known menu route show "coming soon", otherwise 404. */
export function MenuFallback() {
  const { pathname } = useLocation();
  const { data: menu = [] } = useQuery({ queryKey: ['menu'], queryFn: menuApi.tree });
  for (const m of menu)
    for (const s of m.subs) {
      if (s.route === pathname) return <ComingSoonPage title={s.title} />;
      const f = s.forms.find((x) => x.route === pathname);
      if (f) return <ComingSoonPage title={f.title} />;
    }
  return <NotFoundPage />;
}

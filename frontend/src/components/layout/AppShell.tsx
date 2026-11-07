import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { menuApi } from '@/services/menu';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const { data: menu = [], isLoading } = useQuery({ queryKey: ['menu'], queryFn: menuApi.tree, staleTime: 5 * 60_000 });
  return (
    <div className="flex h-screen overflow-hidden">
      {isLoading ? <div className="w-80 bg-white" /> : <Sidebar menu={menu} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

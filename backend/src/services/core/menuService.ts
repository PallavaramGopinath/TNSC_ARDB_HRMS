import { db } from '../../config/db';
import type { AuthUser } from '../../models/auth';
import { ModuleIds } from '../../models/auth';
import type { BranchCode } from '../../models/db.types';

export interface MenuFormNode { id: number; title: string; route: string }
export interface MenuSubNode { id: number; title: string; icon: string | null; route: string | null; forms: MenuFormNode[] }
export interface MenuMainNode { id: number; moduleKey: string; title: string; icon: string | null; subs: MenuSubNode[] }

/**
 * Menu tree for the caller (TNCU MenuService.GetTreeAsync):
 *  - every level filtered by branch_code against the caller's branch type
 *  - Admin sees every active main
 *  - others: Home, mains they hold a module grant for, and role-matched self-service mains
 */
export async function getMenuTree(user: AuthUser): Promise<MenuMainNode[]> {
  const branchOk = (code: BranchCode) => code === 'ALL' || (user.branchType === 'HO' ? code === 'HO' : code === 'BRANCH') || user.isAdmin;

  const [mains, subs, forms] = await Promise.all([
    db.selectFrom('core.menu_mains').selectAll().where('is_active', '=', true).orderBy('display_order').execute(),
    db.selectFrom('core.menu_subs').selectAll().where('is_active', '=', true).orderBy('display_order').execute(),
    db.selectFrom('core.menu_forms').selectAll().where('is_active', '=', true).orderBy('display_order').execute(),
  ]);

  const visibleMain = (m: (typeof mains)[number]) => {
    if (!branchOk(m.branch_code)) return false;
    if (user.isAdmin) return true;
    if (m.id === ModuleIds.Home) return true;
    if (user.modules[String(m.id)]) return true;
    const required = (m.required_role ?? '').split(',').map((r) => r.trim()).filter(Boolean);
    // Self-service style mains: visible by role alone (no module grant needed).
    return m.id === ModuleIds.SelfService && required.some((r) => user.roles.includes(r as never));
  };

  return mains.filter(visibleMain).map((m) => ({
    id: m.id,
    moduleKey: m.module_key,
    title: m.title,
    icon: m.icon,
    subs: subs
      .filter((s) => s.main_id === m.id && branchOk(s.branch_code))
      .map((s) => ({
        id: s.id,
        title: s.title,
        icon: s.icon,
        route: s.route,
        forms: forms.filter((f) => f.sub_id === s.id && branchOk(f.branch_code)).map((f) => ({ id: f.id, title: f.title, route: f.route })),
      }))
      .filter((s) => s.route !== null || s.forms.length > 0),
  }));
}

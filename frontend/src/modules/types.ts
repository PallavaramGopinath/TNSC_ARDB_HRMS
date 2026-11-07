import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * A frontend module contributes routes; the sidebar comes from the server menu tree.
 * To add EPF Trust pages: add entries to modules/epf.tsx — no change to the shell.
 */
export interface ModuleRoute {
  path: string;
  element: LazyExoticComponent<ComponentType> | ComponentType;
}

export interface FrontendModule {
  key: string;
  menuId: number;
  routes: ModuleRoute[];
}

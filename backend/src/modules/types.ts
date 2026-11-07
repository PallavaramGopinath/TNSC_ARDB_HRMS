import type { Router } from 'express';

/**
 * A pluggable business module. To add one (e.g. EPF Trust):
 *  1. create modules/<key>.module.ts exporting an AppModule
 *  2. add it to MODULES in modules/registry.ts
 *  3. add its key to MODULES_ENABLED, its tables to a migration in the <key> schema,
 *     and its menu main/subs/forms to database/seed.sql
 */
export interface AppModule {
  key: string;            // URL segment and schema name: /api/<key>
  title: string;
  menuId: number;         // core.menu_mains.id — drives mod:{menuId} grants
  headOfficeOnly: boolean;
  buildRouter: () => Router;
}

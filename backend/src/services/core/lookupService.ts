import { db } from '../../config/db';

export const listBranches = () =>
  db.selectFrom('core.branches').select(['id', 'code', 'name', 'type', 'place_id', 'is_active']).where('is_active', '=', true).orderBy('type').orderBy('name').execute();

export const listPlaceCategories = () =>
  db.selectFrom('core.place_categories').select(['id', 'code', 'name']).where('is_active', '=', true).orderBy('display_order').orderBy('name').execute();

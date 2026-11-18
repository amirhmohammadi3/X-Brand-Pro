import { requireUser } from '@/lib/auth/guard';
import { AdminRevenueDashboard } from '@/components/admin/admin-revenue-dashboard';

/** `/admin/revenue` (F8.4) — the admin revenue dashboard.
 *
 * Visible to admins/super_admin (the businesses.manage permission gates the
 * API endpoint; the route guard mirrors it). The range selector + the
 * byPurpose/byPlan tables re-fetch client-side.
 */
export default async function AdminRevenuePage() {
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/revenue' });
  return <AdminRevenueDashboard />;
}

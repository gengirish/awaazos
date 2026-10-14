import { notFound } from "next/navigation";

import { AdminInviteCreate, AdminInviteRevoke, AdminRemove } from "@/components/admin/AdminTeamControls";
import { AdminNav } from "@/components/admin/AdminNav";
import { Badge } from "@/components/ui/badge";
import { ADMIN_INVITE_TTL_DAYS, listPendingAdminInvites, listPlatformAdmins } from "@/lib/admin-invites";
import { formatIstDate } from "@/lib/datetime";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admins — AwaazOS" };

/**
 * /admin/admins — SUPER_ADMIN only (404 for anyone else). Invite people to run
 * outreach as platform ADMIN, void pending invites, and remove admins
 * (lib/admin-invites.ts).
 */
export default async function AdminsPage() {
  let me: string;
  try {
    me = (await requirePlatformRole("SUPER_ADMIN")).user.id;
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const [admins, invites] = await Promise.all([listPlatformAdmins(), listPendingAdminInvites()]);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to admins
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Platform admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Admins</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An admin can build demo stores, make claim links, delete unclaimed demo stores and see the weekly metrics.
          Only super admins see every store, give free access and manage admins.
        </p>
        <AdminNav current="/admin/admins" superAdmin />
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-8">
        <section aria-labelledby="invite-heading" className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
          <h2 id="invite-heading" className="text-lg font-semibold text-foreground">
            Invite an admin
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You get a one-time link, valid {ADMIN_INVITE_TTL_DAYS} days, to send them yourself. They choose their own
            password, or sign in if that email already has an account.
          </p>
          <div className="mt-4">
            <AdminInviteCreate />
          </div>
        </section>

        <section aria-labelledby="admins-heading">
          <h2 id="admins-heading" className="mb-3 text-lg font-semibold text-foreground">
            Current admins
          </h2>
          <ul className="space-y-3">
            {admins.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{a.name || a.email}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {a.email} · since {formatIstDate(a.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={a.role === "SUPER_ADMIN" ? "default" : "outline"}>
                    {a.role === "SUPER_ADMIN" ? "Super admin" : "Admin"}
                  </Badge>
                  {a.role === "ADMIN" && a.id !== me ? <AdminRemove userId={a.id} label={a.name || a.email} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="mb-3 text-lg font-semibold text-foreground">
            Pending invites
          </h2>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invites waiting.</p>
          ) : (
            <ul className="space-y-3">
              {invites.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{inv.email}</p>
                    <p className="text-sm text-muted-foreground">
                      Sent {formatIstDate(inv.createdAt)}, works until {formatIstDate(inv.expiresAt)}
                    </p>
                  </div>
                  <AdminInviteRevoke inviteId={inv.id} email={inv.email} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

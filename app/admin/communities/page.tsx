import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminNav } from "@/components/admin/AdminNav";
import { CommunityCreateForm } from "@/components/admin/CommunityCreateForm";
import { CommunityMembers } from "@/components/admin/CommunityMembers";
import { EmptyState } from "@/components/ui/empty-state";
import { listAdminCommunities } from "@/lib/community-server";
import { formatIstDate } from "@/lib/datetime";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin community pages — AwaazOS" };

/**
 * Community pages (lib/community.ts): one public page per housing society that
 * links to the stores of the home kitchens living there. Any platform ADMIN
 * makes them and invites stores; owners accept in their own Settings.
 */
export default async function AdminCommunitiesPage() {
  let superAdmin: boolean;
  try {
    const { user } = await requirePlatformRole("ADMIN");
    superAdmin = user.role === "SUPER_ADMIN";
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const communities = await listAdminCommunities();

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to community pages
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Platform admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Community pages</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          One page per housing society that links to its home kitchens&apos; stores. A store shows on the page once
          its owner accepts the invite in Settings → Online store and its store page is published.
        </p>
        <AdminNav current="/admin/communities" superAdmin={superAdmin} />
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-8">
        <section aria-labelledby="new-community" className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
          <h2 id="new-community" className="font-display text-lg font-semibold">
            New community page
          </h2>
          <div className="mt-4">
            <CommunityCreateForm />
          </div>
        </section>

        <section aria-labelledby="community-list">
          <h2 id="community-list" className="sr-only">
            Community pages
          </h2>
          {communities.length === 0 ? (
            <EmptyState title="No community pages yet" description="Create one above for a society you work with." />
          ) : (
            <ul className="space-y-4">
              {communities.map((c) => {
                const listed = c.members.filter(
                  (m) => m.acceptedAt && m.vendor.isActive && m.vendor.settings?.publishStorefront,
                ).length;
                return (
                  <li key={c.id} className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
                    <h3 className="font-semibold text-foreground">{c.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {c.area ? `${c.area} · ` : ""}Made {formatIstDate(c.createdAt)} · {listed} listed of{" "}
                      {c.members.length}
                    </p>
                    <Link
                      href={`/c/${encodeURIComponent(c.slug)}`}
                      className="inline-flex min-h-11 items-center font-mono text-sm text-primary underline underline-offset-4"
                    >
                      /c/{c.slug}
                    </Link>
                    <div className="mt-3">
                      <CommunityMembers
                        communityId={c.id}
                        communityName={c.name}
                        members={c.members.map((m) => ({
                          vendorId: m.vendor.id,
                          name: m.vendor.name,
                          slug: m.vendor.slug,
                          accepted: m.acceptedAt !== null,
                          hidden: !m.vendor.isActive || !m.vendor.settings?.publishStorefront,
                        }))}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

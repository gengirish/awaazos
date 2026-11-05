import { notFound } from "next/navigation";

import Link from "next/link";

import { AdminNav } from "@/components/admin/AdminNav";
import { PipelineClient } from "@/components/admin/pipeline/PipelineClient";
import { StoreHealthLine } from "@/components/admin/StoreHealthLine";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { DEMO_PIPELINE_LIMIT } from "@/lib/admin-demo-stores";
import { loadPipelineItems } from "@/lib/demo-pipeline-server";
import { AuthError, requirePlatformRole } from "@/lib/rbac";
import { demoVendorIdsBuiltBy } from "@/lib/sales-scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin demo stores — AwaazOS" };

export default async function AdminDemoStoresPage() {
  // Role read from the database, 404 rather than 403. Any platform ADMIN runs
  // outreach here; SUPER_ADMIN additionally sees the store and admin pages. A
  // SALES user sees only the stores they built and can't delete them.
  let superAdmin: boolean;
  let isSales: boolean;
  let userId: string;
  let senderName: string | null;
  try {
    const { user } = await requirePlatformRole("SALES");
    superAdmin = user.role === "SUPER_ADMIN";
    isSales = user.role === "SALES";
    userId = user.id;
    senderName = user.name;
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const now = new Date();
  const items = await loadPipelineItems(isSales ? await demoVendorIdsBuiltBy(`admin:${userId}`) : undefined, now);

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <Toaster richColors position="top-center" />
      <a href="#demo-stores" className="sr-only focus:not-sr-only">
        Skip to demo stores
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Platform admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Demo-store pipeline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isSales ? "Every store you built" : "Every store built"} for a prospect, and what to do next to get it claimed.
        </p>
        <AdminNav current="/admin/demo-stores" superAdmin={superAdmin} sales={isSales} />
        <Button asChild className="mt-4">
          <Link href="/admin/demo-stores/new">Build a demo store</Link>
        </Button>
      </header>

      <main id="main" className="mx-auto max-w-3xl">
        <PipelineClient
          items={items}
          now={now}
          canDelete={!isSales}
          isSales={isSales}
          sender={{ senderName, senderIsFounder: superAdmin }}
          healthLines={Object.fromEntries(items.map((i) => [i.id, <StoreHealthLine key={i.id} health={i.health} now={now} />]))}
        />
        {items.length === DEMO_PIPELINE_LIMIT ? (
          <p className="mt-4 text-sm text-muted-foreground">Showing the newest {DEMO_PIPELINE_LIMIT} demo stores.</p>
        ) : null}
      </main>
    </div>
  );
}

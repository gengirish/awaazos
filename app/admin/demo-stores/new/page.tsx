import Link from "next/link";
import { notFound } from "next/navigation";

import { DemoStoreForm } from "@/components/admin/DemoStoreForm";
import { AuthError, requirePlatformRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata = { title: "Build a demo store — AwaazOS" };

/** /admin/demo-stores/new — any platform ADMIN builds a prospect's demo store (lib/demo-store-form.ts). */
export default async function NewDemoStorePage() {
  try {
    await requirePlatformRole("ADMIN");
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-10 md:p-6">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to the form
      </a>
      <header className="mx-auto mb-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal · Outreach</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Build a demo store</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A store with the seller&apos;s dishes and sample orders, owned by the internal demo account until they claim
          it. Nothing is sent to the seller, and payments always go to demo@upi.
        </p>
        <nav aria-label="Admin" className="mt-2">
          <Link
            href="/admin/demo-stores"
            className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            Demo-store pipeline
          </Link>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-3xl">
        <DemoStoreForm />
      </main>
    </div>
  );
}

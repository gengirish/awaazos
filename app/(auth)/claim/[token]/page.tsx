import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { loadClaim } from "@/lib/demo-store";
import { DEMO_CLAIM_TTL_DAYS } from "@/lib/demo-store-schema";

import { ClaimStoreForm } from "./_components/ClaimStoreForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Claim your store · AwaazOS", robots: { index: false, follow: false } };

/**
 * /claim/<token>: a prospect takes over the demo store built for them
 * (lib/demo-store.ts). Public; the token is the whole credential. Unknown,
 * used and expired links look the same.
 */
export default async function ClaimStorePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const claim = token.length >= 16 && token.length <= 256 ? await loadClaim(token) : null;

  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      {claim ? (
        <ClaimStoreForm token={token} email={claim.email} storeName={claim.storeName} />
      ) : (
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold leading-none tracking-tight">Invalid or expired link</h1>
            <CardDescription>
              This link has already been used or has expired. Links work once, for {DEMO_CLAIM_TTL_DAYS} days.
              Ask the person who sent it for a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/sign-in"
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
            >
              Go to sign in
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

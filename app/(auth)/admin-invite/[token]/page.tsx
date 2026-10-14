import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ADMIN_INVITE_TTL_DAYS, loadAdminInvite, plausibleInviteToken } from "@/lib/admin-invites";
import { auth } from "@/lib/auth";

import { AdminInviteForm } from "./_components/AdminInviteForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join the AwaazOS outreach team", robots: { index: false, follow: false } };

const LINK_CLASS = "inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline";

/**
 * /admin-invite/<token>: someone a SUPER_ADMIN invited becomes a platform ADMIN
 * (lib/admin-invites.ts). Public; the token is the whole credential. Unknown,
 * used and expired links look the same.
 */
export default async function AdminInvitePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const invite = plausibleInviteToken(token) ? await loadAdminInvite(token) : null;
  const session = invite ? await auth() : null;
  const signedInEmail = session?.user?.email?.toLowerCase() ?? null;
  const callback = encodeURIComponent(`/admin-invite/${token}`);

  let body: React.ReactNode;
  if (!invite) {
    body = (
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">Invalid or expired link</h1>
          <CardDescription>
            This link has already been used or has expired. Links work once, for {ADMIN_INVITE_TTL_DAYS} days. Ask
            the person who sent it for a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sign-in" className={LINK_CLASS}>
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  } else if (signedInEmail === invite.email) {
    body = <AdminInviteForm mode="accept" token={token} email={invite.email} />;
  } else if (signedInEmail) {
    body = (
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">This invite is for another account</h1>
          <CardDescription>
            It was sent to <span className="font-medium text-foreground">{invite.email}</span>, but you are signed in
            as <span className="font-medium text-foreground">{signedInEmail}</span>. Sign out, then open the link
            again.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  } else if (invite.hasAccount) {
    body = (
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">Join the outreach team</h1>
          <CardDescription>
            <span className="font-medium text-foreground">{invite.email}</span> already has an AwaazOS account. Sign
            in with it to accept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/sign-in?callbackUrl=${callback}`} className={LINK_CLASS}>
            Sign in to accept
          </Link>
        </CardContent>
      </Card>
    );
  } else {
    body = <AdminInviteForm mode="create" token={token} email={invite.email} />;
  }

  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      {body}
    </main>
  );
}

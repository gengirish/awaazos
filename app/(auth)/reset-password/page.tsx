import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { ResetPasswordForm } from "./_components/ResetPasswordForm";

export const metadata = { title: "Reset password · AwaazOS" };

/**
 * Server component on purpose: reading the token from `searchParams` here
 * avoids `useSearchParams()`, which needs a <Suspense> boundary or
 * `next build` fails with the CSR-bailout error (see .cursor/rules/auth-rbac.mdc).
 */
export default async function ResetPasswordPage(
  props: {
    searchParams: Promise<{ token?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const token = typeof searchParams.token === "string" ? searchParams.token.trim() : "";

  if (!token) {
    return (
      <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Invalid or expired link</CardTitle>
            <CardDescription>
              This reset link is missing its token, has already been used, or has
              expired. Links are valid for 30 minutes and can be used once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary hover:underline"
            >
              Request a new link
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      <ResetPasswordForm token={token} />
      <p className="text-center text-xs text-muted-foreground">
        Back to{" "}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          sign in
        </Link>
      </p>
    </main>
  );
}

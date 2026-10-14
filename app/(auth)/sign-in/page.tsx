"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HOME_PATH } from "@/lib/home";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // An explicit callbackUrl (a deep link, or the page middleware bounced) wins;
  // otherwise the landing resolver picks the screen (lib/home.ts).
  const callbackUrl = searchParams.get("callbackUrl") || HOME_PATH;
  // ResetPasswordForm sends people here with ?reset=ok.
  const passwordReset = searchParams.get("reset") === "ok";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    let res: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      res = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
        callbackUrl,
      });
    } catch {
      res = undefined;
    }
    if (!res) {
      setError("No connection. Try again.");
      setSubmitting(false);
      return;
    }
    if (res.error) {
      // "Configuration" is Auth.js for "authorize() threw" (the database, not the password).
      setError(
        res.error === "Configuration" ? "Could not sign you in right now. Try again." : "Invalid email or password.",
      );
      setSubmitting(false);
      return;
    }
    router.push(res.url || callbackUrl);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md border-border/80 shadow-lg">
      <CardHeader>
        {/* <h1>, not CardTitle (an <h3>): this is the page's only heading. */}
        <h1 className="font-display text-2xl font-semibold leading-none tracking-tight">Sign in</h1>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {passwordReset && !error ? (
            <p className="text-sm font-medium text-foreground" role="status">
              Password updated. Sign in with your new password.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              enterKeyHint="go"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            {/* 44px hit area; -my-2 gives most of the extra height back to the layout. */}
            <Link
              href="/forgot-password"
              className="-my-2 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Button type="submit" className="w-full sm:w-auto" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <Button variant="ghost" asChild className="w-full sm:w-auto">
            <Link href="/sign-up">Create an account</Link>
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-muted/30 p-4">
      <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
        <SignInForm />
      </Suspense>
    </main>
  );
}

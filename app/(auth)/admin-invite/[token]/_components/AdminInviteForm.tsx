"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";

const LANDING = "/admin/demo-stores";

const ERRORS: Record<string, string> = {
  invalid_or_expired: "This link has already been used or has expired. Ask for a new one.",
  email_in_use: "An AwaazOS account already uses this email. Sign in with it, then open the link again.",
};

type Props = { mode: "create" | "accept"; token: string; email: string };

/**
 * "create": no account for the invited email yet — choose a name and password.
 * "accept": signed in as the invited email — one tap.
 */
export function AdminInviteForm({ mode, token, email }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "create" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(mode === "create" ? "/api/admin-invite" : "/api/admin-invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "create" ? { token, name, password } : { token }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      if (!res.ok) {
        setError(json.reason ?? ERRORS[json.error ?? ""] ?? "Could not accept the invite. Try again.");
        setSubmitting(false);
        return;
      }
      if (mode === "create") {
        const signedIn = await signIn("credentials", { email, password, redirect: false, callbackUrl: LANDING });
        router.push(signedIn && !signedIn.error ? LANDING : "/sign-in");
      } else {
        router.push(LANDING);
      }
      router.refresh();
    } catch {
      setError("No connection. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold leading-none tracking-tight">Join the outreach team</h1>
        <CardDescription>
          You&apos;ve been invited to build demo stores for prospects on AwaazOS.{" "}
          {mode === "create" ? (
            <>
              Choose a password. You&apos;ll sign in as <span className="font-medium text-foreground">{email}</span>.
            </>
          ) : (
            <>
              Accept as <span className="font-medium text-foreground">{email}</span>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {mode === "create" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters, using two of: lowercase, uppercase, digits or symbols.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  enterKeyHint="go"
                  minLength={8}
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </>
          ) : null}

          {error ? (
            <Notice role="alert" aria-live="assertive" tone="danger">
              {error}
            </Notice>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || (mode === "create" && (!name.trim() || !password || !confirm))}
          >
            {submitting ? "Joining…" : mode === "create" ? "Create my account" : "Accept invite"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

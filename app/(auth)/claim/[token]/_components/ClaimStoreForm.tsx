"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { HOME_PATH } from "@/lib/home";

const ERRORS: Record<string, string> = {
  invalid_or_expired: "This link has already been used or has expired. Ask for a new one.",
  email_in_use: "An AwaazOS account already uses this email. Ask for the link to be sent to another email.",
};

export function ClaimStoreForm({ token, email, storeName }: { token: string; email: string; storeName: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sampleOrders, setSampleOrders] = useState<"archive" | "delete">("archive");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/demo-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password, sampleOrders }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      if (!res.ok) {
        setError(json.reason ?? ERRORS[json.error ?? ""] ?? "Could not claim the store. Try again.");
        setSubmitting(false);
        return;
      }
      const signedIn = await signIn("credentials", { email, password, redirect: false, callbackUrl: HOME_PATH });
      router.push(signedIn && !signedIn.error ? HOME_PATH : "/sign-in");
      router.refresh();
    } catch {
      setError("No connection. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold leading-none tracking-tight">Claim {storeName}</h1>
        <CardDescription>
          This store was set up for you. Choose a password to make it yours. You&apos;ll sign in as{" "}
          <span className="font-medium text-foreground">{email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Sample orders</legend>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="radio"
                name="sampleOrders"
                value="archive"
                checked={sampleOrders === "archive"}
                onChange={() => setSampleOrders("archive")}
                disabled={submitting}
                className="size-4"
              />
              Hide them from my orders
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="radio"
                name="sampleOrders"
                value="delete"
                checked={sampleOrders === "delete"}
                onChange={() => setSampleOrders("delete")}
                disabled={submitting}
                className="size-4"
              />
              Delete them
            </label>
          </fieldset>

          {error ? (
            <Notice role="alert" aria-live="assertive" tone="danger">
              {error}
            </Notice>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting || !name.trim() || !password || !confirm}>
            {submitting ? "Claiming…" : "Claim my store"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

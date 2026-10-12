"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STALL_TYPES } from "@/lib/constants";
import { HOME_PATH } from "@/lib/home";
import type { StallType } from "@prisma/client";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // A new store still has setup to finish, so the landing resolver sends it
  // to /onboarding (lib/home.ts). An explicit callbackUrl still wins.
  const callbackUrl = searchParams.get("callbackUrl") || HOME_PATH;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stallName, setStallName] = useState("");
  const [stallType, setStallType] = useState<StallType>("GENERAL");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email: email.trim().toLowerCase(),
        password,
        stallName,
        stallType,
        phone: phone.trim() || undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };

    if (!res.ok) {
      setError(data.error || "Could not create account.");
      setSubmitting(false);
      return;
    }

    const sign = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
      callbackUrl,
    });
    if (!sign || sign.error) {
      setError("Account created but sign-in failed. Try signing in manually.");
      setSubmitting(false);
      return;
    }
    router.push(sign.url || callbackUrl);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md border-border/80 shadow-lg">
      <CardHeader>
        {/* <h1>, not CardTitle (an <h3>): this is the page's only heading. */}
        <h1 className="font-display text-2xl font-semibold leading-none tracking-tight">Create your stall</h1>
        <CardDescription>One account — your vendor workspace on AwaazOS.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="max-h-[70dvh] space-y-4 overflow-y-auto pr-1">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              name="name"
              required
              autoComplete="name"
              autoCapitalize="words"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              required
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password (min 8 characters)</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stallName">Stall / shop name</Label>
            <Input
              id="stallName"
              name="stallName"
              required
              autoComplete="organization"
              autoCapitalize="words"
              value={stallName}
              onChange={(e) => setStallName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Stall type</Label>
            <Select value={stallType} onValueChange={(v) => setStallType(v as StallType)}>
              <SelectTrigger aria-label="Stall type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {STALL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone (optional, +91)</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="done"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Button type="submit" className="w-full sm:w-auto" disabled={submitting}>
            {submitting ? "Creating…" : "Sign up"}
          </Button>
          <Button variant="ghost" asChild className="w-full sm:w-auto">
            <Link href="/sign-in">Already have an account</Link>
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function SignUpPage() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-muted/30 p-4">
      <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
        <SignUpForm />
      </Suspense>
    </main>
  );
}

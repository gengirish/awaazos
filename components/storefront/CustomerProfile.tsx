"use client";

import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIndianMobile, normaliseIndianMobile } from "@/lib/phone";


export type CustomerProfileProps = {
  email: string;
  name: string | null;
  phone: string | null;
  savedAddress: string | null;
};

/** Signed-in buyer's own details. Saved to their Customer row only. */
export function CustomerProfile(props: CustomerProfileProps) {
  const router = useRouter();
  const [name, setName] = useState(props.name ?? "");
  const [phone, setPhone] = useState(formatIndianMobile(props.phone));
  const [address, setAddress] = useState(props.savedAddress ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setStatus(null);
    setSaving(true);
    try {
      const res = await fetch("/api/s/customer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone: normaliseIndianMobile(phone), savedAddress: address }),
      });
      if (res.ok) {
        setStatus({ kind: "ok", text: "Saved." });
        router.refresh();
      } else if (res.status === 400) {
        const json = (await res.json().catch(() => null)) as { issues?: { message?: string }[] } | null;
        setStatus({ kind: "error", text: json?.issues?.[0]?.message ?? "Please check your details." });
      } else if (res.status === 401) {
        setStatus({ kind: "error", text: "You've been signed out. Please sign in again." });
        router.refresh();
      } else {
        setStatus({ kind: "error", text: "Couldn't save. Please try again." });
      }
    } catch {
      setStatus({ kind: "error", text: "Couldn't connect — check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Signed in as <span className="font-semibold text-foreground">{props.email}</span>
      </p>

      <div className="space-y-2">
        <Label htmlFor="profile-name">Name</Label>
        <Input
          id="profile-name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-phone">Mobile number</Label>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-11 items-center rounded-md border border-input bg-muted px-3 font-mono text-sm text-muted-foreground"
            aria-hidden="true"
          >
            +91
          </span>
          <Input
            id="profile-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={16}
            className="h-11"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-address">Delivery address</Label>
        <textarea
          id="profile-address"
          autoComplete="street-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={500}
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div aria-live="polite" className="min-h-5">
        {status ? (
          <p
            role={status.kind === "error" ? "alert" : undefined}
            className={status.kind === "error" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-green-700"}
          >
            {status.text}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={saving}
        aria-busy={saving}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        Save details
      </button>
    </form>
  );
}

export function CustomerSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/s/customer/logout", { method: "POST" });
    } catch {
      /* cookie may survive a network failure; refresh shows the truth */
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      Sign out
    </button>
  );
}

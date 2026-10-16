"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Check, CheckCircle2, Mic, Plus, X } from "lucide-react";

import { PushAlertsButton } from "@/components/push/PushAlertsButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQrDataUrl } from "@/hooks/useQrDataUrl";
import { STALL_TYPES } from "@/lib/constants";
import { formatINR } from "@/lib/currency";
import { HOME_PATH } from "@/lib/home";
import { STALL_TYPE_OTHER_MAX, STALL_TYPE_OTHER_MESSAGE, stallTypeOtherSchema } from "@/lib/stall-type";
import { buildUpiDeepLink, isValidUpiId, UPI_ID_FORMAT_MESSAGE } from "@/lib/upi";
import { cn } from "@/lib/utils";
import type { StallType, Vendor, VendorSettings } from "@prisma/client";

import {
  draftToBulkItem,
  initialStateName,
  isBlankDraft,
  MAX_DRAFT_ITEMS,
  ONBOARDING_STEPS,
  resumeStep,
  STEP_COUNT,
  validateItemDraft,
  type ItemDraft,
} from "./onboarding-steps";

type VendorPayload = Vendor & { settings: VendorSettings | null };

type SavedItem = { id: string; name: string; priceInPaise: number };

/** Field id → message. The id is the input's `id`; its error is `<id>-error`. */
type FieldErrors = Record<string, string>;

type Phase = "loading" | "load-failed" | "form" | "done";

/**
 * Per-tab note of where the seller is (step number and the "speak my menu"
 * choice only — every answer is saved on the server when they tap Next). It
 * lets a reload reopen a step that was skipped rather than the one before it.
 */
const progressKey = (vendorId: string) => `awz_onboarding_v1:${vendorId}`;

function readProgress(vendorId: string): { step?: number; speakMenu?: boolean } {
  try {
    const raw = window.sessionStorage.getItem(progressKey(vendorId));
    return raw ? (JSON.parse(raw) as { step?: number; speakMenu?: boolean }) : {};
  } catch {
    return {};
  }
}

function writeProgress(vendorId: string, value: { step: number; speakMenu: boolean } | null) {
  try {
    if (value) window.sessionStorage.setItem(progressKey(vendorId), JSON.stringify(value));
    else window.sessionStorage.removeItem(progressKey(vendorId));
  } catch {
    /* private mode or storage full: the saved data still decides the step */
  }
}

let draftSeq = 0;
function blankDraft(): ItemDraft {
  draftSeq += 1;
  return { key: `d${draftSeq}`, name: "", priceRupees: "" };
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** `aria-invalid` + `aria-describedby` for an input, from its error and an optional hint id. */
function fieldAria(id: string, errors: FieldErrors, hintId?: string) {
  const error = errors[id];
  const ids = [error ? `${id}-error` : null, hintId ?? null].filter(Boolean).join(" ");
  return { "aria-invalid": error ? true : undefined, "aria-describedby": ids || undefined };
}

function StepProgress({ step }: { step: number }) {
  return (
    <nav aria-label="Setup progress">
      <ol className="flex gap-2">
        {ONBOARDING_STEPS.map((s, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li key={s.title} aria-current={current ? "step" : undefined} className="min-w-0 flex-1">
              <span
                aria-hidden="true"
                className={cn("block h-1.5 rounded-full", done || current ? "bg-primary" : "bg-muted")}
              />
              <span
                className={cn(
                  "mt-1.5 flex items-start gap-1 text-xs",
                  current ? "font-bold text-foreground" : "text-muted-foreground",
                )}
              >
                {done ? <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                <span>
                  <span className="sr-only">Step {n}: </span>
                  {s.title}
                  <span className="sr-only">{done ? " (done)" : current ? " (current step)" : " (not started)"}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-muted-foreground">
        Step {step} of {STEP_COUNT}
      </p>
    </nav>
  );
}

function LoadingSkeleton() {
  const bar = "rounded-md bg-muted motion-safe:animate-pulse";
  return (
    <main id="main" aria-busy="true" className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-4 pb-12 pt-8">
      <p role="status" className="sr-only">
        Loading setup…
      </p>
      <div className={cn(bar, "h-9 w-56")} />
      <div className="flex gap-2">
        {ONBOARDING_STEPS.map((s) => (
          <div key={s.title} className={cn(bar, "h-1.5 flex-1")} />
        ))}
      </div>
      <div className="space-y-4 rounded-lg border p-6">
        <div className={cn(bar, "h-6 w-40")} />
        <div className={cn(bar, "h-4 w-64 max-w-full")} />
        <div className={cn(bar, "h-11 w-full")} />
        <div className={cn(bar, "h-11 w-full")} />
        <div className={cn(bar, "h-11 w-full")} />
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  /** A failure that belongs to no single field (network, server). */
  const [formError, setFormError] = useState<string | null>(null);

  const [vendorId, setVendorId] = useState("");
  const [slug, setSlug] = useState("");

  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [stallType, setStallType] = useState<StallType>("GENERAL");
  const [stallTypeOther, setStallTypeOther] = useState("");

  const [upiId, setUpiId] = useState("");
  const [upiName, setUpiName] = useState("");
  /** What the server holds, so clearing a saved value is sent and an untouched blank is not. */
  const [savedUpiId, setSavedUpiId] = useState("");

  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [drafts, setDrafts] = useState<ItemDraft[]>(() => [blankDraft()]);

  // "Speak your whole menu": skip typing items here and land on
  // /menu?voice=1 (voice menu builder open) once setup is saved.
  const [speakMenu, setSpeakMenu] = useState(false);

  const [whatsapp, setWhatsapp] = useState("");
  const [savedWhatsapp, setSavedWhatsapp] = useState("");

  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Set when the screen changes because of a tap, so focus follows; never on first paint. */
  const focusHeading = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, menuRes] = await Promise.all([fetch("/api/vendor"), fetch("/api/menu")]);
        if (res.status === 401) {
          router.replace("/sign-in?callbackUrl=/onboarding");
          return;
        }
        if (!res.ok) {
          throw new Error("Could not load vendor");
        }
        const data = (await res.json()) as { vendor: VendorPayload };
        // The menu only decides which step to reopen on; without it setup still works.
        const menu = menuRes.ok ? ((await menuRes.json()) as { data?: SavedItem[] }).data ?? [] : [];
        if (cancelled) return;
        const v = data.vendor;
        if (v.onboardingDone) {
          router.replace(HOME_PATH);
          return;
        }
        const progress = readProgress(v.id);
        setVendorId(v.id);
        setSlug(v.slug);
        setCity(v.city ?? "");
        setStateName(initialStateName(v.city, v.state));
        setStallType(v.stallType);
        setStallTypeOther(v.stallTypeOther ?? "");
        setUpiId(v.upiId ?? "");
        setSavedUpiId(v.upiId ?? "");
        setUpiName(v.upiName ?? v.name);
        setWhatsapp(v.settings?.whatsappNumber ?? v.phone ?? "");
        setSavedWhatsapp(v.settings?.whatsappNumber ?? "");
        setSavedItems(menu.map((m) => ({ id: m.id, name: m.name, priceInPaise: m.priceInPaise })));
        setSpeakMenu(progress.speakMenu === true);
        setStep(resumeStep({ city: v.city, upiId: v.upiId, itemCount: menu.length, storedStep: progress.step }));
        setPhase("form");
      } catch {
        if (!cancelled) setPhase("load-failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // After Next / Back / Finish, move focus to the new screen's heading so a
  // screen-reader or keyboard user is not left on a button that changed.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  }, [step, phase]);

  const previewLink = useMemo(() => {
    if (!isValidUpiId(upiId) || !upiName.trim()) return "";
    try {
      return buildUpiDeepLink({
        upiId: upiId.trim(),
        name: upiName.trim(),
        amountRupees: 1,
        billRef: "AWZ-PREVIEW",
      });
    } catch {
      return "";
    }
  }, [upiId, upiName]);

  const qrSrc = useQrDataUrl(previewLink, 220);

  function goTo(nextStep: number, speak = speakMenu) {
    setErrors({});
    setFormError(null);
    focusHeading.current = true;
    setStep(nextStep);
    if (vendorId) writeProgress(vendorId, { step: nextStep, speakMenu: speak });
  }

  /** Show the errors under their fields and put the cursor in the first one. */
  function reject(found: FieldErrors) {
    setErrors(found);
    setFormError(null);
    const first = Object.keys(found)[0];
    if (first) document.getElementById(first)?.focus();
  }

  function clearError(id: string) {
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
  }

  async function patchVendor(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/vendor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      setFormError(
        res.status === 403
          ? "Only the store owner can finish setup. Ask them to sign in."
          : "Couldn't save that. Check the details and try again.",
      );
      return false;
    } catch {
      setFormError("Couldn't save. Check your internet and try again.");
      return false;
    }
  }

  // ── Step saves: each returns true when the step is stored and we may move on ──

  async function saveStore(): Promise<boolean> {
    const found: FieldErrors = {};
    if (!city.trim()) found.city = "Enter your city.";
    if (!stateName.trim()) found.state = "Enter your state.";
    if (stallType === "OTHER" && !stallTypeOtherSchema.safeParse(stallTypeOther).success) {
      found.stallTypeOther = STALL_TYPE_OTHER_MESSAGE;
    }
    if (Object.keys(found).length) {
      reject(found);
      return false;
    }
    return patchVendor({
      city: city.trim(),
      state: stateName.trim(),
      stallType,
      ...(stallType === "OTHER" ? { stallTypeOther } : {}),
    });
  }

  async function savePayment(): Promise<boolean> {
    const id = upiId.trim();
    if (!id) {
      // Left empty = skipped. Only tell the server when that clears a saved ID.
      if (!savedUpiId) return true;
      if (!(await patchVendor({ upiId: "" }))) return false;
      setSavedUpiId("");
      return true;
    }
    const found: FieldErrors = {};
    if (!isValidUpiId(id)) found.upiId = UPI_ID_FORMAT_MESSAGE;
    if (!upiName.trim()) found.upiName = "Enter the name customers will see when they pay.";
    if (Object.keys(found).length) {
      reject(found);
      return false;
    }
    if (!(await patchVendor({ upiId: id, upiName: upiName.trim() }))) return false;
    setSavedUpiId(id);
    return true;
  }

  async function saveItems(): Promise<boolean> {
    if (speakMenu) return true;
    const typed = drafts.filter((d) => !isBlankDraft(d));
    if (typed.length === 0) {
      if (savedItems.length > 0) return true;
      reject({ [`item-${drafts[0]!.key}-name`]: "Add one item, or tap Skip for now." });
      return false;
    }
    const found: FieldErrors = {};
    for (const d of typed) {
      const e = validateItemDraft(d);
      if (e.name) found[`item-${d.key}-name`] = e.name;
      if (e.price) found[`item-${d.key}-price`] = e.price;
    }
    if (Object.keys(found).length) {
      reject(found);
      return false;
    }
    try {
      const res = await fetch("/api/menu/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: typed.map(draftToBulkItem) }),
      });
      if (!res.ok) {
        setFormError(
          res.status === 429
            ? "Too many saves in a row. Wait a moment and try again."
            : "Couldn't save your items. Check them and try again.",
        );
        return false;
      }
      const body = (await res.json()) as { data?: { created?: SavedItem[] } };
      const created = (body.data?.created ?? []).map((m) => ({ id: m.id, name: m.name, priceInPaise: m.priceInPaise }));
      // Saved rows leave the form, so going Back and Next again cannot add them twice.
      setSavedItems((prev) => [...prev, ...created]);
      setDrafts([blankDraft()]);
      return true;
    } catch {
      setFormError("Couldn't save. Check your internet and try again.");
      return false;
    }
  }

  async function next() {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const ok = step === 1 ? await saveStore() : step === 2 ? await savePayment() : await saveItems();
    setSaving(false);
    if (ok) goTo(step + 1);
  }

  /** Steps 2 and 3 only: move on without saving or checking what is typed. */
  function skip() {
    if (saving) return;
    goTo(step + 1);
  }

  function back() {
    if (saving) return;
    goTo(Math.max(step - 1, 1));
  }

  async function finish() {
    if (saving) return;
    const raw = whatsapp.trim();
    const body: Record<string, unknown> = { onboardingDone: true };
    if (raw) {
      const parsed = parsePhoneNumberFromString(raw, "IN");
      if (!parsed?.isValid() || parsed.country !== "IN") {
        reject({ wa: "Enter a valid Indian mobile number, or leave this empty." });
        return;
      }
      body.whatsappNumber = parsed.format("E.164");
    } else if (savedWhatsapp) {
      body.whatsappNumber = null;
    }

    setSaving(true);
    setFormError(null);
    const ok = await patchVendor(body);
    if (!ok) {
      setSaving(false);
      return;
    }
    writeProgress(vendorId, null);
    if (speakMenu) {
      router.push("/menu?voice=1");
      router.refresh();
      return;
    }
    setSaving(false);
    focusHeading.current = true;
    setPhase("done");
  }

  function updateDraft(key: string, patch: Partial<ItemDraft>) {
    setDrafts((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function chooseSpeakMenu(on: boolean) {
    setErrors({});
    setFormError(null);
    setSpeakMenu(on);
    if (vendorId) writeProgress(vendorId, { step, speakMenu: on });
  }

  if (phase === "loading") return <LoadingSkeleton />;

  if (phase === "load-failed") {
    return (
      <main id="main" className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-4 pt-8">
        <h1 className="font-display text-3xl font-bold text-primary">Set up your store</h1>
        <Notice tone="danger" role="alert">
          We couldn&apos;t load your store details. Check your internet and try again.
        </Notice>
        <Button type="button" className="self-start" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </main>
    );
  }

  if (phase === "done") {
    const storePath = `/s/${encodeURIComponent(slug)}`;
    return (
      <main id="main" className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-4 pb-12 pt-8">
        <div>
          <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden="true" />
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 font-display text-3xl font-bold text-primary focus-visible:outline-hidden"
          >
            Your store is ready
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Next, put up a drop: what you&apos;re making, how many, and when orders close.
          </p>
        </div>

        <section aria-labelledby="store-link-heading" className="rounded-lg border bg-card p-4">
          <h2 id="store-link-heading" className="text-sm font-semibold">
            Your store link
          </h2>
          <p className="mt-1 break-all font-mono text-sm">
            {window.location.host}
            {storePath}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            This link is not public yet. Nobody can open it until you publish your store. You&apos;ll be asked when
            you open your first drop, or you can publish it in Settings → Online store. After that, put it in your
            Instagram bio.
          </p>
        </section>

        <div className="flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href="/drops/new">Create your first drop</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            {/* /home only redirects (lib/home.ts): nothing to prefetch. */}
            <Link href={HOME_PATH} prefetch={false}>
              Go to the counter
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  const current = ONBOARDING_STEPS[step - 1]!;
  const lastStep = step === STEP_COUNT;

  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-4 pb-12 pt-8">
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-bold text-primary">Set up your store</h1>
        <StepProgress step={step} />
      </div>

      <Card>
        <CardHeader>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold leading-none tracking-tight focus-visible:outline-hidden"
          >
            {current.title}
          </h2>
          <CardDescription>{current.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  autoComplete="address-level2"
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value);
                    clearError("city");
                  }}
                  {...fieldAria("city", errors)}
                />
                <FieldError id="city" message={errors.city} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  autoComplete="address-level1"
                  value={stateName}
                  onChange={(e) => {
                    setStateName(e.target.value);
                    clearError("state");
                  }}
                  {...fieldAria("state", errors)}
                />
                <FieldError id="state" message={errors.state} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stallType">Store type</Label>
                <Select value={stallType} onValueChange={(v) => setStallType(v as StallType)}>
                  <SelectTrigger id="stallType">
                    <SelectValue />
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
              {stallType === "OTHER" ? (
                <div className="space-y-2">
                  <Label htmlFor="stallTypeOther">Describe your business</Label>
                  <Input
                    id="stallTypeOther"
                    maxLength={STALL_TYPE_OTHER_MAX}
                    placeholder="Pickles & podis"
                    value={stallTypeOther}
                    onChange={(e) => {
                      setStallTypeOther(e.target.value);
                      clearError("stallTypeOther");
                    }}
                    {...fieldAria("stallTypeOther", errors)}
                  />
                  <FieldError id="stallTypeOther" message={errors.stallTypeOther} />
                </div>
              ) : null}
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="upiId">UPI ID (optional)</Label>
                <Input
                  id="upiId"
                  placeholder="you@okaxis"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={upiId}
                  onChange={(e) => {
                    setUpiId(e.target.value);
                    clearError("upiId");
                  }}
                  {...fieldAria("upiId", errors, "upiId-hint")}
                />
                <FieldError id="upiId" message={errors.upiId} />
                <p id="upiId-hint" className="text-sm text-muted-foreground">
                  The ID you already use in GPay, PhonePe or Paytm.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="upiName">Name shown on UPI screen</Label>
                <Input
                  id="upiName"
                  value={upiName}
                  onChange={(e) => {
                    setUpiName(e.target.value);
                    clearError("upiName");
                  }}
                  {...fieldAria("upiName", errors)}
                />
                <FieldError id="upiName" message={errors.upiName} />
              </div>
              {qrSrc ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/40 p-4">
                  <p className="text-xs text-muted-foreground">Preview (₹1 test link)</p>
                  <Image src={qrSrc} alt="UPI QR preview" width={220} height={220} unoptimized className="rounded-md" />
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Skip for now — you can take pay on delivery or add it later.
              </p>
            </>
          )}

          {step === 3 && speakMenu && (
            <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="flex items-start gap-2 text-sm font-medium">
                <Mic className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  After the last step you&apos;ll land on your Menu with the mic ready. Say each item and its price,
                  check the list, then save.
                </span>
              </p>
              <Button type="button" variant="outline" onClick={() => chooseSpeakMenu(false)}>
                Type items instead
              </Button>
            </div>
          )}

          {step === 3 && !speakMenu && (
            <div className="space-y-4">
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">Got a long list? Say it all at once instead of typing.</p>
                <Button type="button" variant="outline" className="shrink-0" onClick={() => chooseSpeakMenu(true)}>
                  <Mic aria-hidden="true" />
                  Speak your whole menu
                </Button>
              </div>

              {savedItems.length > 0 ? (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Saved to your menu
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {savedItems.map((it) => (
                      <li key={it.id} className="flex justify-between gap-3">
                        <span className="min-w-0 break-words">{it.name}</span>
                        <span className="shrink-0 font-mono">{formatINR(it.priceInPaise)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">You can edit these later in Menu.</p>
                </div>
              ) : null}

              {drafts.map((it, idx) => {
                const nameId = `item-${it.key}-name`;
                const priceId = `item-${it.key}-price`;
                const n = savedItems.length + idx + 1;
                return (
                  <fieldset key={it.key} className="space-y-3 rounded-lg border p-3">
                    <legend className="px-1 text-sm font-medium">Item {n}</legend>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                      <div className="space-y-1">
                        <Label htmlFor={nameId}>Name</Label>
                        <Input
                          id={nameId}
                          value={it.name}
                          onChange={(e) => {
                            updateDraft(it.key, { name: e.target.value });
                            clearError(nameId);
                          }}
                          {...fieldAria(nameId, errors)}
                        />
                        <FieldError id={nameId} message={errors[nameId]} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={priceId}>Price (₹)</Label>
                        <Input
                          id={priceId}
                          inputMode="decimal"
                          value={it.priceRupees}
                          onChange={(e) => {
                            updateDraft(it.key, { priceRupees: e.target.value });
                            clearError(priceId);
                          }}
                          {...fieldAria(priceId, errors)}
                        />
                        <FieldError id={priceId} message={errors[priceId]} />
                      </div>
                    </div>
                    {drafts.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setDrafts((prev) => prev.filter((row) => row.key !== it.key));
                          clearError(nameId);
                          clearError(priceId);
                        }}
                      >
                        <X aria-hidden="true" />
                        Remove<span className="sr-only"> item {n}</span>
                      </Button>
                    ) : null}
                  </fieldset>
                );
              })}

              {drafts.length < MAX_DRAFT_ITEMS ? (
                <Button type="button" variant="outline" onClick={() => setDrafts((prev) => [...prev, blankDraft()])}>
                  <Plus aria-hidden="true" />
                  Add another item
                </Button>
              ) : null}
            </div>
          )}

          {step === 4 && (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium">Alerts on this phone</p>
                <p className="text-sm text-muted-foreground">
                  A notification for every new order, even when the screen is locked. You can turn it on later in
                  Settings → Notifications.
                </p>
                <div className="flex flex-col gap-2">
                  <PushAlertsButton variant="settings" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa">WhatsApp number (optional)</Label>
                <Input
                  id="wa"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={whatsapp}
                  onChange={(e) => {
                    setWhatsapp(e.target.value);
                    clearError("wa");
                  }}
                  {...fieldAria("wa", errors, "wa-hint")}
                />
                <FieldError id="wa" message={errors.wa} />
                <p id="wa-hint" className="text-sm text-muted-foreground">
                  So customers can message you about an order. They only see it after you turn that on in Settings.
                </p>
              </div>
            </>
          )}

          {formError ? (
            <Notice tone="danger" role="alert">
              {formError}
            </Notice>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="outline" onClick={back} disabled={step === 1 || saving}>
            Back
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            {step === 2 || (step === 3 && !speakMenu) ? (
              <Button type="button" variant="ghost" onClick={skip} disabled={saving}>
                Skip for now
              </Button>
            ) : null}
            {lastStep ? (
              <Button type="button" onClick={finish} disabled={saving}>
                {saving ? "Saving…" : speakMenu ? "Finish & speak your menu" : "Finish setup"}
              </Button>
            ) : (
              <Button type="button" onClick={next} disabled={saving}>
                {saving ? "Saving…" : "Next"}
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </main>
  );
}

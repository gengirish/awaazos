"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Check, CheckCircle2, Keyboard, Mic, Plus, X } from "lucide-react";

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
import { MENU_CHANGED_EVENT } from "@/lib/menu-events";
import { connectOutcomeMessage, razorpayConnectHref } from "@/lib/razorpay-connect";
import { STALL_TYPE_OTHER_MAX, STALL_TYPE_OTHER_MESSAGE, stallTypeOtherSchema } from "@/lib/stall-type";
import { storeVocabulary } from "@/lib/store-vocabulary";
import { buildUpiDeepLink, isValidUpiId, UPI_ID_FORMAT_MESSAGE } from "@/lib/upi";
import { cn } from "@/lib/utils";
import type { StallType, Vendor, VendorSettings } from "@prisma/client";

import {
  draftToBulkItem,
  initialPaymentChoice,
  initialStateName,
  isBlankDraft,
  MAX_DRAFT_ITEMS,
  ONBOARDING_STEPS,
  paymentChoiceProblem,
  progressAfter,
  resumeStep,
  STEP_COUNT,
  stepDescription,
  validateItemDraft,
  type ItemDraft,
} from "./onboarding-steps";

type VendorPayload = Vendor & { settings: VendorSettings | null };

type SavedItem = { id: string; name: string; priceInPaise: number; category: string };

function toSavedItem(m: SavedItem): SavedItem {
  return { id: m.id, name: m.name, priceInPaise: m.priceInPaise, category: m.category };
}

/** What only the server knows about Razorpay (page.tsx). */
export type RazorpayStep = {
  /** The store's own Razorpay can take a payment now: that alone is a way to get paid. */
  connected: boolean;
  /** Connect Razorpay is switched on for AwaazOS and the store's plan includes it. */
  canConnect: boolean;
  /** `?razorpay=` after the Connect flow sent the seller back here. */
  outcome: string | null;
};

// The voice list builder, loaded on the tap that opens it: its review form stays
// out of the setup page's first load (perf-budget.json).
const VoiceMenuPanel = dynamic(() => import("@/components/menu/VoiceMenuPanel").then((m) => m.VoiceMenuPanel), {
  ssr: false,
  loading: () => (
    <p role="status" className="text-sm text-muted-foreground">
      Loading voice…
    </p>
  ),
});

/** Field id → message. The id is the input's `id`; its error is `<id>-error`. */
type FieldErrors = Record<string, string>;

type Phase = "loading" | "load-failed" | "form" | "done";

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

export function OnboardingForm({ razorpay }: { razorpay: RazorpayStep }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  /** A failure that belongs to no single field (network, server). */
  const [formError, setFormError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  /** `Vendor.onboardingStep` as the server holds it. */
  const [savedStep, setSavedStep] = useState<number | null>(null);

  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [stallType, setStallType] = useState<StallType>("GENERAL");
  const [stallTypeOther, setStallTypeOther] = useState("");

  const [upiChosen, setUpiChosen] = useState(true);
  const [upiId, setUpiId] = useState("");
  const [upiName, setUpiName] = useState("");
  /** What the server holds, so clearing a saved value is sent and an untouched blank is not. */
  const [savedUpiId, setSavedUpiId] = useState("");
  const [payOnDelivery, setPayOnDelivery] = useState(false);
  const [leavingForRazorpay, setLeavingForRazorpay] = useState(false);

  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [drafts, setDrafts] = useState<ItemDraft[]>(() => [blankDraft()]);

  /** The voice list builder is open in step 3 (it saves its own rows). */
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceLang, setVoiceLang] = useState("en-IN");
  const micRef = useRef<HTMLButtonElement>(null);
  const voiceToggleRef = useRef<HTMLButtonElement>(null);

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
        setSlug(v.slug);
        setCity(v.city ?? "");
        setStateName(initialStateName(v.city, v.state));
        setStallType(v.stallType);
        setStallTypeOther(v.stallTypeOther ?? "");
        setUpiId(v.upiId ?? "");
        setSavedUpiId(v.upiId ?? "");
        setUpiName(v.upiName ?? v.name);
        // Back from Connect Razorpay: the ticks were saved before leaving.
        const choice = initialPaymentChoice({
          upiId: v.upiId,
          acceptPayOnDelivery: v.settings?.acceptPayOnDelivery ?? true,
          answered: (v.onboardingStep ?? 0) >= 2 || razorpay.outcome != null,
        });
        setUpiChosen(choice.upi);
        setPayOnDelivery(choice.payOnDelivery);
        setVoiceLang(v.settings?.voiceLang ?? "en-IN");
        setWhatsapp(v.settings?.whatsappNumber ?? v.phone ?? "");
        setSavedWhatsapp(v.settings?.whatsappNumber ?? "");
        setSavedItems(menu.map(toSavedItem));
        setSavedStep(v.onboardingStep);
        const resume = resumeStep({ city: v.city, upiId: v.upiId, itemCount: menu.length, savedStep: v.onboardingStep });
        // The Connect flow comes back to the payment step, whatever was done before it.
        setStep(razorpay.outcome != null && v.city?.trim() ? 2 : resume);
        setPhase("form");
      } catch {
        if (!cancelled) setPhase("load-failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Read once: `razorpay` only changes on a new server render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /** Re-read the menu after the voice builder saves rows (it fires MENU_CHANGED_EVENT). */
  const reloadMenu = useCallback(async () => {
    try {
      const res = await fetch("/api/menu");
      if (!res.ok) return;
      const menu = ((await res.json()) as { data?: SavedItem[] }).data ?? [];
      setSavedItems(menu.map(toSavedItem));
      setFormError(null);
    } catch {
      /* the rows are saved; the list shows them after a reload */
    }
  }, []);

  useEffect(() => {
    const onChanged = () => void reloadMenu();
    window.addEventListener(MENU_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MENU_CHANGED_EVENT, onChanged);
  }, [reloadMenu]);

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

  function goTo(nextStep: number) {
    setErrors({});
    setFormError(null);
    focusHeading.current = true;
    setStep(nextStep);
  }

  /**
   * Note on the server that `done` is finished, so setup reopens after it.
   * Best effort: if it fails, a reload reopens an earlier step, nothing worse.
   */
  async function recordProgress(done: number) {
    const value = progressAfter(savedStep, done);
    if (value == null) return;
    try {
      const res = await fetch("/api/vendor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingStep: value }),
      });
      if (res.ok) setSavedStep(value);
    } catch {
      /* offline: the answers themselves are saved */
    }
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

  /**
   * Save step 2's ticks. `requireMethod` is false only on the way out to
   * Razorpay, which is itself the method being added: what is ticked so far is
   * kept, and an empty UPI ID is left for when the seller comes back.
   */
  async function savePayment({ requireMethod = true } = {}): Promise<boolean> {
    const id = upiId.trim();
    const useUpi = upiChosen && Boolean(id);
    const problem = paymentChoiceProblem({ upi: upiChosen, upiId: id, payOnDelivery, online: razorpay.connected });
    const found: FieldErrors = {};
    if (requireMethod && problem === "upi_missing") found.upiId = "Enter your UPI ID, or untick UPI.";
    if (useUpi && !isValidUpiId(id)) found.upiId = UPI_ID_FORMAT_MESSAGE;
    if (useUpi && !upiName.trim()) found.upiName = "Enter the name customers will see when they pay.";
    if (Object.keys(found).length) {
      reject(found);
      return false;
    }
    if (requireMethod && problem === "choose_one") {
      setErrors({});
      setFormError("Choose at least one way customers can pay you.");
      document.getElementById("pay-upi")?.focus();
      return false;
    }
    const body: Record<string, unknown> = { acceptPayOnDelivery: payOnDelivery };
    if (useUpi) {
      body.upiId = id;
      body.upiName = upiName.trim();
    } else if (!upiChosen && savedUpiId) {
      // Unticked: customers stop seeing the saved ID.
      body.upiId = "";
    }
    if (!(await patchVendor(body))) return false;
    if (useUpi) setSavedUpiId(id);
    else if (!upiChosen) setSavedUpiId("");
    return true;
  }

  /** Keep what is ticked, then leave for Razorpay; it sends the seller back to this step. */
  async function connectRazorpay() {
    if (saving || leavingForRazorpay) return;
    setSaving(true);
    setFormError(null);
    if (!(await savePayment({ requireMethod: false }))) {
      setSaving(false);
      return;
    }
    setLeavingForRazorpay(true);
    window.location.assign(razorpayConnectHref("onboarding"));
  }

  async function saveItems(): Promise<boolean> {
    const typed = drafts.filter((d) => !isBlankDraft(d));
    if (typed.length === 0) {
      if (savedItems.length > 0) return true;
      const { item } = storeVocabulary(stallType);
      if (voiceOpen) {
        setFormError(`Save at least one ${item} from your list first, or type one instead.`);
        return false;
      }
      reject({ [`item-${drafts[0]!.key}-name`]: `Add at least one ${item} with its price.` });
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
      const created = (body.data?.created ?? []).map(toSavedItem);
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
    if (ok) await recordProgress(step);
    setSaving(false);
    if (ok) goTo(step + 1);
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
    setSaving(false);
    focusHeading.current = true;
    setPhase("done");
  }

  function updateDraft(key: string, patch: Partial<ItemDraft>) {
    setDrafts((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function openVoice(on: boolean) {
    setErrors({});
    setFormError(null);
    setVoiceOpen(on);
    requestAnimationFrame(() => (on ? micRef.current : voiceToggleRef.current)?.focus());
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
  // Follows the "What do you sell?" pick on step 1, so changing it there re-words the rest.
  const vocab = storeVocabulary(stallType);
  const outcomeMsg = razorpay.outcome ? connectOutcomeMessage(razorpay.outcome) : null;

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
          <CardDescription>{stepDescription(current, vocab.kind)}</CardDescription>
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
            <fieldset className="space-y-3">
              <legend className="sr-only">Ways customers can pay</legend>
              {outcomeMsg ? (
                <p
                  role={outcomeMsg.ok ? "status" : "alert"}
                  className={cn("text-sm font-medium", outcomeMsg.ok ? "text-success" : "text-destructive")}
                >
                  {outcomeMsg.text}
                </p>
              ) : null}

              <div className="space-y-4 rounded-lg border p-3">
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    id="pay-upi"
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                    checked={upiChosen}
                    onChange={(e) => {
                      setUpiChosen(e.target.checked);
                      clearError("upiId");
                      clearError("upiName");
                      setFormError(null);
                    }}
                  />
                  <span>
                    <span className="block font-medium">UPI</span>
                    <span className="block text-sm text-muted-foreground">
                      Customers scan your QR or pay your UPI ID from any UPI app.
                    </span>
                  </span>
                </label>
                {upiChosen ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="upiId">UPI ID</Label>
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
                        <Image
                          src={qrSrc}
                          alt="UPI QR preview"
                          width={220}
                          height={220}
                          unoptimized
                          className="rounded-md"
                        />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="rounded-lg border p-3">
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    id="pay-pod"
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                    checked={payOnDelivery}
                    onChange={(e) => {
                      setPayOnDelivery(e.target.checked);
                      setFormError(null);
                    }}
                  />
                  <span>
                    <span className="block font-medium">Pay on delivery</span>
                    <span className="block text-sm text-muted-foreground">
                      Customers pay when they collect, or at the door, by cash or UPI.
                    </span>
                  </span>
                </label>
              </div>

              {razorpay.connected ? (
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                  <span>
                    <span className="block font-medium">Pay online: Razorpay connected</span>
                    <span className="block text-sm text-muted-foreground">
                      Customers can pay by card, UPI or netbanking, into your own Razorpay account.
                    </span>
                  </span>
                </div>
              ) : razorpay.canConnect ? (
                <div className="space-y-3 rounded-lg border p-3">
                  <p>
                    <span className="block font-medium">Pay online (Razorpay)</span>
                    <span className="block text-sm text-muted-foreground">
                      Card, UPI and netbanking, paid into your own Razorpay account. You&apos;ll come back to this
                      step afterwards.
                    </span>
                  </p>
                  <Button type="button" variant="outline" onClick={connectRazorpay} disabled={saving}>
                    {leavingForRazorpay ? "Opening Razorpay…" : "Connect Razorpay"}
                  </Button>
                </div>
              ) : null}
            </fieldset>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-3 rounded-lg border border-dashed p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {voiceOpen
                      ? `Say each ${vocab.item} and its price, check the list, then save it.`
                      : "Got a long list? Say it all at once instead of typing."}
                  </p>
                  <Button
                    ref={voiceToggleRef}
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    aria-expanded={voiceOpen}
                    onClick={() => openVoice(!voiceOpen)}
                  >
                    {voiceOpen ? <Keyboard aria-hidden="true" /> : <Mic aria-hidden="true" />}
                    {voiceOpen ? "Type instead" : `Speak your whole ${vocab.catalogue}`}
                  </Button>
                </div>
                {voiceOpen ? (
                  <VoiceMenuPanel
                    voiceLang={voiceLang}
                    categories={[...new Set(savedItems.map((it) => it.category))]}
                    itemCount={savedItems.length}
                    expanded
                    onCollapse={() => openVoice(false)}
                    micRef={micRef}
                    vocab={vocab}
                    formHint="tap “Type instead”"
                  />
                ) : null}
              </div>

              {savedItems.length > 0 ? (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Saved to your {vocab.catalogue}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {savedItems.map((it) => (
                      <li key={it.id} className="flex justify-between gap-3">
                        <span className="min-w-0 break-words">{it.name}</span>
                        <span className="shrink-0 font-mono">{formatINR(it.priceInPaise)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    You can edit these later in {vocab.catalogueTitle}.
                  </p>
                </div>
              ) : null}

              {!voiceOpen && drafts.map((it, idx) => {
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

              {!voiceOpen && drafts.length < MAX_DRAFT_ITEMS ? (
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
            {lastStep ? (
              <Button type="button" onClick={finish} disabled={saving}>
                {saving ? "Saving…" : "Finish setup"}
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

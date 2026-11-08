"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Keyboard, Mic, Plus, Trash2, X } from "lucide-react";

import { PushAlertsButton } from "@/components/push/PushAlertsButton";
import { CopyStoreLinkButton } from "@/components/setup/CopyStoreLinkButton";
import { ShareStoreButton } from "@/components/storefront/ShareStoreButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { RadioOption } from "@/components/ui/radio-option";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useQrDataUrl } from "@/hooks/useQrDataUrl";
import { STALL_TYPES } from "@/lib/constants";
import { formatINR } from "@/lib/currency";
import {
  deliveryAreaFeeLabel,
  deliveryAreaKey,
  deliveryFeeInputToPaise,
  DELIVERY_AREA_NAME_MAX,
  MAX_DELIVERY_AREAS,
  parseDeliveryAreas,
  toDeliveryArea,
  type DeliveryArea,
} from "@/lib/delivery-areas";
import { HOME_PATH } from "@/lib/home";
import { formatIndianMobile } from "@/lib/phone";
import { MENU_CHANGED_EVENT } from "@/lib/menu-events";
import { connectOutcomeMessage, razorpayConnectHref } from "@/lib/razorpay-connect";
import { STALL_TYPE_OTHER_MAX, STALL_TYPE_OTHER_MESSAGE, stallTypeOtherSchema } from "@/lib/stall-type";
import { storeVocabulary } from "@/lib/store-vocabulary";
import { buildUpiDeepLink, isValidUpiId, UPI_ID_FORMAT_MESSAGE } from "@/lib/upi";
import { cn } from "@/lib/utils";
import type { StallType, Vendor, VendorSettings } from "@prisma/client";

import {
  contactPatch,
  contactProblems,
  doneNextAction,
  draftToBulkItem,
  finishPatch,
  handoverProblems,
  initialFeeInput,
  initialHandoverMode,
  initialOrderMode,
  initialPaymentChoice,
  initialStateName,
  isBlankDraft,
  MAX_DRAFT_ITEMS,
  offersDelivery,
  offersPickup,
  ONBOARDING_STEPS,
  paymentChoiceProblem,
  progressAfter,
  resumeStep,
  reviewRows,
  STEP_COUNT,
  stepDescription,
  takesMenuOrders,
  validateItemDraft,
  type HandoverMode,
  type ItemDraft,
  type OrderMode,
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
              <span className="sr-only">
                Step {n}: {s.title}
                {done ? " (done)" : current ? " (current step)" : " (not started)"}
              </span>
              {/* Seven names don't fit a phone's width: there, the heading and "Step n of 7" say it. */}
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 hidden items-start gap-1 text-xs sm:flex",
                  current ? "font-bold text-foreground" : "text-muted-foreground",
                )}
              >
                {done ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : null}
                <span className="min-w-0 break-words">{s.short}</span>
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
  const [storeName, setStoreName] = useState("");
  /** `publishStorefront` as saved: a claimed demo store is live before setup ends. */
  const [published, setPublished] = useState(false);
  /** Set by a "Change" on the last step: Next on that step goes back to the summary. */
  const [returnToReview, setReturnToReview] = useState(false);
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

  /** Step 4. Null until the seller picks one. */
  const [orderMode, setOrderMode] = useState<OrderMode | null>(null);

  /** Step 5. Null until the seller picks one. */
  const [handover, setHandover] = useState<HandoverMode | null>(null);
  const [feeInput, setFeeInput] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [areas, setAreas] = useState<DeliveryArea[]>([]);
  const [areaName, setAreaName] = useState("");
  const [areaFee, setAreaFee] = useState("");

  const [whatsapp, setWhatsapp] = useState("");
  const [savedWhatsapp, setSavedWhatsapp] = useState("");
  const [acceptWhatsappOrders, setAcceptWhatsappOrders] = useState(false);
  const [showWhatsappOnStore, setShowWhatsappOnStore] = useState(false);
  const [instagram, setInstagram] = useState("");
  const [savedInstagram, setSavedInstagram] = useState("");
  const [fssai, setFssai] = useState("");
  const [savedFssai, setSavedFssai] = useState("");

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
        setStoreName(v.name);
        setPublished(v.settings?.publishStorefront ?? false);
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
        const st = v.settings;
        const done = v.onboardingStep ?? 0;
        setOrderMode(initialOrderMode({ acceptMenuOrders: st?.acceptMenuOrders ?? false, answered: done >= 4 }));
        const mode = st?.menuFulfilmentMode ?? "PICKUP";
        setHandover(initialHandoverMode({ mode, answered: done >= 5 }));
        setFeeInput(initialFeeInput(st?.menuDeliveryFeePaise ?? 0, mode, done >= 5));
        setPickupNote(st?.menuPickupNote ?? "");
        setAreas(parseDeliveryAreas(st?.deliveryAreas));
        // The sign-up phone is a suggestion here; it is saved only on Finish.
        setWhatsapp(formatIndianMobile(st?.whatsappNumber ?? v.phone ?? null));
        setSavedWhatsapp(st?.whatsappNumber ?? "");
        setAcceptWhatsappOrders(st?.acceptWhatsappOrders ?? false);
        setShowWhatsappOnStore(st?.showWhatsappOnStore ?? false);
        setInstagram(st?.instagramHandle ?? "");
        setSavedInstagram(st?.instagramHandle ?? "");
        setFssai(st?.fssaiNumber ?? "");
        setSavedFssai(st?.fssaiNumber ?? "");
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

  async function saveOrderMode(): Promise<boolean> {
    if (!orderMode) {
      reject({ "order-mode-drops": "Choose how customers order from you." });
      return false;
    }
    return patchVendor({ acceptMenuOrders: takesMenuOrders(orderMode) });
  }

  async function saveHandover(): Promise<boolean> {
    const feePaise = offersDelivery(handover) ? deliveryFeeInputToPaise(feeInput) : null;
    const problems = handoverProblems({ mode: handover, feePaise });
    if (problems.mode || problems.fee) {
      reject(problems.mode ? { "handover-PICKUP": problems.mode } : { "delivery-fee": problems.fee! });
      return false;
    }
    if (!handover) return false;
    const body: Record<string, unknown> = { menuFulfilmentMode: handover };
    if (offersPickup(handover)) body.menuPickupNote = pickupNote.trim();
    if (offersDelivery(handover)) {
      body.menuDeliveryFeePaise = feePaise;
      body.deliveryAreas = areas;
    }
    return patchVendor(body);
  }

  /** Put a typed area on the list. It is saved with the rest of the step on Next. */
  function addArea() {
    if (areas.length >= MAX_DELIVERY_AREAS) return;
    const feePaise = deliveryFeeInputToPaise(areaFee);
    if (feePaise === undefined) {
      reject({ "area-fee": "Enter a fee up to ₹1,000, like 30 or 0 for free. Leave it empty for your usual fee." });
      return;
    }
    const area = toDeliveryArea({ name: areaName, feePaise });
    if (!area) {
      reject({ "area-name": "Enter the area's name, like Kondapur." });
      return;
    }
    if (areas.some((a) => deliveryAreaKey(a.name) === deliveryAreaKey(area.name))) {
      reject({ "area-name": `${area.name} is already on the list.` });
      return;
    }
    setAreas((prev) => [...prev, area]);
    setAreaName("");
    setAreaFee("");
    clearError("area-name");
    clearError("area-fee");
    document.getElementById("area-name")?.focus();
  }

  async function saveContact(): Promise<boolean> {
    const contact = {
      whatsapp,
      acceptWhatsappOrders,
      showWhatsappOnStore,
      instagram,
      fssai: vocabKind === "food" ? fssai : "",
    };
    const found = contactProblems(contact);
    if (Object.keys(found).length) {
      reject(found as FieldErrors);
      return false;
    }
    const body = contactPatch(contact, { whatsapp: savedWhatsapp, instagram: savedInstagram, fssai: savedFssai }, vocabKind);
    if (!(await patchVendor(body))) return false;
    if ("whatsappNumber" in body) setSavedWhatsapp((body.whatsappNumber as string | null) ?? "");
    if ("instagramHandle" in body) setSavedInstagram(body.instagramHandle as string);
    if ("fssaiNumber" in body) setSavedFssai(body.fssaiNumber as string);
    return true;
  }

  async function next() {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const ok =
      step === 1
        ? await saveStore()
        : step === 2
          ? await savePayment()
          : step === 3
            ? await saveItems()
            : step === 4
              ? await saveOrderMode()
              : step === 5
                ? await saveHandover()
                : await saveContact();
    if (ok) await recordProgress(step);
    setSaving(false);
    if (!ok) return;
    if (returnToReview) {
      setReturnToReview(false);
      goTo(STEP_COUNT);
    } else {
      goTo(step + 1);
    }
  }

  /** "Change" on the summary: open that step; its Next comes back here. */
  function change(target: number) {
    if (saving) return;
    setReturnToReview(true);
    goTo(target);
  }

  function back() {
    if (saving) return;
    goTo(Math.max(step - 1, 1));
  }

  /** End setup, publishing the store in the same request when `publish` (a live store stays live). */
  async function finish(publish: boolean) {
    if (saving) return;
    const live = publish || published;
    setSaving(true);
    setFormError(null);
    const ok = await patchVendor(finishPatch(live, savedWhatsapp));
    setSaving(false);
    if (!ok) return;
    setPublished(live);
    focusHeading.current = true;
    setPhase("done");
  }

  // Follows the "What do you sell?" pick on step 1, so changing it there re-words the rest.
  const vocab = storeVocabulary(stallType);
  const vocabKind = vocab.kind;

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
    const action = doneNextAction(orderMode, published);
    const primary =
      action === "first-drop"
        ? { href: "/drops/new", label: "Create your first drop" }
        : action === "orders"
          ? { href: "/orders", label: "Go to your orders" }
          : { href: "/settings/store", label: "Publish your store" };
    const secondary =
      action === "first-drop" && published
        ? { href: "/orders", label: "Go to your orders" }
        : { href: "/pos", label: "Go to the counter" };
    return (
      <main id="main" className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-4 pb-12 pt-8">
        <div>
          <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden="true" />
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 font-display text-3xl font-bold text-primary focus-visible:outline-hidden"
          >
            {published ? "Your store is live" : "Setup is done"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {action === "first-drop"
              ? published
                ? "Next, put up a drop: what you're making, how many, and when orders close."
                : "Next, put up a drop: what you're making, how many, and when orders close. You'll be asked to publish your store when you open it."
              : action === "orders"
                ? `Customers can order from your ${vocab.catalogue} now. New orders show up in Orders.`
                : `Publish your store when you're ready, so customers can order from your ${vocab.catalogue}.`}
          </p>
        </div>

        <section aria-labelledby="store-link-heading" className="rounded-lg border bg-card p-4">
          <h2 id="store-link-heading" className="text-sm font-semibold">
            {published ? "Put your store link in your Instagram bio" : "Your store link"}
          </h2>
          <p className="mt-1 break-all font-mono text-sm">
            {window.location.host}
            {storePath}
          </p>
          {published ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyStoreLinkButton slug={slug} />
              <ShareStoreButton vendorName={storeName} slug={slug} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              This link is not public yet. Nobody can open it until you publish your store in Settings → Online
              store.
            </p>
          )}
        </section>

        <div className="flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={secondary.href}>{secondary.label}</Link>
          </Button>
        </div>
      </main>
    );
  }

  const current = ONBOARDING_STEPS[step - 1]!;
  const lastStep = step === STEP_COUNT;
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
            <fieldset className="space-y-2">
              <legend className="sr-only">How customers order from you</legend>
              <RadioOption
                id="order-mode-drops"
                name="order-mode"
                value="drops"
                checked={orderMode === "drops"}
                onChange={() => {
                  setOrderMode("drops");
                  clearError("order-mode-drops");
                }}
                invalid={Boolean(errors["order-mode-drops"])}
                aria-describedby={errors["order-mode-drops"] ? "order-mode-drops-error" : undefined}
                label="Drops"
                hint={`Batches you announce, like “${vocab.dropExample}”. Customers order until a cut-off you set.`}
              />
              <RadioOption
                name="order-mode"
                value="menu"
                checked={orderMode === "menu"}
                onChange={() => {
                  setOrderMode("menu");
                  clearError("order-mode-drops");
                }}
                invalid={Boolean(errors["order-mode-drops"])}
                label={vocab.catalogueOrdersTitle}
                hint={`Customers order from your ${vocab.catalogue} any time, with no cut-off.`}
              />
              <RadioOption
                name="order-mode"
                value="both"
                checked={orderMode === "both"}
                onChange={() => {
                  setOrderMode("both");
                  clearError("order-mode-drops");
                }}
                invalid={Boolean(errors["order-mode-drops"])}
                label="Both"
                hint={`Drops for special batches, and your ${vocab.catalogue} the rest of the time.`}
              />
              <FieldError id="order-mode-drops" message={errors["order-mode-drops"]} />
            </fieldset>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="sr-only">How customers get their order</legend>
                {(
                  [
                    { id: "PICKUP", label: "Pickup", hint: "Customers collect from you." },
                    { id: "DELIVERY", label: "Delivery", hint: "You, or someone you send, take it to them." },
                    { id: "BOTH", label: "Both", hint: "Customers choose at checkout." },
                  ] as const
                ).map((m, i) => (
                  <RadioOption
                    key={m.id}
                    id={`handover-${m.id}`}
                    name="handover"
                    value={m.id}
                    checked={handover === m.id}
                    onChange={() => {
                      setHandover(m.id);
                      clearError("handover-PICKUP");
                    }}
                    invalid={Boolean(errors["handover-PICKUP"])}
                    aria-describedby={i === 0 && errors["handover-PICKUP"] ? "handover-PICKUP-error" : undefined}
                    label={m.label}
                    hint={m.hint}
                  />
                ))}
                <FieldError id="handover-PICKUP" message={errors["handover-PICKUP"]} />
              </fieldset>

              {offersPickup(handover) ? (
                <div className="space-y-2">
                  <Label htmlFor="pickup-note">Pickup note (optional)</Label>
                  <textarea
                    id="pickup-note"
                    rows={2}
                    maxLength={200}
                    value={pickupNote}
                    onChange={(e) => setPickupNote(e.target.value)}
                    aria-describedby="pickup-note-hint"
                    className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <p id="pickup-note-hint" className="text-sm text-muted-foreground">
                    Where and when to collect, like &ldquo;Gate 2, Sunrise Apartments · 5–8 pm&rdquo;. Customers see it at
                    checkout.
                  </p>
                </div>
              ) : null}

              {offersDelivery(handover) ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="delivery-fee">Delivery fee (₹)</Label>
                    <Input
                      id="delivery-fee"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="30"
                      className="max-w-40 font-mono"
                      value={feeInput}
                      onChange={(e) => {
                        setFeeInput(e.target.value.replace(/[^\d.]/g, ""));
                        clearError("delivery-fee");
                      }}
                      {...fieldAria("delivery-fee", errors, "delivery-fee-hint")}
                    />
                    <FieldError id="delivery-fee" message={errors["delivery-fee"]} />
                    <p id="delivery-fee-hint" className="text-sm text-muted-foreground">
                      Added to delivery orders only. Enter 0 for free delivery.
                    </p>
                  </div>

                  <section aria-labelledby="areas-heading" className="space-y-3 rounded-lg border p-3">
                    <div>
                      <h3 id="areas-heading" className="text-sm font-medium">
                        Delivery areas (optional)
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        List the localities you deliver to, each with its own fee if you like, and customers pick one at
                        checkout. Leave it empty to deliver anywhere at the fee above.
                      </p>
                    </div>
                    {areas.length > 0 ? (
                      <ul className="divide-y rounded-md border" aria-label="Delivery areas">
                        {areas.map((a) => (
                          <li key={a.name} className="flex items-center justify-between gap-3 px-3 py-1">
                            <p className="min-w-0 text-sm">
                              <span className="font-medium">{a.name}</span>
                              <span className="text-muted-foreground"> · {deliveryAreaFeeLabel(a)}</span>
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${a.name}`}
                              onClick={() => setAreas((prev) => prev.filter((x) => x.name !== a.name))}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {areas.length < MAX_DELIVERY_AREAS ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                          <div className="space-y-1">
                            <Label htmlFor="area-name">Area</Label>
                            <Input
                              id="area-name"
                              placeholder="Kondapur"
                              maxLength={DELIVERY_AREA_NAME_MAX}
                              value={areaName}
                              onChange={(e) => {
                                setAreaName(e.target.value);
                                clearError("area-name");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addArea();
                                }
                              }}
                              {...fieldAria("area-name", errors)}
                            />
                            <FieldError id="area-name" message={errors["area-name"]} />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="area-fee">Fee in ₹ (optional)</Label>
                            <Input
                              id="area-fee"
                              inputMode="decimal"
                              placeholder="0"
                              className="font-mono"
                              value={areaFee}
                              onChange={(e) => {
                                setAreaFee(e.target.value);
                                clearError("area-fee");
                              }}
                              {...fieldAria("area-fee", errors, "area-fee-hint")}
                            />
                            <FieldError id="area-fee" message={errors["area-fee"]} />
                          </div>
                        </div>
                        <p id="area-fee-hint" className="text-sm text-muted-foreground">
                          0 is free delivery to that area. Empty uses the fee above.
                        </p>
                        <Button type="button" variant="outline" onClick={addArea} disabled={!areaName.trim()}>
                          <Plus aria-hidden="true" />
                          Add area
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">You can list up to {MAX_DELIVERY_AREAS} areas.</p>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          )}

          {step === 6 && (
            <>
              <section aria-labelledby="wa-heading" className="space-y-3">
                <h3 id="wa-heading" className="text-sm font-semibold">
                  WhatsApp
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="wa">WhatsApp number (optional)</Label>
                  <Input
                    id="wa"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="98765 43210"
                    value={whatsapp}
                    onChange={(e) => {
                      setWhatsapp(e.target.value);
                      clearError("wa");
                    }}
                    {...fieldAria("wa", errors, "wa-hint")}
                  />
                  <FieldError id="wa" message={errors.wa} />
                  <p id="wa-hint" className="text-sm text-muted-foreground">
                    The number customers message about an order. It can differ from your login phone. Nobody sees it
                    unless you turn a switch on below.
                  </p>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <label htmlFor="wa-orders" className="text-sm font-medium">
                      Let customers send orders on WhatsApp
                    </label>
                    <p id="wa-orders-hint" className="text-sm text-muted-foreground">
                      Customers who place an order can message it to you.{" "}
                      <span className="font-medium text-warning">They will see this number.</span>
                    </p>
                  </div>
                  <Switch
                    id="wa-orders"
                    aria-describedby="wa-orders-hint"
                    checked={acceptWhatsappOrders}
                    onCheckedChange={(on) => {
                      setAcceptWhatsappOrders(on);
                      clearError("wa");
                    }}
                  />
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <label htmlFor="wa-store" className="text-sm font-medium">
                      Show a WhatsApp button on your store page
                    </label>
                    <p id="wa-store-hint" className="text-sm text-muted-foreground">
                      Anyone can message you before ordering.{" "}
                      <span className="font-medium text-warning">Everyone who opens your store will see this number.</span>
                    </p>
                  </div>
                  <Switch
                    id="wa-store"
                    aria-describedby="wa-store-hint"
                    checked={showWhatsappOnStore}
                    onCheckedChange={(on) => {
                      setShowWhatsappOnStore(on);
                      clearError("wa");
                    }}
                  />
                </div>
              </section>

              <div className="space-y-2">
                <Label htmlFor="instagram">Instagram username (optional)</Label>
                <Input
                  id="instagram"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={200}
                  placeholder="@yourstore"
                  value={instagram}
                  onChange={(e) => {
                    setInstagram(e.target.value);
                    clearError("instagram");
                  }}
                  {...fieldAria("instagram", errors, "instagram-hint")}
                />
                <FieldError id="instagram" message={errors.instagram} />
                <p id="instagram-hint" className="text-sm text-muted-foreground">
                  Your username or profile link. Customers tap it on your store page to open your Instagram.
                </p>
              </div>

              {vocab.kind === "food" ? (
                <div className="space-y-2">
                  <Label htmlFor="fssai">FSSAI number (optional)</Label>
                  <Input
                    id="fssai"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={14}
                    className="font-mono"
                    value={fssai}
                    onChange={(e) => {
                      setFssai(e.target.value.replace(/\D/g, ""));
                      clearError("fssai");
                    }}
                    {...fieldAria("fssai", errors, "fssai-hint")}
                  />
                  <FieldError id="fssai" message={errors.fssai} />
                  <p id="fssai-hint" className="text-sm text-muted-foreground">
                    14 digits. Shown on your store page so customers know your kitchen is registered.
                  </p>
                </div>
              ) : null}

              <section aria-labelledby="alerts-heading" className="space-y-2">
                <h3 id="alerts-heading" className="text-sm font-semibold">
                  Alerts on this phone
                </h3>
                <p className="text-sm text-muted-foreground">
                  A notification for every new order, even when the screen is locked. You can turn it on later in
                  Settings → Notifications.
                </p>
                <div className="flex flex-col gap-2">
                  <PushAlertsButton variant="settings" />
                </div>
              </section>
            </>
          )}

          {step === 7 && (
            <>
              <ul className="divide-y rounded-lg border">
                {reviewRows(
                  {
                    store: {
                      typeLabel:
                        stallType === "OTHER"
                          ? stallTypeOther.trim() || "Other"
                          : (STALL_TYPES.find((t) => t.value === stallType)?.label ?? ""),
                      city,
                      state: stateName,
                    },
                    payment: { upiId: savedUpiId, payOnDelivery, online: razorpay.connected },
                    items: savedItems,
                    orderMode,
                    handover: {
                      mode: handover,
                      pickupNote,
                      feePaise: deliveryFeeInputToPaise(feeInput) ?? null,
                      areas,
                    },
                    contact: {
                      whatsapp: savedWhatsapp,
                      acceptWhatsappOrders,
                      showWhatsappOnStore,
                      instagram: savedInstagram,
                      fssai: savedFssai,
                    },
                  },
                  vocab,
                ).map((r) => (
                  <li key={r.step} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="text-sm font-semibold">{r.title}</h3>
                      {r.lines.map((line) => (
                        <p key={line} className="break-words text-sm text-muted-foreground">
                          {line}
                        </p>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      aria-label={`Change ${r.title}`}
                      onClick={() => change(r.step)}
                      disabled={saving}
                    >
                      Change
                    </Button>
                  </li>
                ))}
              </ul>

              <section aria-labelledby="review-link-heading" className="space-y-1">
                <h3 id="review-link-heading" className="text-sm font-semibold">
                  Your store link
                </h3>
                <p className="break-all font-mono text-sm">
                  {window.location.host}/s/{encodeURIComponent(slug)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {published
                    ? "Your store is already online at this link."
                    : "Publishing makes this link public: anyone who opens it can see your store and order."}
                </p>
              </section>

              {!published ? (
                <p className="text-sm text-muted-foreground">
                  Not ready for customers yet?{" "}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto min-h-11 px-0 align-baseline"
                    onClick={() => void finish(false)}
                    disabled={saving}
                  >
                    Finish without publishing
                  </Button>{" "}
                  You can publish later in Settings → Online store.
                </p>
              ) : null}
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
              <Button type="button" onClick={() => void finish(true)} disabled={saving}>
                {saving ? "Saving…" : published ? "Finish setup" : "Publish my store"}
              </Button>
            ) : (
              <Button type="button" onClick={next} disabled={saving}>
                {saving ? "Saving…" : returnToReview ? "Save" : "Next"}
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </main>
  );
}

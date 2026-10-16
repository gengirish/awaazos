"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { OutreachWhatsApp } from "@/components/admin/OutreachWhatsApp";
import { StoreImagesClient } from "@/components/settings/StoreImagesClient";
import {
  buildDemoStorePayload,
  suggestExternalRef,
  type DemoFormField,
  type DemoStoreFormItem,
  type DemoStoreFormValues,
} from "@/lib/demo-store-form";
import { DEMO_CATEGORIES, DEMO_FULFILMENT, DEMO_LANGUAGES, type DemoLanguage } from "@/lib/demo-store-schema";
import { outreachIntroMessage } from "@/lib/outreach-message";

const FIELD =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const CATEGORY_LABEL: Record<keyof typeof DEMO_CATEGORIES, string> = {
  home_bakery: "Home bakery",
  home_kitchen: "Home kitchen",
  cloud_kitchen: "Cloud kitchen",
  cafe: "Café",
  sweets: "Sweets",
  catering: "Catering",
  street_food: "Street food",
  general: "General",
};

const FULFILMENT_LABEL: Record<keyof typeof DEMO_FULFILMENT, string> = {
  pickup: "Pickup only",
  delivery: "Delivery only",
  both: "Pickup and delivery",
};

const LANGUAGE_LABEL: Record<DemoLanguage, string> = {
  en: "English",
  hi: "Hindi",
  te: "Telugu",
  kn: "Kannada",
  ta: "Tamil",
};

const ERROR_TEXT: Record<string, string> = {
  rate_limited: "You have built 20 demo stores in the last 24 hours. Try again tomorrow.",
  payment_details_not_allowed:
    "A field looks like a UPI id, bank detail, payment key or email. Remove it: demo stores always use demo@upi.",
  demo_owner_not_configured: "DEMO_OWNER_EMAIL is not set on the server, so demo stores can't be built.",
};

const EMPTY_ITEM: DemoStoreFormItem = { name: "", unit: "", priceRupees: "", category: "" };
const MAX_ROWS = 20;

const INITIAL: DemoStoreFormValues = {
  externalRef: "",
  name: "",
  category: "home_bakery",
  area: "",
  instagram: "",
  displayPhone: "",
  languages: ["en"],
  fulfilment: "both",
  deliveryFeeRupees: "",
  items: Array.from({ length: 6 }, () => ({ ...EMPTY_ITEM })),
  withSampleOrders: true,
};

type Created = {
  public_url: string;
  created: boolean;
  external_ref: string;
  storeName: string;
  phone: string | null;
  ownerName: string;
};
type Issue = { path?: (string | number)[]; message?: string };

/** The input id (under the form's `useId()` prefix) an error is about. */
function fieldInputId(ids: string, field: DemoFormField): string {
  switch (field.kind) {
    case "name":
      return `${ids}-name`;
    case "area":
      return `${ids}-area`;
    case "instagram":
      return `${ids}-instagram`;
    case "displayPhone":
      return `${ids}-phone`;
    case "externalRef":
      return `${ids}-ref`;
    case "item":
      return `${ids}-item-${field.row}-${field.part}`;
  }
}

function describeIssues(issues: Issue[] | undefined): string | null {
  if (!issues?.length) return null;
  return issues
    .slice(0, 4)
    .map((i) => `${(i.path ?? []).join(".") || "body"}: ${i.message ?? "invalid"}`)
    .join(" · ");
}

/** A string field of the pasted payload's profile, or "". */
function profileField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || !("profile" in payload)) return "";
  const profile = (payload as { profile?: Record<string, unknown> }).profile;
  const value = profile?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * /admin/demo-stores/new. Builds the internal-API payload in the browser
 * (lib/demo-store-form.ts) or takes a pasted one, then POSTs it to
 * /api/admin/demo-stores, which validates it in full again. Once built, it
 * offers the first WhatsApp message to the seller (lib/outreach-message.ts).
 * `senderName` is the signed-in admin's name, for that message.
 */
export function DemoStoreForm({ senderName }: { senderName: string | null }) {
  const ids = useId();
  const [mode, setMode] = useState<"form" | "json">("form");
  const [form, setForm] = useState<DemoStoreFormValues>(INITIAL);
  const [refEdited, setRefEdited] = useState(false);
  const [json, setJson] = useState("");
  // Only for the WhatsApp message; never sent to the server.
  const [ownerName, setOwnerName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  function set<K extends keyof DemoStoreFormValues>(key: K, value: DemoStoreFormValues[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (!refEdited && (key === "name" || key === "area")) {
        next.externalRef = suggestExternalRef(next.name, next.area);
      }
      return next;
    });
    setError(null);
  }

  function setItem(index: number, patch: Partial<DemoStoreFormItem>) {
    set(
      "items",
      form.items.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function toggleLanguage(lang: DemoLanguage, on: boolean) {
    set("languages", on ? [...form.languages, lang] : form.languages.filter((l) => l !== lang));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let payload: unknown;
    if (mode === "form") {
      if (!form.name.trim()) return setError("Enter the store name.");
      if (!form.externalRef.trim()) return setError("Enter a reference (lowercase letters, digits and dashes).");
      const built = buildDemoStorePayload(form);
      if (!built.ok) {
        setError(built.error);
        if (built.field) document.getElementById(fieldInputId(ids, built.field))?.focus();
        return;
      }
      payload = built.payload;
    } else {
      try {
        payload = JSON.parse(json);
      } catch {
        return setError("That is not valid JSON.");
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/demo-stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: string;
        issues?: Issue[];
        public_url?: string;
        created?: boolean;
      };
      if (!res.ok || !body.public_url) {
        const text =
          ERROR_TEXT[body.error ?? ""] ?? describeIssues(body.issues) ?? "Could not build the store. Try again.";
        // The form checks payment-like text itself, so this is mostly pasted
        // JSON: name the payload path the server refused.
        setError(body.error === "payment_details_not_allowed" && body.field ? `${text} Found in: ${body.field}.` : text);
        return;
      }
      const ref =
        payload && typeof payload === "object" && "external_ref" in payload ? String(payload.external_ref) : "";
      setCreated({
        public_url: body.public_url,
        created: body.created === true,
        external_ref: ref,
        storeName: profileField(payload, "name"),
        phone: profileField(payload, "display_phone") || null,
        ownerName,
      });
    } catch {
      setError("No connection. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-4 shadow-xs sm:p-5" role="status">
        <h2 className="text-lg font-semibold text-foreground">
          {created.created ? "Demo store built" : "This reference already has a store"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {created.created
            ? "Nothing was sent to the seller. Share the link yourself, and make a claim link from the pipeline when they want it."
            : `Nothing new was made: "${created.external_ref}" already exists, so this is that store.`}
        </p>
        <p className="break-all font-mono text-sm">
          <a href={created.public_url} target="_blank" rel="noreferrer" className="text-primary underline">
            {created.public_url}
          </a>
        </p>
        {created.created && created.external_ref ? (
          // The demo account owns the store, so nobody could add these from
          // Settings; a banner and logo from the seller's Instagram make the
          // demo look like theirs (lib/demo-store-image.ts).
          <section aria-labelledby="images-heading" className="space-y-3 border-t pt-4">
            <h3 id="images-heading" className="font-semibold text-foreground">
              Add the seller&apos;s banner and logo
            </h3>
            <p className="text-sm text-muted-foreground">
              Optional. A cover photo and their profile picture from Instagram make the store look like theirs.
            </p>
            <StoreImagesClient
              storeName={created.storeName}
              initialBannerUrl={null}
              initialLogoUrl={null}
              isOwner
              endpointBase={`/api/admin/demo-stores/${encodeURIComponent(created.external_ref)}`}
            />
          </section>
        ) : null}
        <section aria-labelledby="whatsapp-heading" className="space-y-2 border-t pt-4">
          <h3 id="whatsapp-heading" className="font-semibold text-foreground">
            Send it to the seller
          </h3>
          <OutreachWhatsApp
            phone={created.phone}
            message={outreachIntroMessage({
              ownerName: created.ownerName,
              senderName,
              storeName: created.storeName,
              storeUrl: created.public_url,
            })}
            label="Message on WhatsApp"
          />
        </section>
        <div className="flex flex-wrap gap-3 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => void navigator.clipboard?.writeText(created.public_url)}>
            Copy link
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/demo-stores">Back to the pipeline</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCreated(null);
              setForm(INITIAL);
              setRefEdited(false);
              setJson("");
              setOwnerName("");
            }}
          >
            Build another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div role="group" aria-label="How to enter the store" className="flex gap-2">
        <Button type="button" variant={mode === "form" ? "default" : "outline"} aria-pressed={mode === "form"} onClick={() => setMode("form")}>
          Fill in a form
        </Button>
        <Button type="button" variant={mode === "json" ? "default" : "outline"} aria-pressed={mode === "json"} onClick={() => setMode("json")}>
          Paste JSON
        </Button>
      </div>

      {mode === "json" ? (
        <div className="space-y-2">
          <Label htmlFor={`${ids}-json`}>Payload</Label>
          <textarea
            id={`${ids}-json`}
            className={`${FIELD} min-h-80 py-2 font-mono text-sm`}
            spellCheck={false}
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setError(null);
            }}
            placeholder='{ "external_ref": "…", "profile": { … }, "items": [ … ], "sample_orders": [ … ] }'
          />
          <p className="text-xs text-muted-foreground">
            The same body as POST /api/internal/demo-stores (docs/INTERNAL_DEMO_STORES.md), for example
            outreach/queens-saga-sahakarnagar.json.
          </p>
        </div>
      ) : (
        <>
          <fieldset className="space-y-4 rounded-lg border bg-card p-4 shadow-xs sm:p-5">
            <legend className="px-1 text-base font-semibold">Seller</legend>
            <p className="text-sm text-muted-foreground">
              There are no payment details to fill in: every demo store takes its sample payments to demo@upi. Leave
              out UPI ids, bank details and emails.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor={`${ids}-name`}>Store name</Label>
                <Input id={`${ids}-name`} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={60} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${ids}-area`}>Area</Label>
                <Input
                  id={`${ids}-area`}
                  value={form.area}
                  onChange={(e) => set("area", e.target.value)}
                  placeholder="Sahakar Nagar, Bengaluru"
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${ids}-category`}>Type</Label>
                <select
                  id={`${ids}-category`}
                  className={FIELD}
                  value={form.category}
                  onChange={(e) => set("category", e.target.value as DemoStoreFormValues["category"])}
                >
                  {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${ids}-instagram`}>Instagram</Label>
                <Input
                  id={`${ids}-instagram`}
                  value={form.instagram}
                  onChange={(e) => set("instagram", e.target.value)}
                  placeholder="@handle"
                  autoCapitalize="none"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${ids}-phone`}>Business phone (optional)</Label>
                <Input
                  id={`${ids}-phone`}
                  inputMode="tel"
                  value={form.displayPhone}
                  onChange={(e) => set("displayPhone", e.target.value)}
                  placeholder="+91 98454 31188"
                />
                <p className="text-xs text-muted-foreground">Kept hidden on the store until the seller claims it.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${ids}-fulfilment`}>Orders by</Label>
                <select
                  id={`${ids}-fulfilment`}
                  className={FIELD}
                  value={form.fulfilment}
                  onChange={(e) => set("fulfilment", e.target.value as DemoStoreFormValues["fulfilment"])}
                >
                  {(Object.keys(FULFILMENT_LABEL) as (keyof typeof FULFILMENT_LABEL)[]).map((f) => (
                    <option key={f} value={f}>
                      {FULFILMENT_LABEL[f]}
                    </option>
                  ))}
                </select>
              </div>
              {form.fulfilment !== "pickup" ? (
                <div className="space-y-2">
                  <Label htmlFor={`${ids}-fee`}>Delivery fee (₹, optional)</Label>
                  <Input
                    id={`${ids}-fee`}
                    inputMode="decimal"
                    value={form.deliveryFeeRupees}
                    onChange={(e) => set("deliveryFeeRupees", e.target.value)}
                    placeholder="0"
                  />
                </div>
              ) : null}
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Languages</legend>
              <div className="flex flex-wrap gap-x-5">
                {DEMO_LANGUAGES.map((lang) => (
                  <label key={lang} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={form.languages.includes(lang)}
                      onChange={(e) => toggleLanguage(lang, e.target.checked)}
                    />
                    {LANGUAGE_LABEL[lang]}
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border bg-card p-4 shadow-xs sm:p-5">
            <legend className="px-1 text-base font-semibold">Dishes</legend>
            <p className="text-sm text-muted-foreground">
              6–8 of the seller&apos;s real products. Prices from their posts, or a fair local estimate. Blank rows are
              skipped.
            </p>
            <ul className="space-y-4">
              {form.items.map((row, i) => (
                <li key={i} className="grid grid-cols-2 gap-2 border-b pb-4 last:border-b-0 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end sm:border-b-0 sm:pb-0">
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <Label htmlFor={`${ids}-item-${i}-name`} className="text-xs">
                      Dish {i + 1}
                    </Label>
                    <Input
                      id={`${ids}-item-${i}-name`}
                      value={row.name}
                      maxLength={80}
                      onChange={(e) => setItem(i, { name: e.target.value })}
                      placeholder="Engagement Cake (2 kg)"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${ids}-item-${i}-price`} className="text-xs">
                      Price (₹)
                    </Label>
                    <Input
                      id={`${ids}-item-${i}-price`}
                      inputMode="decimal"
                      value={row.priceRupees}
                      onChange={(e) => setItem(i, { priceRupees: e.target.value })}
                      placeholder="1200"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${ids}-item-${i}-unit`} className="text-xs">
                      Per (optional)
                    </Label>
                    <Input
                      id={`${ids}-item-${i}-unit`}
                      value={row.unit}
                      maxLength={16}
                      onChange={(e) => setItem(i, { unit: e.target.value })}
                      placeholder="kg"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${ids}-item-${i}-category`} className="text-xs">
                      Section (optional)
                    </Label>
                    <Input
                      id={`${ids}-item-${i}-category`}
                      value={row.category}
                      maxLength={40}
                      onChange={(e) => setItem(i, { category: e.target.value })}
                      placeholder="Cakes"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Remove dish ${i + 1}`}
                    disabled={form.items.length === 1}
                    onClick={() => set("items", form.items.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              disabled={form.items.length >= MAX_ROWS}
              onClick={() => set("items", [...form.items, { ...EMPTY_ITEM }])}
            >
              <Plus aria-hidden className="size-4" /> Add a dish
            </Button>
          </fieldset>

          <fieldset className="space-y-4 rounded-lg border bg-card p-4 shadow-xs sm:p-5">
            <legend className="px-1 text-base font-semibold">Sample orders and reference</legend>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={form.withSampleOrders}
                onChange={(e) => set("withSampleOrders", e.target.checked)}
              />
              <span>
                Add 8 sample orders from these dishes: 2 waiting for an advance, 3 with a balance due, 1 nearly paid, 1
                fully paid and 1 overdue. Fictional customers, dated around today.
              </span>
            </label>
            <div className="space-y-2">
              <Label htmlFor={`${ids}-ref`}>Reference</Label>
              <Input
                id={`${ids}-ref`}
                value={form.externalRef}
                autoCapitalize="none"
                spellCheck={false}
                maxLength={80}
                onChange={(e) => {
                  setRefEdited(true);
                  set("externalRef", e.target.value.toLowerCase());
                }}
                placeholder="queens-saga-sahakarnagar"
              />
              <p className="text-xs text-muted-foreground">
                One per seller, made from the name and area. Building again with the same reference returns the
                existing store instead of a second one.
              </p>
            </div>
          </fieldset>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${ids}-owner`}>Owner&apos;s first name (optional)</Label>
        <Input
          id={`${ids}-owner`}
          className="sm:w-72"
          autoComplete="off"
          value={ownerName}
          maxLength={40}
          onChange={(e) => setOwnerName(e.target.value)}
          placeholder="Lahari"
        />
        <p className="text-xs text-muted-foreground">
          Only for the WhatsApp message you send after building. It isn&apos;t saved with the store.
        </p>
      </div>

      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Building…" : "Build demo store"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/demo-stores">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

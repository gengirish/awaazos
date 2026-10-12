"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQrDataUrl } from "@/hooks/useQrDataUrl";
import { ALLOWED_VOICE_LANGS, STALL_TYPES, VOICE_LANGUAGES } from "@/lib/constants";
import { rupeesToPaise } from "@/lib/currency";
import { HOME_PATH } from "@/lib/home";
import { buildUpiDeepLink, isValidUpiId, UPI_ID_FORMAT_MESSAGE } from "@/lib/upi";
import type { StallType, Vendor, VendorSettings } from "@prisma/client";

type VendorPayload = Vendor & { settings: VendorSettings | null };

const STEPS = 4;

type MenuDraft = { name: string; priceRupees: string; emoji: string; alias: string };

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("Telangana");
  const [stallType, setStallType] = useState<StallType>("GENERAL");

  const [upiId, setUpiId] = useState("");
  const [upiName, setUpiName] = useState("");

  const [items, setItems] = useState<MenuDraft[]>([
    { name: "", priceRupees: "", emoji: "🍽️", alias: "" },
    { name: "", priceRupees: "", emoji: "🍽️", alias: "" },
    { name: "", priceRupees: "", emoji: "🍽️", alias: "" },
  ]);

  // "Speak your whole menu": skip typing the three items here and land on
  // /menu?voice=1 (voice menu builder open) once setup is saved.
  const [speakMenu, setSpeakMenu] = useState(false);

  const [whatsapp, setWhatsapp] = useState("");
  const [voiceLang, setVoiceLang] = useState("en-IN");

  function updateItem(i: number, patch: Partial<MenuDraft>) {
    setItems((prev) => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/vendor");
        if (res.status === 401) {
          router.replace("/sign-in?callbackUrl=/onboarding");
          return;
        }
        if (!res.ok) {
          throw new Error("Could not load vendor");
        }
        const data = (await res.json()) as { vendor: VendorPayload };
        if (cancelled) return;
        const v = data.vendor;
        if (v.onboardingDone) {
          router.replace(HOME_PATH);
          return;
        }
        setCity(v.city ?? "");
        setStateName(v.state ?? "Telangana");
        setStallType(v.stallType);
        setUpiId(v.upiId ?? "");
        setUpiName(v.upiName ?? v.name);
        setVoiceLang(v.settings?.voiceLang ?? "en-IN");
        setWhatsapp(v.settings?.whatsappNumber ?? v.phone ?? "");
      } catch {
        if (!cancelled) setError("Failed to load your stall profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const previewLink = useMemo(() => {
    if (!upiId.trim() || !upiName.trim()) return "";
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

  function validateStep(): string | null {
    if (step === 1) {
      if (!city.trim()) return "City is required.";
      if (!stateName.trim()) return "State is required.";
    }
    if (step === 2) {
      if (!upiId.trim()) return "UPI ID is required.";
      if (!isValidUpiId(upiId)) return UPI_ID_FORMAT_MESSAGE;
      if (!upiName.trim()) return "UPI display name is required.";
    }
    if (step === 3 && !speakMenu) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (!it.name.trim()) return `Menu item ${i + 1}: name is required.`;
        const p = Number(it.priceRupees);
        if (!Number.isFinite(p) || p <= 0) return `Menu item ${i + 1}: enter a valid ₹ price.`;
        try {
          rupeesToPaise(p);
        } catch {
          return `Menu item ${i + 1}: price must have at most 2 decimal places.`;
        }
      }
    }
    if (step === 4) {
      if (!whatsapp.trim()) return "WhatsApp number is required.";
      const parsed = parsePhoneNumberFromString(whatsapp.trim(), "IN");
      if (!parsed?.isValid() || parsed.country !== "IN") {
        return "Enter a valid Indian mobile number (+91).";
      }
    }
    return null;
  }

  function next() {
    const v = validateStep();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS));
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  async function finish() {
    const v = validateStep();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    const parsedPhone = parsePhoneNumberFromString(whatsapp.trim(), "IN");
    const wa = parsedPhone?.format("E.164") ?? whatsapp.trim();

    const menuItems = speakMenu
      ? undefined
      : items.map((it) => {
          const priceInPaise = rupeesToPaise(Number(it.priceRupees));
          const aliases = it.alias
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);
          return {
            name: it.name.trim(),
            priceInPaise,
            emoji: it.emoji.trim() || "🍽️",
            aliases: aliases.length ? aliases : undefined,
          };
        });

    const res = await fetch("/api/vendor", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        city: city.trim(),
        state: stateName.trim(),
        stallType,
        upiId: upiId.trim(),
        upiName: upiName.trim(),
        whatsappNumber: wa,
        voiceLang,
        menuItems,
        onboardingDone: true,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || "Could not save onboarding.");
      setSaving(false);
      return;
    }

    router.push(speakMenu ? "/menu?voice=1" : HOME_PATH);
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-muted-foreground">Loading setup…</div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 p-4 pb-12 pt-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-primary">Set up your stall</h1>
        <p className="text-sm text-muted-foreground">
          Step {step} of {STEPS}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {step === 1 && "Stall location"}
            {step === 2 && "UPI payments"}
            {step === 3 && "First menu items"}
            {step === 4 && "WhatsApp & voice"}
          </CardTitle>
          <CardDescription>
            {step === 1 && "Confirm where you operate — you can change this later."}
            {step === 2 && "Customers scan this QR to pay you via any UPI app."}
            {step === 3 && "Add three items — voice billing will match these names."}
            {step === 4 && "Receipts and voice language for your counter."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" autoComplete="address-level1" value={stateName} onChange={(e) => setStateName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Stall type</Label>
                <Select value={stallType} onValueChange={(v) => setStallType(v as StallType)}>
                  <SelectTrigger>
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
            </>
          )}

          {step === 2 && (
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
                  onChange={(e) => setUpiId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="upiName">Name shown on UPI screen</Label>
                <Input id="upiName" value={upiName} onChange={(e) => setUpiName(e.target.value)} />
              </div>
              {qrSrc ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/40 p-4">
                  <p className="text-xs text-muted-foreground">Preview (₹1 test link)</p>
                  <Image src={qrSrc} alt="UPI QR preview" width={220} height={220} unoptimized className="rounded-md" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Enter UPI ID and name to generate a preview QR.</p>
              )}
            </>
          )}

          {step === 3 && speakMenu && (
            <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="flex items-start gap-2 text-sm font-medium">
                <Mic className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  After the last step you&apos;ll land on your Menu with the mic ready. Say each dish and its price,
                  check the list, then save.
                </span>
              </p>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setSpeakMenu(false)}>
                Type three items instead
              </Button>
            </div>
          )}

          {step === 3 && !speakMenu && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">Got more dishes? Say them all at once instead of typing.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0"
                  onClick={() => {
                    setError(null);
                    setSpeakMenu(true);
                  }}
                >
                  <Mic aria-hidden="true" />
                  Speak your whole menu
                </Button>
              </div>
              {items.map((it, idx) => (
                <div key={idx} className="space-y-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">Item {idx + 1}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Name</Label>
                      <Input value={it.name} onChange={(e) => updateItem(idx, { name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label>₹ Price</Label>
                      <Input
                        inputMode="decimal"
                        value={it.priceRupees}
                        onChange={(e) => updateItem(idx, { priceRupees: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Emoji</Label>
                      <Input value={it.emoji} onChange={(e) => updateItem(idx, { emoji: e.target.value })} />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>Voice aliases (comma-separated)</Label>
                      <Input
                        placeholder="e.g. masala dosa, plain dosa"
                        value={it.alias}
                        onChange={(e) => updateItem(idx, { alias: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 4 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="wa">WhatsApp number (+91)</Label>
                <Input
                  id="wa"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Voice language</Label>
                <Select
                  value={ALLOWED_VOICE_LANGS.includes(voiceLang) ? voiceLang : "hi-IN"}
                  onValueChange={setVoiceLang}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICE_LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={back} disabled={step === 1 || saving}>
            Back
          </Button>
          {step < STEPS ? (
            <Button type="button" onClick={next}>
              Next
            </Button>
          ) : (
            <Button type="button" onClick={finish} disabled={saving}>
              {saving ? "Saving…" : speakMenu ? "Finish & speak your menu" : "Finish & go to POS"}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

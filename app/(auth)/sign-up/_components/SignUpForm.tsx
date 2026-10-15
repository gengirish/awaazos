"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";

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
import { useStoreHandleCheck } from "@/hooks/useStoreHandleCheck";
import { STALL_TYPES } from "@/lib/constants";
import { HOME_PATH } from "@/lib/home";
import { checkPasswordPolicy } from "@/lib/password-strength";
import {
  normaliseStoreHandle,
  STORE_HANDLE_MAX,
  storeHandleProblem,
  storeHandleWhileTyping,
  storeLinkPrefix,
} from "@/lib/store-handle";
import type { StallType } from "@prisma/client";

// In form order: the first one with an error takes focus. The ids are also the
// keys of the register API's zod `details` (signUpSchema in lib/zod-auth.ts).
const FIELDS = ["name", "email", "password", "stallName", "storeHandle", "stallType", "phone"] as const;
type Field = (typeof FIELDS)[number];
type FieldErrors = Partial<Record<Field, string>>;

// Our own wording for a field the server's schema rejected (zod's is not for sellers).
const SERVER_FIELD_MESSAGE: Record<Field, string> = {
  name: "Enter your name (up to 120 characters).",
  email: "Enter a valid email address.",
  password: "Password must be 8 to 128 characters.",
  stallName: "Enter your store name (up to 120 characters).",
  storeHandle: "Choose a store link: 3 to 40 lowercase letters, numbers or hyphens.",
  stallType: "Choose what you sell.",
  phone: "Enter a valid +91 Indian mobile number.",
};

const textLinkClass = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1 font-medium text-primary hover:underline";

type RegisterResponse = {
  error?: string;
  /** Which field a 409 is about (register route): email, stallName or storeHandle. */
  field?: string;
  reason?: string;
  details?: Partial<Record<string, string[]>>;
};

function validate(values: {
  name: string;
  email: string;
  password: string;
  stallName: string;
  storeHandle: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = "Enter your name.";
  if (!/^\S+@\S+\.\S+$/.test(values.email.trim())) errors.email = "Enter a valid email address.";
  const policy = checkPasswordPolicy(values.password);
  if (!policy.ok) errors.password = policy.reason;
  if (!values.stallName.trim()) errors.stallName = "Enter your store name.";
  const handleProblem = storeHandleProblem(values.storeHandle);
  if (handleProblem) errors.storeHandle = handleProblem;
  return errors;
}

function isField(value: string | undefined): value is Field {
  return (FIELDS as readonly string[]).includes(value ?? "");
}

type HandleCheck = ReturnType<typeof useStoreHandleCheck>;

function handleHint(check: HandleCheck): string {
  switch (check.state) {
    case "checking":
      return "Checking…";
    case "available":
      return "Available. This goes in your Instagram bio; you can change it later in Settings.";
    case "taken":
    case "invalid":
      return check.reason;
    case "unknown":
      return "Couldn't check right now. You can still continue.";
    default:
      return "Your store's web address. Lowercase letters, numbers and hyphens.";
  }
}

function handleHintClass(check: HandleCheck): string {
  if (check.state === "available") return "text-success";
  if (check.state === "taken" || check.state === "invalid") return "text-destructive";
  return "text-muted-foreground";
}

export function SignUpForm({ ctaLabel, ctaNote }: { ctaLabel: string; ctaNote: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // A new store still has setup to finish, so the landing resolver sends it
  // to /onboarding (lib/home.ts). An explicit callbackUrl still wins.
  const callbackUrl = searchParams.get("callbackUrl") || HOME_PATH;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [stallName, setStallName] = useState("");
  // The store link (/s/<handle>) follows the store name until the owner edits
  // it themselves; then it is theirs.
  const [storeHandle, setStoreHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [host, setHost] = useState("");
  const [stallType, setStallType] = useState<StallType>("GENERAL");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [emailTaken, setEmailTaken] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setHost(window.location.host);
  }, []);

  const handleCheck = useStoreHandleCheck(storeHandle);

  function onStallNameChange(value: string) {
    setStallName(value);
    if (!handleEdited) setStoreHandle(normaliseStoreHandle(value));
  }

  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    const first = FIELDS.find((f) => errors[f]);
    if (first) document.getElementById(first)?.focus();
  }

  function describedBy(field: Field, hintId?: string): string | undefined {
    return [hintId, fieldErrors[field] ? `${field}-error` : undefined].filter(Boolean).join(" ") || undefined;
  }

  function fieldError(field: Field) {
    const message = fieldErrors[field];
    if (!message) return null;
    return (
      <p id={`${field}-error`} className="text-sm text-destructive">
        {message}
        {field === "email" && emailTaken ? (
          <>
            {" "}
            <Link href="/sign-in" className={textLinkClass}>
              Sign in instead
            </Link>
          </>
        ) : null}
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailTaken(false);

    const handle = normaliseStoreHandle(storeHandle);
    setStoreHandle(handle);
    const invalid = validate({ name, email, password, stallName, storeHandle: handle });
    if (Object.keys(invalid).length > 0) {
      showFieldErrors(invalid);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    const normalizedEmail = email.trim().toLowerCase();
    let res: Response;
    try {
      res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: normalizedEmail,
          password,
          stallName,
          storeHandle: handle,
          stallType,
          phone: phone.trim() || undefined,
        }),
      });
    } catch {
      setError("No connection. Try again.");
      setSubmitting(false);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as RegisterResponse;

    if (!res.ok) {
      setSubmitting(false);
      if (res.status === 409) {
        // The route says which field: the email is taken, or the store link is.
        const field = isField(data.field) ? data.field : "email";
        if (field === "email") setEmailTaken(true);
        showFieldErrors({ [field]: data.error || SERVER_FIELD_MESSAGE[field] });
        return;
      }
      if (data.reason) {
        showFieldErrors({ password: data.reason });
        return;
      }
      const rejected = FIELDS.filter((f) => data.details?.[f]?.length);
      if (rejected.length > 0) {
        showFieldErrors(Object.fromEntries(rejected.map((f) => [f, SERVER_FIELD_MESSAGE[f]])));
        return;
      }
      setError(data.error || "Could not create account.");
      return;
    }

    try {
      const sign = await signIn("credentials", {
        email: normalizedEmail,
        password,
        redirect: false,
        callbackUrl,
      });
      if (!sign || sign.error) throw new Error("sign-in failed");
      router.push(sign.url || callbackUrl);
      router.refresh();
    } catch {
      setError("Account created but sign-in failed. Try signing in manually.");
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md border-border/80 shadow-lg">
      <CardHeader>
        {/* <h1>, not CardTitle (an <h3>): this is the page's only heading. */}
        <h1 className="font-display text-2xl font-semibold leading-none tracking-tight">Create your store</h1>
        <CardDescription>One account for your store on AwaazOS. {ctaNote}</CardDescription>
      </CardHeader>
      {/* noValidate: onSubmit checks the fields so every error shows under its own field. */}
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
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
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={describedBy("name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {fieldError("name")}
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
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={describedBy("email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {fieldError("email")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="pr-12"
                aria-invalid={fieldErrors.password ? true : undefined}
                aria-describedby={describedBy("password", "password-hint")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label="Show password"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <p id="password-hint" className="text-xs text-muted-foreground">
              At least 8 characters, using two of: lowercase, uppercase, digits or symbols.
            </p>
            {fieldError("password")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="stallName">Store name</Label>
            <Input
              id="stallName"
              name="stallName"
              required
              autoComplete="organization"
              autoCapitalize="words"
              aria-invalid={fieldErrors.stallName ? true : undefined}
              aria-describedby={describedBy("stallName")}
              value={stallName}
              onChange={(e) => onStallNameChange(e.target.value)}
            />
            {fieldError("stallName")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="storeHandle">Store link</Label>
            <div className="flex items-center rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <span className="shrink-0 select-none pl-3 text-sm text-muted-foreground" aria-hidden="true">
                {storeLinkPrefix(host || "awaazos")}
              </span>
              <Input
                id="storeHandle"
                name="storeHandle"
                required
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={STORE_HANDLE_MAX}
                className="border-0 pl-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                aria-invalid={fieldErrors.storeHandle ? true : undefined}
                aria-describedby={describedBy("storeHandle", "storeHandle-hint")}
                value={storeHandle}
                onChange={(e) => {
                  setHandleEdited(true);
                  setStoreHandle(storeHandleWhileTyping(e.target.value));
                }}
                onBlur={() => setStoreHandle((v) => normaliseStoreHandle(v))}
              />
            </div>
            <p id="storeHandle-hint" aria-live="polite" className={`text-xs ${handleHintClass(handleCheck)}`}>
              {handleHint(handleCheck)}
            </p>
            {fieldError("storeHandle")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="stallType">What do you sell?</Label>
            <Select value={stallType} onValueChange={(v) => setStallType(v as StallType)}>
              <SelectTrigger
                id="stallType"
                aria-invalid={fieldErrors.stallType ? true : undefined}
                aria-describedby={describedBy("stallType")}
              >
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
            {fieldError("stallType")}
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
              aria-invalid={fieldErrors.phone ? true : undefined}
              aria-describedby={describedBy("phone")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {fieldError("phone")}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-2">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Creating…" : ctaLabel}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            By continuing you agree to the{" "}
            <Link href="/legal/terms" className={textLinkClass}>
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className={textLinkClass}>
              Privacy Policy
            </Link>
            .
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/sign-in" className={textLinkClass}>
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

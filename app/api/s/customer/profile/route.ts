import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentCustomer } from "@/lib/customer-auth";
import { ADDRESS_LINE_MAX, isValidPincode, LANDMARK_MAX, LOCALITY_MAX, normalisePincode } from "@/lib/delivery-address";
import { prisma } from "@/lib/prisma";
import { makeLimiter, tooManyRequests } from "@/lib/ratelimit";
import { indianPhoneE164 } from "@/lib/zod-drops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET / PATCH /api/s/customer/profile — the signed-in buyer's own profile.
 *
 * Scoped by the session alone: the customer id comes from the `awz_cust`
 * cookie, never from the request, so a buyer can only read/write themselves.
 * Email is the login identity and is not editable here.
 *
 * PII: name / phone / address are never logged.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

const patchSchema = z.object({
  name: optionalText(80),
  phone: z
    .union([z.literal(""), indianPhoneE164])
    .transform((v) => v || null)
    .nullish(),
  savedAddress: optionalText(ADDRESS_LINE_MAX),
  savedLocality: optionalText(LOCALITY_MAX),
  savedLandmark: optionalText(LANDMARK_MAX),
  savedPincode: z
    .string()
    .trim()
    .transform((v) => normalisePincode(v) || null)
    .refine((v) => v === null || isValidPincode(v), "A pincode has 6 digits")
    .nullish(),
});

const writeLimit = makeLimiter({ name: "customer-profile", windowMs: 60_000, max: 20 });

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  savedAddress: true,
  savedLocality: true,
  savedLandmark: true,
  savedPincode: true,
} as const;

export async function GET() {
  try {
    const customer = await getCurrentCustomer();
    if (!customer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.json({ data: customer });
  } catch (err) {
    console.error(
      JSON.stringify({ event: "customer_profile_get_failed", error: err instanceof Error ? err.name : "unknown" }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const customer = await getCurrentCustomer();
    if (!customer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const rl = await writeLimit.check(customer.id);
    if (!rl.ok) return tooManyRequests(rl, "customer-profile");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }

    const data: Prisma.CustomerUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.phone !== undefined) data.phone = parsed.data.phone;
    if (parsed.data.savedAddress !== undefined) data.savedAddress = parsed.data.savedAddress;
    if (parsed.data.savedLocality !== undefined) data.savedLocality = parsed.data.savedLocality;
    if (parsed.data.savedLandmark !== undefined) data.savedLandmark = parsed.data.savedLandmark;
    if (parsed.data.savedPincode !== undefined) data.savedPincode = parsed.data.savedPincode;

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data,
      select: PROFILE_SELECT,
    });
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "customer_profile_patch_failed",
        error: err instanceof Error ? err.name : "unknown",
        code: (err as { code?: unknown } | null)?.code ?? null,
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

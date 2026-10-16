import { Prisma } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { NextResponse } from "next/server";

import { TRIAL_DAYS } from "@/lib/constants";
import { hashPassword } from "@/lib/password";
import { checkPasswordPolicy } from "@/lib/password-strength";
import { prisma } from "@/lib/prisma";
import { resolveStallTypeOther } from "@/lib/stall-type";
import { authRateLimit, getClientIp, tooManyRequests } from "@/lib/ratelimit";
import { STORE_HANDLE_TAKEN_MESSAGE } from "@/lib/store-handle";
import { newVendorSlug } from "@/lib/store-slug";
import { signUpSchema } from "@/lib/zod-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = await authRateLimit.check(ip);
  if (!rl.ok) {
    return tooManyRequests(rl, "register");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = signUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const name = parsed.data.name.trim();
  const stallName = parsed.data.stallName.trim();
  const { stallType, password, storeHandle } = parsed.data;
  // Valid whenever the schema passed (it requires a description for OTHER).
  const other = resolveStallTypeOther(stallType, parsed.data.stallTypeOther);
  const stallTypeOther = other.ok ? other.value : null;

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    return NextResponse.json(
      { error: "Password policy violation", reason: policy.reason },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);

  let phoneE164: string | undefined;
  if (parsed.data.phone && parsed.data.phone.trim() !== "") {
    const p = parsePhoneNumberFromString(parsed.data.phone.trim(), "IN");
    phoneE164 = p?.format("E.164");
  }

  // An owner-chosen link is tried once: taken means taken, they pick another.
  // The random-suffix fallback retries with a fresh suffix.
  const maxAttempts = storeHandle ? 1 : 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = storeHandle ?? newVendorSlug(stallName);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            name,
            passwordHash,
            role: "USER",
          },
        });
        const vendor = await tx.vendor.create({
          data: {
            slug,
            name: stallName,
            ownerName: name,
            stallType,
            stallTypeOther,
            phone: phoneE164,
            email,
            // Free trial with STARTER limits; billingAccess() (lib/plan.ts)
            // evaluates it lazily — nothing runs when it ends.
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
          },
        });
        await tx.vendorSettings.create({
          data: { vendorId: vendor.id },
        });
        await tx.staffMember.create({
          data: {
            vendorId: vendor.id,
            userId: user.id,
            name,
            phone: phoneE164,
            role: "OWNER",
          },
        });
        return { userId: user.id, vendorId: vendor.id, vendorSlug: vendor.slug };
      });

      const res = NextResponse.json(result, { status: 201 });
      res.cookies.set("awz_vendor", result.vendorSlug, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      return res;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = err.meta?.target;
        const paths = Array.isArray(target) ? target.join(" ") : String(target ?? "");
        const slugCollision = paths.includes("slug");
        if (slugCollision && attempt < maxAttempts - 1) {
          continue;
        }
        if (slugCollision) {
          return NextResponse.json(
            storeHandle
              ? { error: STORE_HANDLE_TAKEN_MESSAGE, field: "storeHandle" }
              : {
                  error: "Could not create a store link from that name. Try a different store name.",
                  field: "stallName",
                },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: "An account with this email already exists.", field: "email" },
          { status: 409 },
        );
      }
      console.error("[auth/register] failed", err);
      return NextResponse.json({ error: "Could not create account." }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: "Could not create a store link from that name. Try a different store name.", field: "stallName" },
    { status: 409 },
  );
}

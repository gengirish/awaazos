import { Prisma } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { signUpSchema } from "@/lib/zod-auth";

function slugBase(stallName: string): string {
  const s = stallName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "stall";
}

function randomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]!;
  }
  return out;
}

export async function POST(req: Request) {
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
  const { stallType, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  let phoneE164: string | undefined;
  if (parsed.data.phone && parsed.data.phone.trim() !== "") {
    const p = parsePhoneNumberFromString(parsed.data.phone.trim(), "IN");
    phoneE164 = p?.format("E.164");
  }

  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = `${slugBase(stallName)}-${randomSuffix()}`;
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
            phone: phoneE164,
            email,
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
        return NextResponse.json(
          { error: "An account or stall with this email or URL slug already exists." },
          { status: 409 },
        );
      }
      console.error("[auth/register] failed", err);
      return NextResponse.json({ error: "Could not create account." }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Could not allocate a unique stall URL. Try a different stall name." }, { status: 409 });
}

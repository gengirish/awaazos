import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { contactMessageSchema } from "@/lib/contact-message-schema";
import { sendContactMessage } from "@/lib/email";
import { logger } from "@/lib/logger";
import { contactFormRateLimit, getClientIp, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/contact: one message from the public /contact form (lib/contact-message.ts).
 * No session. Emailed to our inbox and stored nowhere; the IP is used for the
 * rate limit only. 503 `not_sent` when the email didn't go, so the page can say so.
 */
export async function POST(req: NextRequest) {
  const rl = await contactFormRateLimit.check(getClientIp(req));
  if (!rl.ok) return tooManyRequests(rl, "contact-form");

  try {
    const { website, ...message } = contactMessageSchema.parse(await req.json());
    // Honeypot filled: a bot. Same answer as a real send, nothing sent.
    if (website) return NextResponse.json({ data: { sent: true } }, { status: 201 });

    const { delivered } = await sendContactMessage(message);
    if (!delivered) return NextResponse.json({ error: "not_sent" }, { status: 503 });
    return NextResponse.json({ data: { sent: true } }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    // Never the body: it is the sender's contact details and message.
    logger.error(
      { route: "POST /api/contact", error: err instanceof Error ? err.name : "unknown" },
      "contact form failed",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

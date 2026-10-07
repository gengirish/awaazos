import { requireEnv } from "@/lib/env";
import { lastFourDigits } from "@/lib/phone";

export type SendWhatsappReceiptArgs = {
  to: string;
  message: string;
};

/**
 * Gupshup WhatsApp text message. Does not log full phone — only last 4 digits.
 */
export async function sendWhatsappReceipt(args: SendWhatsappReceiptArgs): Promise<{ messageId: string; ok: boolean }> {
  const started = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);

  const inner = JSON.stringify({ type: "text", text: args.message });
  const body = new URLSearchParams({
    channel: "whatsapp",
    source: requireEnv("GUPSHUP_SOURCE_NUMBER"),
    destination: args.to,
    "src.name": requireEnv("GUPSHUP_APP_NAME"),
    message: inner,
  });

  try {
    const res = await fetch("https://api.gupshup.io/sm/api/v1/msg", {
      method: "POST",
      headers: {
        apikey: requireEnv("GUPSHUP_API_KEY"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;
    let messageId = "";
    try {
      const json = (await res.json()) as { messageId?: string; id?: string };
      messageId = json.messageId ?? json.id ?? "";
    } catch {
      /* ignore */
    }

    const ok = res.ok;
    console.log(
      JSON.stringify({
        integration: "gupshup",
        ok,
        messageId: messageId || undefined,
        latencyMs,
        phoneLast4: lastFourDigits(args.to),
      }),
    );

    return { messageId, ok };
  } finally {
    clearTimeout(t);
  }
}

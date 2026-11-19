import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUPPORT_EMAIL } from "@/lib/business-contact";
import { contactMessageSchema } from "@/lib/contact-message-schema";
import { sendContactMessage } from "@/lib/email";
import { logger } from "@/lib/logger";

const VALID = { name: "  Asha   Rao ", email: "asha@example.test", phone: "98765 43210", message: "Is Lite enough for my bakery?" };

describe("contactMessageSchema", () => {
  it("trims, collapses the name and stores the phone as E.164", () => {
    expect(contactMessageSchema.parse(VALID)).toEqual({
      name: "Asha Rao",
      email: "asha@example.test",
      phone: "+919876543210",
      message: "Is Lite enough for my bakery?",
    });
  });

  it("allows no phone", () => {
    expect(contactMessageSchema.parse({ ...VALID, phone: undefined }).phone).toBe("");
    expect(contactMessageSchema.parse({ ...VALID, phone: "  " }).phone).toBe("");
  });

  it.each([
    ["a bad email", { email: "asha@" }],
    ["a landline-length phone", { phone: "040 1234" }],
    ["a phone not starting 6-9", { phone: "12345 67890" }],
    ["a one-word message", { message: "hi" }],
    ["a blank name", { name: "   " }],
    ["a message over 2000 chars", { message: "x".repeat(2001) }],
  ])("refuses %s", (_label, patch) => {
    expect(contactMessageSchema.safeParse({ ...VALID, ...patch }).success).toBe(false);
  });

  it("keeps the honeypot so the route can drop bots", () => {
    expect(contactMessageSchema.parse({ ...VALID, website: "http://spam" }).website).toBe("http://spam");
  });
});

describe("sendContactMessage", () => {
  const fetchMock = vi.fn();
  const message = { name: "Asha <b>Rao</b>", email: "asha@example.test", phone: "", message: "Hello\n<script>x</script>" };

  beforeEach(() => {
    vi.stubEnv("AGENTMAIL_API_KEY", "test-key");
    vi.stubEnv("AGENTMAIL_INBOX_ID", "inbox@example.test");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message_id: "m1" }), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emails our inbox with the sender's details, escaped in HTML", async () => {
    await expect(sendContactMessage(message)).resolves.toEqual({ delivered: true });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.to).toEqual([SUPPORT_EMAIL]);
    expect(body.subject).toBe("Contact form: Asha <b>Rao</b>");
    expect(body.text).toContain("Email: asha@example.test");
    expect(body.text).toContain("Phone: Not given");
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("never logs the sender or the message", async () => {
    const info = vi.spyOn(logger, "info");
    await sendContactMessage(message);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("asha");
    expect(logged).not.toContain("Hello");
  });

  it("reports not delivered when the provider refuses or is not set up", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(sendContactMessage(message)).resolves.toEqual({ delivered: false });
    vi.stubEnv("AGENTMAIL_API_KEY", "");
    await expect(sendContactMessage(message)).resolves.toEqual({ delivered: false });
  });
});

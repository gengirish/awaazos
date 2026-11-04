import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TRIAL_DAYS } from "@/lib/constants";
import { sendDemoClaimEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

const CLAIM_URL = "https://awaazos.intelliforge.tech/claim/secret-token";
const INPUT = {
  to: "seller@example.test",
  storeName: "Tom & Jerry's <Bakes>",
  claimUrl: CLAIM_URL,
  expiresAt: new Date("2026-11-11T10:00:00Z"),
};

describe("sendDemoClaimEmail", () => {
  const fetchMock = vi.fn();

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

  it("sends the link, the trial length and the expiry to the invited address", async () => {
    await expect(sendDemoClaimEmail(INPUT)).resolves.toEqual({ delivered: true });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.to).toEqual(["seller@example.test"]);
    expect(body.subject).toBe("Tom & Jerry's <Bakes> is ready for you to claim");
    expect(body.text).toContain(CLAIM_URL);
    expect(body.text).toContain(`${TRIAL_DAYS}-day free trial`);
    expect(body.text).toContain("until 11/11/2026");
    expect(body.labels).toEqual(["demo-claim", "transactional"]);
  });

  it("escapes the store name in the HTML", async () => {
    await sendDemoClaimEmail(INPUT);
    const { html } = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(html).toContain("Tom &amp; Jerry&#39;s &lt;Bakes&gt;");
    expect(html).not.toContain("<Bakes>");
  });

  it("reports a provider rejection without throwing or logging the link", async () => {
    const spies = [vi.spyOn(logger, "info"), vi.spyOn(logger, "warn"), vi.spyOn(logger, "error")];
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(sendDemoClaimEmail(INPUT)).resolves.toEqual({ delivered: false });
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain("secret-token");
  });

  it("reports no provider configured without calling out", async () => {
    vi.stubEnv("AGENTMAIL_API_KEY", "");
    await expect(sendDemoClaimEmail(INPUT)).resolves.toEqual({ delivered: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

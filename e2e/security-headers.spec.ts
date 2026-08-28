import { expect, test } from "@playwright/test";

/**
 * The security headers in next.config.mjs are configured once for `/:path*`
 * and then never thought about again — which is exactly how a regression slips
 * in. These assert the properties that matter rather than the literal string,
 * so tightening the CSP does not break the suite but dropping a directive does.
 */

const PATHS = ["/", "/pricing", "/api/health"];

for (const path of PATHS) {
  test(`${path} carries the security headers`, async ({ request }) => {
    const res = await request.get(path, { failOnStatusCode: false });
    const h = res.headers();

    expect(h["x-content-type-options"], "MIME sniffing must stay off").toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");

    // The POS needs the mic; nothing else should be reachable.
    const permissions = h["permissions-policy"] ?? "";
    expect(permissions).toContain("microphone=(self)");
    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("geolocation=()");

    // Fingerprinting the framework version buys an attacker a CVE shortlist.
    expect(h["x-powered-by"]).toBeUndefined();
  });
}

test("the CSP keeps the clickjacking and injection directives", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"] ?? "";

  expect(csp, "CSP header must be present").not.toBe("");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("default-src 'self'");
});

test("the CSP allowlists the QR service used by the UPI modal and storefront", async ({
  request,
}) => {
  const csp = (await request.get("/")).headers()["content-security-policy"] ?? "";
  // Both the POS UpiQRModal and /s/[slug] render an <img> from this host; if the
  // directive is dropped the QR silently fails to paint and a vendor cannot be paid.
  expect(csp).toContain("https://api.qrserver.com");
});

test("audio never has an egress path to a provider the CSP does not name", async ({ request }) => {
  const csp = (await request.get("/")).headers()["content-security-policy"] ?? "";
  const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";

  expect(connectSrc, "connect-src must be explicit, not inherited from default-src").not.toBe("");
  expect(connectSrc).toContain("'self'");

  // Subdomain wildcards like https://*.razorpay.com are fine; a bare `*`,
  // `https:` or `http:` source is not — that would let any future client code
  // post audio anywhere, which is what ARCHITECTURE.md §3 forbids.
  const sources = connectSrc.trim().split(/\s+/).slice(1);
  expect(sources.length).toBeGreaterThan(0);
  for (const src of sources) {
    expect(src, `connect-src must not contain the blanket source ${src}`).not.toMatch(
      /^(\*|https?:)$/,
    );
  }
});

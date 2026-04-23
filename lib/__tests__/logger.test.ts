import { describe, expect, it } from "vitest";

import { logger, newRequestId, requestLogger, withRequestId } from "@/lib/logger";

describe("logger", () => {
  it("exposes a configured pino logger with base fields", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("newRequestId produces 16-char lowercase hex", () => {
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("newRequestId returns unique values across calls", () => {
    const s = new Set<string>();
    for (let i = 0; i < 100; i++) s.add(newRequestId());
    expect(s.size).toBeGreaterThan(95);
  });

  it("requestLogger reuses an incoming X-Request-Id header when valid", () => {
    const id = "abcdef0123456789";
    const req = new Request("http://x", { headers: { "x-request-id": id } });
    const child = requestLogger(req);
    expect(child).toBeDefined();
    expect(child.bindings().requestId).toBe(id);
  });

  it("requestLogger ignores garbage X-Request-Id and generates a fresh one", () => {
    const req = new Request("http://x", { headers: { "x-request-id": "<<bad value>>" } });
    const child = requestLogger(req);
    const reqId = child.bindings().requestId as string;
    expect(reqId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("requestLogger generates a fresh id when no header present", () => {
    const child = requestLogger();
    const reqId = child.bindings().requestId as string;
    expect(reqId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("withRequestId attaches the X-Request-Id response header", () => {
    const r = new Response("hello");
    const out = withRequestId(r, "req-12345678");
    expect(out.headers.get("X-Request-Id")).toBe("req-12345678");
  });
});

import pino from "pino";

/**
 * Process-level structured logger.
 *
 * Design:
 *  - JSON-by-default output → Vercel Log Drains / Axiom / Logtail can index
 *    every field without regex parsing.
 *  - PII-redactor list mirrors the spec's PII boundary
 *    (customerPhone / customerEmail / sessionToken / passwordHash never
 *    leak to logs even if a careless caller passes them).
 *  - Level controlled by LOG_LEVEL env (defaults to "info" prod / "debug" dev).
 *  - "service" + "env" base fields make multi-app log drains filterable.
 *
 * Per-request correlation: use `requestLogger(reqId)` to bind a request id
 * onto every log line within an API route. Use `newRequestId()` to generate
 * one when none is provided by the caller.
 */

const LEVEL =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

const REDACT_PATHS = [
  // Top-level PII
  "customerPhone",
  "customerEmail",
  "phone",
  "email",
  "passwordHash",
  "password",
  "sessionToken",
  "auth",
  "Authorization",
  "authorization",
  "cookie",
  "Cookie",
  "set-cookie",
  // Nested under common payload shapes
  "*.customerPhone",
  "*.customerEmail",
  "*.passwordHash",
  "*.password",
  "*.sessionToken",
  "headers.authorization",
  "headers.cookie",
  "headers.Authorization",
  "headers.Cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const logger = pino({
  level: LEVEL,
  base: {
    service: "awaazos",
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    region: process.env.VERCEL_REGION || undefined,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACT_PATHS,
    remove: false,
    censor: "[REDACTED]",
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

/** Generate a short request-id (16 hex chars, ~64 bits of entropy — enough for log correlation). */
export function newRequestId(): string {
  // Avoid node:crypto.randomUUID since this lib gets imported in edge contexts; use Math
  // for an opaque, non-security-sensitive correlation id.
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/**
 * Bind a request id onto a child logger so every log line from this request
 * carries the same `requestId` field. Use at the top of every API route:
 *
 *   const log = requestLogger(req);
 *   log.info({ event: "vendor.created", vendorId }, "vendor created");
 */
export function requestLogger(req?: Request): pino.Logger {
  const incoming = req?.headers.get("x-request-id") || req?.headers.get("X-Request-Id");
  const requestId = incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : newRequestId();
  return logger.child({ requestId });
}

/**
 * Attach a generated request id header to a Response so the client can
 * correlate browser-side errors with server-side log lines.
 */
export function withRequestId(res: Response, requestId: string): Response {
  res.headers.set("X-Request-Id", requestId);
  return res;
}

/**
 * Secret box — AES-256-GCM for third-party credentials we must store at rest
 * (today: each vendor's own Razorpay key secret + webhook secret).
 *
 * Key: PAYMENT_KEYS_ENCRYPTION_KEY, 32 random bytes as base64 / base64url or
 * 64 hex chars (`openssl rand -base64 32`). Feature-gated, never boot-required:
 * it is asserted only when a payment path actually needs it.
 *
 * Wire format: `v1:<iv b64url>:<tag b64url>:<ciphertext b64url>`.
 *   - 12-byte random IV per encryption (never reused with a key).
 *   - 16-byte GCM tag: any tampering, truncation or wrong key fails loudly.
 *   - Optional AAD binds a ciphertext to its context (vendor + field), so a blob
 *     copied onto another vendor's row, or into another column, will not decrypt.
 *
 * Never log plaintext, ciphertext or the key. Errors carry no secret material.
 */

import crypto from "node:crypto";

import { requireEnv } from "@/lib/env";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class SecretBoxKeyMissingError extends Error {
  constructor() {
    super("PAYMENT_KEYS_ENCRYPTION_KEY is not configured");
    this.name = "SecretBoxKeyMissingError";
  }
}

export class SecretBoxKeyInvalidError extends Error {
  constructor() {
    super("PAYMENT_KEYS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64 hex chars)");
    this.name = "SecretBoxKeyInvalidError";
  }
}

export class SecretBoxDecryptError extends Error {
  constructor(reason: string) {
    super(`Could not decrypt secret: ${reason}`);
    this.name = "SecretBoxDecryptError";
  }
}

/** Decode a configured key string to 32 raw bytes, or throw SecretBoxKeyInvalidError. */
export function parseSecretBoxKey(raw: string): Buffer {
  const s = raw.trim();
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    buf = Buffer.from(s, "hex");
  } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) {
    buf = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } else {
    throw new SecretBoxKeyInvalidError();
  }
  if (buf.length !== KEY_BYTES) throw new SecretBoxKeyInvalidError();
  return buf;
}

/** The configured key. Throws SecretBoxKeyMissingError / SecretBoxKeyInvalidError. */
export function getSecretBoxKey(): Buffer {
  let raw: string;
  try {
    raw = requireEnv("PAYMENT_KEYS_ENCRYPTION_KEY");
  } catch {
    throw new SecretBoxKeyMissingError();
  }
  return parseSecretBoxKey(raw);
}

/** True when a valid key is configured. Never throws. */
export function isSecretBoxConfigured(): boolean {
  try {
    getSecretBoxKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptWithKey(plaintext: string, key: Buffer, aad?: string): string {
  if (key.length !== KEY_BYTES) throw new SecretBoxKeyInvalidError();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptWithKey(box: string, key: Buffer, aad?: string): string {
  if (key.length !== KEY_BYTES) throw new SecretBoxKeyInvalidError();
  const parts = box.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxDecryptError("unrecognised format");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ct = Buffer.from(parts[3] ?? "", "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxDecryptError("malformed iv or tag");
  }
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong AAD, or tampered bytes — GCM can't tell which, and we
    // must not hint at it either.
    throw new SecretBoxDecryptError("authentication failed");
  }
}

/** Encrypt with the configured key. */
export function encryptSecret(plaintext: string, aad?: string): string {
  return encryptWithKey(plaintext, getSecretBoxKey(), aad);
}

/** Decrypt with the configured key. */
export function decryptSecret(box: string, aad?: string): string {
  return decryptWithKey(box, getSecretBoxKey(), aad);
}

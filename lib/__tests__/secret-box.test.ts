import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  requireEnv: (key: string) => {
    const v = process.env[key];
    if (v === undefined || v === "") throw new Error(`${key} not set`);
    return v;
  },
}));

import {
  decryptSecret,
  decryptWithKey,
  encryptSecret,
  encryptWithKey,
  isSecretBoxConfigured,
  parseSecretBoxKey,
  SecretBoxDecryptError,
  SecretBoxKeyInvalidError,
  SecretBoxKeyMissingError,
} from "@/lib/secret-box";

const key = crypto.randomBytes(32);

describe("secret-box", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips, with a fresh IV each time", () => {
    const a = encryptWithKey("rzp_secret_abc123", key);
    const b = encryptWithKey("rzp_secret_abc123", key);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a.split(":")).toHaveLength(4);
    expect(a).not.toContain("rzp_secret_abc123");
    expect(decryptWithKey(a, key)).toBe("rzp_secret_abc123");
    expect(decryptWithKey(b, key)).toBe("rzp_secret_abc123");
  });

  it("round-trips unicode and empty strings", () => {
    expect(decryptWithKey(encryptWithKey("", key), key)).toBe("");
    expect(decryptWithKey(encryptWithKey("आवाज़ ₹", key), key)).toBe("आवाज़ ₹");
  });

  it("detects tampering in ciphertext, tag and iv", () => {
    const box = encryptWithKey("hello world", key);
    const [v, iv, tag, ct] = box.split(":") as [string, string, string, string];
    const flip = (s: string) => {
      const buf = Buffer.from(s, "base64url");
      buf[0] = (buf[0] ?? 0) ^ 0x01;
      return buf.toString("base64url");
    };
    expect(() => decryptWithKey([v, iv, tag, flip(ct)].join(":"), key)).toThrow(SecretBoxDecryptError);
    expect(() => decryptWithKey([v, iv, flip(tag), ct].join(":"), key)).toThrow(SecretBoxDecryptError);
    expect(() => decryptWithKey([v, flip(iv), tag, ct].join(":"), key)).toThrow(SecretBoxDecryptError);
    expect(() => decryptWithKey(`v2:${iv}:${tag}:${ct}`, key)).toThrow(SecretBoxDecryptError);
    expect(() => decryptWithKey("garbage", key)).toThrow(SecretBoxDecryptError);
  });

  it("fails with the wrong key", () => {
    const box = encryptWithKey("hello", key);
    expect(() => decryptWithKey(box, crypto.randomBytes(32))).toThrow(SecretBoxDecryptError);
  });

  it("binds ciphertext to its AAD context", () => {
    const box = encryptWithKey("s3cret", key, "razorpay:key_secret:vendorA");
    expect(decryptWithKey(box, key, "razorpay:key_secret:vendorA")).toBe("s3cret");
    expect(() => decryptWithKey(box, key, "razorpay:key_secret:vendorB")).toThrow(SecretBoxDecryptError);
    expect(() => decryptWithKey(box, key)).toThrow(SecretBoxDecryptError);
  });

  it("parses base64, base64url and hex keys; rejects bad lengths", () => {
    expect(parseSecretBoxKey(key.toString("base64")).equals(key)).toBe(true);
    expect(parseSecretBoxKey(key.toString("base64url")).equals(key)).toBe(true);
    expect(parseSecretBoxKey(key.toString("hex")).equals(key)).toBe(true);
    expect(() => parseSecretBoxKey(crypto.randomBytes(16).toString("base64"))).toThrow(SecretBoxKeyInvalidError);
    expect(() => parseSecretBoxKey(crypto.randomBytes(31).toString("hex"))).toThrow(SecretBoxKeyInvalidError);
    expect(() => parseSecretBoxKey("not a key!!")).toThrow(SecretBoxKeyInvalidError);
    expect(() => encryptWithKey("x", crypto.randomBytes(16))).toThrow(SecretBoxKeyInvalidError);
  });

  it("uses PAYMENT_KEYS_ENCRYPTION_KEY from env, typed errors when missing or invalid", () => {
    vi.stubEnv("PAYMENT_KEYS_ENCRYPTION_KEY", "");
    expect(isSecretBoxConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(SecretBoxKeyMissingError);

    vi.stubEnv("PAYMENT_KEYS_ENCRYPTION_KEY", "c2hvcnQ=");
    expect(isSecretBoxConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(SecretBoxKeyInvalidError);

    vi.stubEnv("PAYMENT_KEYS_ENCRYPTION_KEY", key.toString("base64"));
    expect(isSecretBoxConfigured()).toBe(true);
    const box = encryptSecret("from-env", "ctx");
    expect(decryptSecret(box, "ctx")).toBe("from-env");
    expect(decryptWithKey(box, key, "ctx")).toBe("from-env");
  });
});

/**
 * A password the admin can read out to a seller over the phone: "kqvt-7392-mxzh"
 * (letters without i, l, o; digits without 0, 1), which passes checkPasswordPolicy
 * (14 characters, lowercase + digits). Pure and client-safe; `random` is injectable
 * for tests and defaults to crypto.getRandomValues.
 */
import { BRAND_NAME } from "@/lib/brand";

const LETTERS = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

function cryptoRandom(n: number): number[] {
  const buf = new Uint32Array(n);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf);
}

export function generateHandoverPassword(random: (n: number) => number[] = cryptoRandom): string {
  const r = random(12);
  const pick = (set: string, i: number) => set[r[i]! % set.length];
  const group = (set: string, from: number) => [0, 1, 2, 3].map((k) => pick(set, from + k)).join("");
  return `${group(LETTERS, 0)}-${group(DIGITS, 4)}-${group(LETTERS, 8)}`;
}

/** What the admin copies to the seller. No store data beyond the name and link. */
export function handoverLoginText(p: { storeName: string; email: string; password: string; signInUrl: string }): string {
  return [
    `Your ${BRAND_NAME} store "${p.storeName}" is ready.`,
    `Sign in: ${p.signInUrl}`,
    `Email: ${p.email}`,
    `Password: ${p.password}`,
    `You can change the password with "Forgot password?" on the sign-in page.`,
  ].join("\n");
}

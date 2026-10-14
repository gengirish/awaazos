/**
 * Vendor.slug: "<name, url-safe, ≤ 40 chars>-<4 random chars>", e.g.
 * "prankie-s-bakery-001x". Callers retry on a P2002 slug collision.
 * Shared by sign-up and the internal demo-store API.
 */

export function slugBase(stallName: string): string {
  const s = stallName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "stall";
}

export function randomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]!;
  }
  return out;
}

export function newVendorSlug(stallName: string): string {
  return `${slugBase(stallName)}-${randomSuffix()}`;
}

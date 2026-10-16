import { put } from "@vercel/blob";

import { deleteBlobQuietly, readImageUpload } from "@/lib/blob-image";
import { DemoStoreError } from "@/lib/demo-store";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { StoreImageKind } from "@/lib/store-image";

/**
 * Banner and logo for a demo store, set by a platform admin from
 * /admin/demo-stores (POST/DELETE /api/admin/demo-stores/<ref>/banner|logo).
 * A demo store is owned by the internal demo account until it is claimed, so
 * nobody could add its pictures from Settings; this is the same upload as
 * lib/store-image.ts with the store chosen by its external ref instead of the
 * session. Server-only.
 *
 * - Demo stores only: unknown ref → 404, a claimed store → 409 (it belongs to
 *   the seller now; they change it in Settings).
 * - The row is written with `isDemo: true` in the `where`, so a store claimed
 *   between the read and the write is left alone.
 * - Each change writes a DemoAuditLog row ("image"); those rows are not
 *   counted by the 20-a-day create limit.
 * - No Blob token → 503 `image_uploads_unavailable`.
 */

const FIELD = { banner: "bannerUrl", logo: "logoUrl" } as const satisfies Record<StoreImageKind, string>;
const TAG = "admin demo-store image";

async function demoVendor(externalRef: string) {
  const v = await prisma.vendor.findUnique({
    where: { demoExternalRef: externalRef },
    select: { id: true, isDemo: true, bannerUrl: true, logoUrl: true },
  });
  if (!v) throw new DemoStoreError(404, "not_found");
  if (!v.isDemo) throw new DemoStoreError(409, "not_a_demo_store");
  return v;
}

async function writeImage(vendorId: string, kind: StoreImageKind, url: string | null, externalRef: string, actor: string) {
  await prisma.$transaction(async (tx) => {
    const res = await tx.vendor.updateMany({ where: { id: vendorId, isDemo: true }, data: { [FIELD[kind]]: url } });
    if (res.count !== 1) throw new DemoStoreError(409, "not_a_demo_store");
    await tx.demoAuditLog.create({ data: { action: "image", externalRef, vendorId, actor } });
  });
}

export async function setDemoStoreImage(
  req: Request,
  externalRef: string,
  kind: StoreImageKind,
  actor: string,
): Promise<{ url: string }> {
  const v = await demoVendor(externalRef);
  // Validated before touching Blob storage — never pay for an upload we reject.
  const { file, ext } = await readImageUpload(req);
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new DemoStoreError(503, "image_uploads_unavailable");

  const blob = await put(`store/${v.id}/${kind}.${ext}`, file, {
    access: "public",
    token,
    contentType: file.type,
    addRandomSuffix: true,
  });
  try {
    await writeImage(v.id, kind, blob.url, externalRef, actor);
  } catch (e) {
    await deleteBlobQuietly(blob.url, token, TAG);
    throw e;
  }
  await deleteBlobQuietly(v[FIELD[kind]], token, TAG);
  return { url: blob.url };
}

export async function removeDemoStoreImage(externalRef: string, kind: StoreImageKind, actor: string): Promise<void> {
  const v = await demoVendor(externalRef);
  const previous = v[FIELD[kind]];
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (previous && !token) throw new DemoStoreError(503, "image_uploads_unavailable");
  await writeImage(v.id, kind, null, externalRef, actor);
  if (previous && token) await deleteBlobQuietly(previous, token, TAG);
}

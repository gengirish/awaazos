import type { NextRequest } from "next/server";

import { removeStoreImage, uploadStoreImage } from "@/lib/store-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Store logo on /s/[slug] — OWNER only. Contract: lib/store-image.ts. */
export const POST = (req: NextRequest) => uploadStoreImage(req, "logo");
export const DELETE = (req: NextRequest) => removeStoreImage(req, "logo");

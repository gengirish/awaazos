import type { NextRequest } from "next/server";

import { removeStoreImage, uploadStoreImage } from "@/lib/store-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Store banner on /s/[slug] — OWNER only. Contract: lib/store-image.ts. */
export const POST = (req: NextRequest) => uploadStoreImage(req, "banner");
export const DELETE = (req: NextRequest) => removeStoreImage(req, "banner");

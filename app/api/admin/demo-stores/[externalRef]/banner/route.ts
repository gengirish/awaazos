import { demoStoreImageRoutes } from "@/lib/demo-store-image-routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST (multipart `file`) / DELETE the banner of a demo store — platform ADMIN; demo stores only (lib/demo-store-image.ts). */
export const { POST, DELETE } = demoStoreImageRoutes("banner");

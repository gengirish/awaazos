// Same card for X/Twitter. Route config must be literal per file (Next reads it
// statically), so only the renderer and its metadata are re-exported.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { alt, contentType, default, size } from "./opengraph-image";

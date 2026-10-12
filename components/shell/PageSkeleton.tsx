import { cn } from "@/lib/utils";

const BLOCK = "rounded-md bg-muted motion-safe:animate-pulse";

/**
 * Placeholder shown by `loading.tsx` while a vendor page's data loads. It
 * renders inside the app shell, so navigation stays visible and usable.
 * Shapes only (a title, then a few cards) — close enough to every page here.
 */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn("mx-auto max-w-3xl p-4 md:p-6", className)}>
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="space-y-6">
        <div className="space-y-2">
          <div className={cn(BLOCK, "h-8 w-40")} />
          <div className={cn(BLOCK, "h-4 w-64 max-w-full")} />
        </div>
        <div className="space-y-3">
          <div className={cn(BLOCK, "h-24 w-full")} />
          <div className={cn(BLOCK, "h-24 w-full")} />
          <div className={cn(BLOCK, "h-24 w-full")} />
        </div>
      </div>
    </div>
  );
}

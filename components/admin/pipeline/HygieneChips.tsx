"use client";

import type { PipelineHandlers } from "@/components/admin/pipeline/PipelineClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PipelineItem } from "@/lib/demo-pipeline-server";

/**
 * "Possible duplicate" and "Looks like a test" on an unclaimed store. Keeping one
 * of a pair archives the other as a duplicate; orders stay where they are, so a
 * store with real orders can't be the one archived.
 */
export function HygieneChips({
  item,
  handlers,
  stores,
}: {
  item: PipelineItem;
  handlers: PipelineHandlers;
  /** Every store on the page, to find the other half of a pair. */
  stores: readonly PipelineItem[];
}) {
  if (!item.facts.isDemo) return null;
  if (!item.looksLikeTest && item.duplicates.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {item.looksLikeTest ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Looks like a test</Badge>
          <Button type="button" size="sm" variant="outline" onClick={() => handlers.archive(item, "test")}>
            Archive as test
          </Button>
        </div>
      ) : null}
      {item.duplicates.map((dup) => {
        const other = stores.find((s) => s.ref === dup.ref);
        return (
          <div key={dup.ref} className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Possible duplicate of {dup.name}</Badge>
            <span className="font-mono text-xs text-muted-foreground">ref {dup.ref}</span>
            {item.facts.orderCount === 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => handlers.archive(item, "duplicate")}>
                Archive this one
              </Button>
            ) : null}
            {other && !dup.claimed && dup.orderCount === 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => handlers.archive(other, "duplicate")}>
                Keep this, archive the other
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
